import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import * as fflate from 'fflate';

type Listener = (event?: any) => void;

class FakeClassList {
  private readonly names = new Set<string>();
  add(...list: string[]) {
    for (const name of list) this.names.add(name);
  }
  remove(...list: string[]) {
    for (const name of list) this.names.delete(name);
  }
  toggle(name: string, force?: boolean) {
    if (force === true) this.names.add(name);
    else if (force === false) this.names.delete(name);
    else if (this.names.has(name)) this.names.delete(name);
    else this.names.add(name);
  }
  contains(name: string) {
    return this.names.has(name);
  }
}

class FakeElement {
  id = '';
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  private readonly listeners = new Map<string, Listener[]>();
  private readonly attributes = new Map<string, string>();
  tagName = 'DIV';
  className = '';
  innerText = '';
  private html = '';
  textContent = '';
  value = '';
  get innerHTML(): string {
    return this.html;
  }
  // regex parser. attributes must be double quoted and hold no >
  set innerHTML(markup: string) {
    this.html = markup;
    this.children.length = 0;
    const stack: FakeElement[] = [this];
    const tags = /<\/?([a-zA-Z][\w-]*)((?:\s+[\w-]+\s*=\s*"[^"]*")*)\s*\/?>/g;
    let hit: RegExpExecArray | null;
    while ((hit = tags.exec(markup)) !== null) {
      if (hit[0].startsWith('</')) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const el = new FakeElement();
      el.tagName = hit[1].toUpperCase();
      for (const attr of (hit[2] ?? '').matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
        if (attr[1] === 'class') el.className = attr[2];
        else if (attr[1] === 'id') el.id = attr[2];
        else if (attr[1].startsWith('data-')) el.dataset[attr[1].slice(5)] = attr[2];
        else el.setAttribute(attr[1], attr[2]);
      }
      stack[stack.length - 1].children.push(el);
      if (!/^(input|img|br|hr)$/.test(hit[1]) && !hit[0].endsWith('/>')) stack.push(el);
    }
  }
  type = '';
  checked = false;
  disabled = false;

  addEventListener(type: string, fn: Listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: Listener) {
    const list = this.listeners.get(type);
    if (!list) return;
    const idx = list.indexOf(fn);
    if (idx !== -1) list.splice(idx, 1);
  }
  dispatch(type: string, event: any = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }
  click() {
    this.dispatch('click');
  }
  focus() {}
  blur() {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }
  appendChild<T>(node: T): T {
    this.children.push(node as unknown as FakeElement);
    return node;
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const want = selector.trim().replace(/^\./, '');
    const out: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.className.split(/\s+/).includes(want) || child.id === want.replace(/^#/, '')) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

class FakeDocument extends FakeElement {
  private readonly byId = new Map<string, FakeElement>();
  getElementById(id: string): FakeElement {
    let el = this.byId.get(id);
    if (!el) {
      el = new FakeElement();
      this.byId.set(id, el);
    }
    return el;
  }
  createElement(tag: string): FakeElement {
    const el = new FakeElement();
    el.tagName = tag.toUpperCase();
    return el;
  }
}

function installFakeDom(): FakeDocument {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.HTMLElement ??= class {};
  globals.HTMLInputElement ??= class {};
  globals.HTMLTextAreaElement ??= class {};
  globals.HTMLDetailsElement ??= class {};
  const doc = new FakeDocument();
  globals.document = doc;
  return doc;
}

interface FakeIdbRequest {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: ((e: unknown) => void) | null;
  result: unknown;
}

function installFakeIndexedDb(): void {
  const store = new Map<string, unknown>();
  const objectStore = {
    put: (draft: { id: string }) => store.set(draft.id, draft),
    get: (id: string) => {
      const req: FakeIdbRequest = { onsuccess: null, onerror: null, onupgradeneeded: null, result: store.get(id) };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
    getAll: () => {
      const req: FakeIdbRequest = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        result: Array.from(store.values()),
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
    delete: (id: string) => store.delete(id),
  };
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction: () => {
      const tx: { oncomplete: (() => void) | null; onerror: (() => void) | null; objectStore: () => typeof objectStore } = {
        oncomplete: null,
        onerror: null,
        objectStore: () => objectStore,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      const req: FakeIdbRequest = { onsuccess: null, onerror: null, onupgradeneeded: null, result: database };
      queueMicrotask(() => {
        req.onupgradeneeded?.({ target: { result: database } });
        req.onsuccess?.();
      });
      return req;
    },
  };
}

function installFakeLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = storage;
  return store;
}

before(async () => {
  installFakeIndexedDb();
  installFakeLocalStorage();
  const { initDB } = await import('../web/lcp-editor/state.js');
  await initDB();
});

const EDITOR_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'lcp-editor');

interface EditorModule {
  planConversion: typeof import('../web/lcp-editor/io.js').planConversion;
  regenerateNpcFeatureArrays: typeof import('../web/lcp-editor/forms.js').regenerateNpcFeatureArrays;
}

let editorCache: EditorModule | undefined;

async function editor(): Promise<EditorModule> {
  if (editorCache === undefined) {
    const [io, forms, schema] = await Promise.all([
      import('../web/lcp-editor/io.js'),
      import('../web/lcp-editor/forms.js'),
      import('../web/lcp-editor/eidolon.js'),
    ]);
    schema.installEidolonData(JSON.parse(readFileSync(path.join(EDITOR_DIR, 'eidolon-data.json'), 'utf8')));
    editorCache = { planConversion: io.planConversion, regenerateNpcFeatureArrays: forms.regenerateNpcFeatureArrays };
  }
  return editorCache;
}

function draft(id: string, name: string, data: Record<string, unknown>) {
  return { id, name, version: '1.0', author: '', data } as never;
}

function findById(root: FakeElement, id: string): FakeElement | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const hit = findById(child, id);
    if (hit) return hit;
  }
  return undefined;
}

let dbReady: Promise<void> | undefined;

async function editorModules() {
  const state = (await import('../web/lcp-editor/state.js')) as typeof import('../web/lcp-editor/state.js');
  const ui = (await import('../web/lcp-editor/ui.js')) as typeof import('../web/lcp-editor/ui.js');
  const forms = (await import('../web/lcp-editor/forms.js')) as typeof import('../web/lcp-editor/forms.js');
  const io = (await import('../web/lcp-editor/io.js')) as typeof import('../web/lcp-editor/io.js');
  return { state, ui, forms, io };
}

async function ensureFakeDb() {
  if (dbReady === undefined) {
    installFakeIndexedDb();
    installFakeLocalStorage();
    const { state } = await editorModules();
    dbReady = state.initDB();
  }
  return dbReady;
}

test('zip import', async () => {
  const { normalizeArchivePath, collectArchiveJson, discoverPacks } = await import('../web/lcp-editor/io.js');

  assert.equal(normalizeArchivePath('a/../b.json'), 'b.json');
  assert.equal(normalizeArchivePath('../../escape/foo.json'), 'escape/foo.json');
  assert.equal(normalizeArchivePath('.\\a\\\\b.json'), 'a/b.json');

  installFakeDom();
  const escaping = new Map<string, Uint8Array>();
  collectArchiveJson(
    fflate.zipSync({
      'lcp_manifest.json': fflate.strToU8(JSON.stringify({ name: 'Root' })),
      '../../escape/lcp_manifest.json': fflate.strToU8(JSON.stringify({ name: 'Escape' })),
    }),
    '',
    0,
    escaping,
  );
  const escaped = discoverPacks(escaping);
  assert.equal(escaped.some((p) => p.dir.includes('..')), false);
  assert.ok(escaped.some((p) => p.dir === 'escape'));

  const doc = installFakeDom();
  const mixed = new Map<string, Uint8Array>();
  collectArchiveJson(
    fflate.zipSync({
      'lcp_manifest.json': fflate.strToU8(JSON.stringify({ name: 'Good Pack' })),
      'tags.json': fflate.strToU8('{ "bad": true, }'),
      'README.md': fflate.strToU8('hello world'),
    }),
    '',
    0,
    mixed,
  );
  const packs = discoverPacks(mixed);
  assert.equal(packs.length, 1);
  assert.deepEqual(Object.keys(packs[0]!.data).sort(), ['lcp_manifest.json']);

  const toast = doc.getElementById('error-toast').innerText;
  assert.match(toast, /tags\.json/);
  assert.match(toast, /README\.md/);
  assert.match(toast, /bad JSON/);
  assert.match(toast, /not JSON/);

  // core ships statuses with names only, nested under a versioned dir. refs resolve by id or not at all
  const official = new Map<string, Uint8Array>();
  collectArchiveJson(
    fflate.zipSync({
      'lancer-data-3.1.7/package.json': fflate.strToU8(JSON.stringify({ name: 'lancer-data' })),
      'lancer-data-3.1.7/lib/info.json': fflate.strToU8(JSON.stringify({ name: 'LANCER Core' })),
      'lancer-data-3.1.7/lib/statuses.json': fflate.strToU8(
        JSON.stringify([
          { name: 'Lock On' },
          { name: 'Slowed' },
          { name: 'Shut Down' },
          { name: 'Prone' },
          { id: 'kept', name: 'Already Identified' },
        ]),
      ),
    }),
    '',
    0,
    official,
  );
  const core = discoverPacks(official);
  assert.equal(core.length, 1, 'the versioned wrapper dir was taken for a pack');
  assert.deepEqual(
    core[0]!.data['statuses.json'].map((status: any) => status.id),
    ['lockon', 'slow', 'shut-down', 'prone', 'kept'],
    'uploaded statuses lost the ids every status ref resolves against',
  );
});

test('import and export round-trip', async () => {
  await ensureFakeDb();
  const doc = installFakeDom();
  const { state, ui, forms, io } = await editorModules();

  const pack = draft('round-trip', 'Round Trip', {
    'lcp_manifest.json': { name: 'Round Trip', v3: true },
    'manufacturers.json': [{ id: 'IPS-N', name: 'IPS-Northstar', description: 'd' }],
    'frames.json': [
      { id: 'mf_everest', name: 'Everest', source: 'IPS-N', stats: { size: 1, structure: 4, stress: 4, hp: 10 } },
      { id: 'missing_frame', name: 'ERR: DATA NOT FOUND' },
    ],
    'pilot_gear.json': [{ id: 'pg_case', name: 'Ghost Case', type: 'armor', integrated: ['pg_ghost_chip'] }],
    'systems.json': [{ id: 'ms_nest', name: 'Drone Nest', deployables: ['dep_missing_drone'] }],
    'mods.json': [{ id: 'wm_hook', name: 'Hook', restricted_sizes: ['Superheavy'] }],
  });
  state.setCurrentPack(pack);
  ui.setLibraryDrafts([]);

  assert.equal(forms.layoutFor('manufacturers.json', 'v3')?.prefix, '');
  assert.equal(forms.autoIdFor('manufacturers.json', 'IPS-N'), 'ips_n');

  ui.selectCategory('frames.json');
  ui.selectItem(0);
  const container = doc.getElementById('form-container');
  const structure = findById(container, forms.controlId('stats.structure'));
  assert.ok(structure, 'invisible field = dropped on edit');
  assert.ok(findById(container, forms.controlId('stats.stress')));
  assert.equal(structure!.value, '4');
  structure!.value = '5';
  structure!.dispatch('input');
  structure!.dispatch('change');

  ui.selectCategory('mods.json');
  ui.selectItem(0);
  const modForm = doc.getElementById('form-container');
  assert.ok(
    findById(modForm, forms.controlId('restricted_sizes')),
  );
  assert.equal(findById(modForm, forms.controlId('allowed_sizes')), undefined);

  ui.selectCategory('frames.json');
  ui.selectItem(0);
  const listed = doc.getElementById('master-list').children.map((row: any) => row.innerHTML).join(' ');
  assert.equal(listed.includes('DATA NOT FOUND'), false, 'comp/con hides these');
  assert.match(listed, /Everest/);

  const texts = io.exportFileTexts((pack as any).data);
  assert.equal(JSON.parse(texts['manufacturers.json'])[0].id, 'IPS-N');
  assert.equal(JSON.parse(texts['frames.json'])[1].id, 'missing_frame');
  const exported = JSON.parse(texts['frames.json'])[0];
  assert.equal(exported.source, 'IPS-N');
  assert.equal(exported.stats.structure, 5);
  assert.equal(exported.stats.stress, 4);

  ui.switchTab('export');
  const problems = doc.getElementById('export-problems');
  const reported = problems.children.map((c: any) => `${c.innerHTML} ${c.textContent}`).join(' ');
  for (const bit of ['Ghost Case', 'integrated', 'pg_ghost_chip', 'Drone Nest', 'deployables', 'dep_missing_drone']) {
    assert.ok(reported.includes(bit), bit);
  }
  assert.equal(doc.getElementById('export-notices').children.length, 0);

  const legacy = draft('round-trip-v2', 'Round Trip V2', {
    'lcp_manifest.json': { name: 'Round Trip V2' },
    'frames.json': [{ id: 'mf_everest', name: 'Everest', stats: { size: 1, hp: 10 } }],
  });
  state.setCurrentPack(legacy);
  ui.selectCategory('frames.json');
  ui.selectItem(0);
  const legacyForm = doc.getElementById('form-container');
  assert.ok(findById(legacyForm, forms.controlId('stats.hp')));
  assert.equal(
    findById(legacyForm, forms.controlId('stats.structure')),
    undefined,
  );

  state.setCurrentPack(null);
  ui.setLibraryDrafts([]);
});

test('v2 to v3 conversion', async () => {
  const state = await import('../web/lcp-editor/state.js');
  const mod = await editor();

  assert.equal(state.manifestIsDecisive(undefined), false);
  assert.equal(state.manifestIsDecisive({ name: 'P' }), false);
  assert.equal(state.manifestIsDecisive({ name: 'P', v3: true }), true);
  assert.equal(state.manifestIsDecisive({ name: 'P', v3: false }), true);
  assert.equal(state.manifestIsDecisive([1, 2]), true);
  assert.equal(state.manifestIsDecisive(null), true);
  assert.equal(state.packFormatOf({ id: 'x', name: 'P', version: '1', author: '', data: {} } as never), 'v3');
  assert.equal(
    state.packFormatOf({
      id: 'x',
      name: 'P',
      version: '1',
      author: '',
      format: 'v3',
      data: { 'lcp_manifest.json': { name: 'P' } },
    } as never),
    'v3',
  );

  const plan = mod.planConversion(
    draft('v2-source', 'V2 Source', {
      'lcp_manifest.json': { name: 'V2 Source' },
      'statuses.json': [
        { name: 'Caf\u00e9', type: 'Status', effects: 'E' },
        { name: 'DOWN AND OUT (PILOTS ONLY)', type: 'Status', effects: 'E' },
      ],
      'systems.json': [
        {
          id: 'ms_personalizations',
          name: 'PERSONALIZATIONS',
          type: 'System',
          sp: 1,
          effect: { effect_type: 'Bonus', hp: 2, detail: 'You gain +2 HP...' },
        },
        { id: 'ms_weird', name: 'WEIRD', type: 'System', sp: 1, effect: { effect_type: 'Something', note: 'unknown shape' } },
      ],
      'skills.json': [{ id: 'sk_charm', name: 'CHARM' }],
      'backgrounds.json': [
        { id: 'pbg_x', name: 'X', description: 'D', triggers: 'Example triggers: Charm, Get Somewhere Fast' },
      ],
    }),
    'v3',
  );

  const statuses = plan.data['statuses.json'] as Record<string, any>[];
  assert.equal(statuses[0]!['id'], 'cafe', 'nfd');
  assert.equal(statuses[1]!['id'], 'downandout', 'parens are not part of the id');

  const systems = plan.data['systems.json'] as Record<string, any>[];
  const mapped = systems.find((item) => item['id'] === 'ms_personalizations')!;
  const unmapped = systems.find((item) => item['id'] === 'ms_weird')!;
  assert.equal(mapped['effect'], 'You gain +2 HP...');
  assert.deepEqual(mapped['bonuses'], [{ id: 'hp', val: 2 }]);
  assert.deepEqual(unmapped['effect'], { effect_type: 'Something', note: 'unknown shape' });

  const background = (plan.data['backgrounds.json'] as Record<string, any>[])[0]!;
  assert.deepEqual(background['skills'], ['sk_charm']);
  assert.ok(
    background['description'].includes('Example triggers: Get Somewhere Fast'),
  );
  assert.equal(
    background['description'].includes('sk_get_somewhere_fast'),
    false,
  );

  const labels = plan.rows.map((row) => row.label);
  assert.ok(labels.some((label) => label.includes('systems.json effect object (Bonus) -> effect text + bonuses rows')));
  assert.ok(
    labels.some((label) => label.includes('systems.json effect object (effect_type Something) left v2-shaped')),
  );

  const odd = mod.planConversion(
    draft('v2-array-manifest', 'Array Manifest', { 'lcp_manifest.json': [1, 2], 'weapons.json': [] }),
    'v3',
  );
  assert.deepEqual(odd.data['lcp_manifest.json'], [1, 2]);
  assert.equal(odd.rows.find((row) => row.kind === 'transformed' && row.label.includes('v3 flag added')), undefined);
  assert.ok(
    odd.rows.find((row) => row.kind === 'dropped' && row.label.includes('v3 flag not added')),
  );
});

test('v3 to v2 conversion', async () => {
  const mod = await editor();

  const plan = mod.planConversion(
    draft('v3-source', 'V3 Source', {
      'lcp_manifest.json': { name: 'V3 Source', v3: true },
      'core_bonuses.json': [
        {
          id: 'cb_x',
          name: 'CB',
          effect: 'Base effect.',
          bonuses: [{ id: 'pilot_hp', val: 3 }, { id: 'zz_unknown_id', val: 1 }],
          active_effects: [{ name: 'Aura', detail: 'It glows.' }],
          synergies: [{ locations: ['weapon'], detail: 'Works with weapons.' }],
          actions: [{ name: 'Flare', activation: 'Quick', detail: 'Pop a flare.' }],
        },
      ],
      'systems.json': [
        { id: 'ms_x', name: 'S', effect: 'Sys effect.', active_effects: [{ name: 'Hum', detail: 'It hums.' }] },
      ],
      'npcc_avenger.json': [
        {
          id: 'nrfaw-npc_npcc_avenger',
          name: 'Avenger',
          role: 'striker',
          info: { flavor: 'F', tactics: 'T', terse: 'X' },
          stats: {
            armor: [0, 0, 0],
            hp: [15, 18, 21],
            evade: [10, 12, 15],
            edef: [8, 10, 12],
            heatcap: [6, 6, 8],
            speed: [5, 5, 5],
            sensor: [10, 10, 10],
            save: [10, 12, 14],
            hull: [1, 2, 3],
            agility: [1, 3, 5],
            systems: [0, 0, 0],
            engineering: [0, 0, 0],
            size: 1,
            activations: [1, 1, 1],
          },
        },
        {
          id: 'nrfaw-npc_npcf_slug_pistol_avenger',
          name: 'Slug Pistol',
          origin: 'nrfaw-npc_npcc_avenger',
          type: 'Weapon',
          tags: [{ id: 'tg_ap' }],
          weapon_type: 'Auxiliary CQB',
          attack_bonus: [2, 3, 4],
          damage: [{ type: 'Kinetic', val: [4, 5, 6] }],
          range: [{ type: 'Range', val: 8 }, { type: 'Threat', val: 3 }],
          base: true,
        },
        {
          id: 'nrfaw-npc_npcf_assault_armor_avenger',
          name: 'Assault Armor',
          origin: 'nrfaw-npc_npcc_avenger',
          type: 'Trait',
          effect: 'The Avenger has RESISTANCE to all damage originating within Range 3.',
          base: false,
        },
      ],
    }),
    'v2',
  );

  const bonus = (plan.data['core_bonuses.json'] as Record<string, any>[])[0]!;
  const system = (plan.data['systems.json'] as Record<string, any>[])[0]!;
  for (const key of ['bonuses', 'active_effects', 'synergies', 'actions']) assert.equal(key in bonus, false);
  assert.equal('active_effects' in system, false);
  assert.ok(bonus['effect'].startsWith('Base effect.'));
  assert.ok(bonus['effect'].includes('Pilot HP 3'));
  assert.ok(bonus['effect'].includes('zz_unknown_id'));
  assert.ok(bonus['effect'].includes('Aura: It glows.'));
  assert.ok(bonus['effect'].includes('Works with weapons.'));
  assert.ok(bonus['effect'].includes('Pop a flare.'));
  assert.ok(system['effect'].includes('Hum: It hums.'));

  for (const row of plan.rows.filter((entry) => entry.kind === 'dropped')) {
    assert.equal(
      /core_bonuses\.json (bonuses|active_effects|synergies|actions)|systems\.json active_effects/.test(row.label),
      false,
      `${row.label} is still reported as a drop after the fold landed`,
    );
  }
  assert.ok(plan.rows.filter((row) => row.kind === 'transformed' && row.label.includes('folded into effect')).length >= 5);

  assert.equal(plan.data['npcc_avenger.json'], undefined);
  const classes = plan.data['npc_classes.json'] as Record<string, any>[];
  assert.equal(classes.length, 1);
  const cls = classes[0]!;
  assert.equal(cls['id'], 'nrfaw-npc_npcc_avenger');
  assert.deepEqual(cls['stats'].size, [[1], [1], [1]]);
  assert.equal(typeof cls['power'], 'number');
  assert.deepEqual(cls['base_features'], ['nrfaw-npc_npcf_slug_pistol_avenger']);
  assert.deepEqual(cls['optional_features'], ['nrfaw-npc_npcf_assault_armor_avenger']);

  const features = plan.data['npc_features.json'] as Record<string, any>[];
  assert.equal(features.length, 2);
  const weapon = features.find((entry) => entry['id'] === 'nrfaw-npc_npcf_slug_pistol_avenger')!;
  assert.deepEqual(weapon['origin'], { type: 'Class', name: 'Avenger', base: true });
  assert.equal(weapon['locked'], false);
  assert.ok(
    Array.isArray(weapon['damage']) && weapon['damage'][0]['damage'].length === 3,
    'v2 quirk: tiered damage rows',
  );
  assert.equal(weapon['base'], undefined);
  const trait = features.find((entry) => entry['id'] === 'nrfaw-npc_npcf_assault_armor_avenger')!;
  assert.deepEqual(trait['origin'], { type: 'Class', name: 'Avenger', base: false });
  assert.equal(trait['damage'], undefined);
  assert.equal(
    plan.rows.find((row) => row.kind === 'dropped' && row.label === 'npcc_avenger.json (aggregate NPC file, folded into standard files)')?.count,
    3,
  );
});

test('renaming follows ids', async () => {
  await ensureFakeDb();
  const doc = installFakeDom();
  const { state, ui, forms, io } = await editorModules();

  const retype = (fieldId: string, value: string) => {
    const input = findById(doc.getElementById('form-container'), forms.controlId(fieldId))!;
    input.value = value;
    input.dispatch('input');
    input.dispatch('change');
  };

  const host = draft('rename-class', 'Rename Class', {
    'lcp_manifest.json': { name: 'Rename Class', v3: true },
    'npc_classes.json': [],
    'npc_features.json': [],
  });
  state.setCurrentPack(host);
  io.applyImport(
    {
      root: { cat: 'npc_classes.json', item: { id: 'npcc_ace', name: 'Ace', role: 'striker', stats: {} }, pack: 'src' },
      imports: [
        { cat: 'npc_features.json', item: { id: 'npcf_ace_trait', name: 'Ace Trait', origin: 'npcc_ace', base: true, type: 'Trait' }, pack: 'src' },
      ],
      present: [],
      unresolved: [],
      rulesTerms: [],
    } as never,
    'npc_classes.json',
    true,
  );
  ui.selectCategory('npc_classes.json');
  ui.selectItem(0);
  retype('name', 'Baby');
  const cls = (host as any).data['npc_classes.json'][0];
  assert.equal(cls.id, 'npcc_baby');
  assert.equal(
    (host as any).data['npc_features.json'][0].origin,
    'npcc_baby',
    "the imported feature's origin did not retarget to the renamed class id",
  );

  const licensed = draft('rename-frame', 'Rename Frame', {
    'lcp_manifest.json': { name: 'Rename Frame', v3: true },
    'frames.json': [{ id: 'mf_drake', name: 'Drake', source: 'IPS-N', license_level: 2 }],
    'weapons.json': [{ id: 'mw_lance', name: 'Lance', license: 'Drake', license_id: 'mf_drake', license_level: 1, source: 'IPS-N' }],
    'systems.json': [{ id: 'ms_bunker', name: 'Portable Bunker', license: 'Drake', license_id: 'mf_drake', license_level: 2, source: 'IPS-N' }],
    'mods.json': [{ id: 'wm_hook', name: 'Hook', license: 'Drake', license_id: 'mf_drake', license_level: 3, source: 'IPS-N' }],
  });
  state.setCurrentPack(licensed);
  ui.selectCategory('frames.json');
  ui.selectItem(0);
  retype('name', 'Corsair');
  assert.equal((licensed as any).data['frames.json'][0].id, 'mf_corsair');
  for (const cat of ['weapons.json', 'systems.json', 'mods.json']) {
    const item = (licensed as any).data[cat][0];
    assert.equal(item.license_id, 'mf_corsair');
    assert.equal(item.license, 'Corsair');
  }

  const tagged = draft('rename-tag', 'Rename Tag', {
    'lcp_manifest.json': { name: 'Rename Tag', v3: true },
    'tags.json': [{ id: 'tg_reliable', name: 'Reliable', description: 'D' }],
    'weapons.json': [{ id: 'mw_x', name: 'X', tags: [{ id: 'tg_reliable', val: 2 }] }],
  });
  state.setCurrentPack(tagged);
  ui.selectCategory('tags.json');
  ui.selectItem(0);
  retype('name', 'Reliable Renamed');
  const tag = (tagged as any).data['tags.json'][0];
  assert.notEqual(tag.id, 'tg_reliable');
  assert.equal((tagged as any).data['weapons.json'][0].tags[0].id, tag.id);

  const vocab = draft('rename-status', 'Rename Status', {
    'lcp_manifest.json': { name: 'Rename Status', v3: true },
    'statuses.json': [{ id: 'prone', name: 'Prone', type: 'Status', effects: 'E' }],
    'npc_features.json': [{ id: 'npcf_x', name: 'X', type: 'Trait', add_resist: [{ immunity: 'prone', target: 'self' }] }],
  });
  state.setCurrentPack(vocab);
  ui.selectCategory('statuses.json');
  ui.selectItem(0);
  retype('id', 'prone_v2');
  assert.equal((vocab as any).data['npc_features.json'][0].add_resist[0].immunity, 'prone');

  const guard = draft('rename-guard', 'Rename Guard', {
    'lcp_manifest.json': { name: 'Rename Guard' },
    'weapons.json': [{ id: 'mw_gun_v2', name: 'Gun' }],
  }) as any;
  forms.rewriteIdReferences(guard.data, new Map([['mw_gun_v2', 'mw_gun_v3']]));
  assert.equal(
    guard.data['weapons.json'][0].id,
    'mw_gun_v2',
    'the old double-rewrite bug',
  );

  const prefixed = draft('reprefix-pack', 'Reprefix Pack', {
    'lcp_manifest.json': { name: 'Reprefix Pack', item_prefix: 'old' },
    'tags.json': [{ id: 'old_tg_x', name: 'X' }],
    'deployables.json': [{ id: 'old_dep_drone', name: 'Drone' }],
    'weapons.json': [
      {
        id: 'old_mw_gun',
        name: 'Gun',
        tags: [{ id: 'old_tg_x' }],
        integrated: ['old_ms_core'],
        deployables: ['old_dep_drone'],
        synergies: [{ locations: ['old_mw_gun'] }],
      },
    ],
    'systems.json': [{ id: 'old_ms_core', name: 'Core' }],
    'npc_classes.json': [{ id: 'old_npcc_boss', name: 'Boss', base_features: ['old_npcf_trait'], optional_features: [] }],
    'npc_features.json': [{ id: 'old_npcf_trait', name: 'Trait', origin: 'old_npcc_boss' }],
    'reserves.json': [{ id: 'reserve_untouched', name: 'Untouched' }],
  }) as any;
  forms.reprefixPack(prefixed, 'old', 'new');
  assert.equal(prefixed.data['tags.json'][0].id, 'new_tg_x');
  assert.equal(prefixed.data['deployables.json'][0].id, 'new_dep_drone');
  assert.equal(prefixed.data['npc_features.json'][0].id, 'new_npcf_trait');
  assert.equal(prefixed.data['reserves.json'][0].id, 'reserve_untouched');
  const gun = prefixed.data['weapons.json'][0];
  assert.equal(gun.tags[0].id, 'new_tg_x');
  assert.deepEqual(gun.integrated, ['new_ms_core']);
  assert.deepEqual(gun.deployables, ['new_dep_drone']);
  assert.equal(gun.synergies[0].locations[0], 'new_mw_gun');
  assert.deepEqual(prefixed.data['npc_classes.json'][0].base_features, ['new_npcf_trait']);
  assert.equal(prefixed.data['npc_features.json'][0].origin, 'new_npcc_boss');

  state.setCurrentPack(null);
});

test('categories and the rail', async () => {
  await ensureFakeDb();
  const doc = installFakeDom();
  const { state, ui, io } = await editorModules();

  const pack = draft('rail-pack', 'Rail Pack', {
    'lcp_manifest.json': { name: 'Rail Pack', v3: true },
    'weapons.json': [{ id: 'mw_ok', name: 'Fine' }],
    'systems.json': [{ name: 'No Id At All' }],
  });
  state.setCurrentPack(pack);
  ui.setLibraryDrafts([]);

  const creating = ui.promptCreateCategory();
  (doc.getElementById('prompt-input') as unknown as { value: string }).value = 'Homebrew Lore';
  doc.getElementById('btn-prompt-ok').click();
  await creating;

  const data = (pack as any).data;
  assert.ok('homebrew_lore.json' in data);
  (data['homebrew_lore.json'] as unknown[]).push({ id: 'hl_1', name: 'Lore Entry' });
  assert.equal(ui.categoryDeletable('homebrew_lore.json'), true);
  assert.equal(ui.categoryDeletable('lcp_manifest.json'), false);
  assert.equal(ui.categoryDeletable('npc_classes.json'), true);

  ui.renderEditorRail();
  ui.selectCategory('weapons.json');
  ui.validateCurrentPack();
  const systems = doc.getElementById('rail-systems.json');
  assert.match(systems.innerHTML, /badge err/);
  assert.match(systems.innerHTML, /1!/);

  const deleting = ui.confirmDeleteCategory('homebrew_lore.json');
  doc.getElementById('btn-confirm-ok').click();
  await deleting;
  assert.equal('homebrew_lore.json' in data, false);

  data['origin_notes.json'] = [{ id: 'on_1', name: 'Note', origin: 'a village' }];
  assert.equal(
    ui.npcAggregateFiles(pack as never).includes('origin_notes.json'),
    false,
    'origin alone is not an npc signal',
  );
  assert.ok(ui.railCategories(pack as never).includes('origin_notes.json'));
  delete data['origin_notes.json'];

  const texts = io.exportFileTexts(data);
  assert.equal('homebrew_lore.json' in texts, false);
  assert.deepEqual(Object.keys(texts).sort(), Object.keys(data).sort());

  state.setCurrentPack(null);
  ui.setLibraryDrafts([]);
});

test('json edits regenerate feature arrays', async () => {
  installFakeDom();
  const state = await import('../web/lcp-editor/state.js');
  const { regenerateNpcFeatureArrays } = await editor();

  const pack = draft('json-edit', 'Json Edit', {
    'lcp_manifest.json': { name: 'Json Edit' },
    'npc_classes.json': [
      { id: 'npcc_test', name: 'Test', role: 'test', stats: {}, base_features: ['npcf_stale_ghost'], optional_features: ['npcf_stale_ghost'] },
    ],
    'npc_features.json': [{ id: 'npcf_live', origin: 'npcc_test', base: true, type: 'trait', tags: [] }],
  });
  state.setCurrentPack(pack);
  state.setCurrentCategory('npc_classes.json');
  state.setCurrentItemIndex(0);

  (document.getElementById('json-textarea') as unknown as { value: string }).value = JSON.stringify({
    id: 'npcc_test',
    name: 'Test Renamed',
    role: 'test',
    stats: {},
    base_features: ['npcf_stale_ghost'],
    optional_features: ['npcf_stale_ghost'],
  });
  assert.equal(state.applyJsonEdit(), true);

  const owner = (state.currentPack!.data['npc_classes.json'] as any[])[0];
  assert.equal(owner.name, 'Test Renamed');
  assert.deepEqual(owner.base_features, ['npcf_live']);
  assert.deepEqual(owner.optional_features, []);

  const templated = draft('regen-template', 'Regen Template', {
    'lcp_manifest.json': { name: 'Regen Template', v3: true },
    'npc_classes.json': [{ id: 'npcc_test', name: 'Test Class', role: 'striker', stats: {}, base_features: ['npcf_gone'], optional_features: [] }],
    'npc_templates.json': [{ id: 'npct_test', name: 'Test Template', template: true, description: '', base_features: ['npcf_gone'], optional_features: [] }],
    'npc_features.json': [
      { id: 'npcf_a', name: 'A', origin: 'npcc_test', base: true, type: 'Trait', effect: '' },
      { id: 'npcf_b', name: 'B', origin: 'npcc_test', base: false, type: 'Trait', effect: '' },
      { id: 'npcf_c', name: 'C', origin: 'npct_test', base: true, type: 'Trait', effect: '' },
      { id: 'npcf_d', name: 'D', origin: 'npct_test', base: false, type: 'Trait', effect: '' },
    ],
  }) as any;
  regenerateNpcFeatureArrays(templated);
  assert.deepEqual(templated.data['npc_classes.json'][0].base_features, ['npcf_a']);
  assert.deepEqual(templated.data['npc_classes.json'][0].optional_features, ['npcf_b']);
  assert.deepEqual(templated.data['npc_templates.json'][0].base_features, ['npcf_c']);
  assert.deepEqual(templated.data['npc_templates.json'][0].optional_features, ['npcf_d']);

  state.setCurrentPack(null);
});

test('drafts persist', async () => {
  const doc = installFakeDom();
  const state = await import('../web/lcp-editor/state.js');
  const forms = await import('../web/lcp-editor/forms.js');

  const [first, second] = await Promise.all([state.createNewPack('v3'), state.createNewPack('v3')]);
  assert.notEqual(first, null);
  assert.equal(second, null);
  const id = first!.id;
  assert.equal((await state.getDrafts()).filter((entry) => entry.id.startsWith('draft:new:')).length, 1);

  forms.queuePackSave();
  await new Promise((resolve) => setTimeout(resolve, forms.PACK_SAVE_DEBOUNCE_MS + 30));

  state.setCurrentPack(null);
  await state.restoreOpenDraft();
  assert.equal(state.currentPack?.id, id);
  assert.equal((await state.getDrafts()).filter((entry) => entry.id === id).length, 1);

  const io = await import('../web/lcp-editor/io.js');
  const source = draft('convert-source', 'Convert Source', {
    'lcp_manifest.json': { name: 'Convert Source' },
    'weapons.json': [{ id: 'mw_x', name: 'X' }],
  });
  state.setCurrentPack(source);
  io.setConvertPlan(io.planConversion(source, 'v3'));
  await io.runConversion();
  await new Promise((resolve) => setTimeout(resolve, 5));

  const replacing = io.runConversion();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(
    doc.getElementById('confirm-message').innerText,
    /Replace the existing v3 draft/,
    'kept piling up drafts',
  );
  doc.getElementById('btn-confirm-ok').click();
  await replacing;

  const converted = (await state.getDrafts()).filter((entry) => entry.id.startsWith('draft:convert:'));
  assert.equal(converted.length, 1);

  await state.deleteDraft(converted[0]!.id);
  await state.deleteDraft(id);
  state.setCurrentPack(null);
  state.forgetOpenDraft();
});

test('reference data', async () => {
  const { dedupeVocab } = await import('../web/lcp-editor/state.js');
  assert.deepEqual(dedupeVocab(['kinetic', 'Kinetic']), ['Kinetic']);
  assert.deepEqual(dedupeVocab(['Variable', 'variable', 'Burn']), ['Burn', 'Variable']);
  assert.deepEqual(dedupeVocab([]), []);

  const table = JSON.parse(readFileSync(path.join(EDITOR_DIR, 'eidolon-data.json'), 'utf8')).layerStatTable;
  assert.deepEqual(
    table.blurred?.rows,
    [{ id: 'evade', val: 20, override: true }, { id: 'speed', val: 10, override: true }],
    'blurred went missing once already',
  );
  for (const [layer, entry] of Object.entries(table) as [string, any][]) {
    assert.ok(entry.rows.length > 0, `${layer} carries an empty stat row list`);
  }
});
