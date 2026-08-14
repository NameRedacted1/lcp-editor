import { asText, flushPackSave, deriveFeatureLinks, packItemPrefixRaw, countText, firstFreeId, isPlainObject, slugifyName, uniqueSiblingId } from './forms.js';
import { currentPack, PackDraft, PackFormat, EIDOLON_LAYERS, V2_CLASS_POWER, closeModal, currentFormat, customPrompt, fillOptions, getDrafts, openDraft, referenceIndex, showModal, showToast } from './state.js';
import { selectItem, libraryDrafts, renderEditorRail, eidolonUnlocked, selectCategory, slotIndexOf, standardListFor, validateCurrentPack } from './ui.js';
import { packIdSet } from './io.js';
import { FieldSpec, ReferenceBlock } from './fields.js';
import { v2Feature, v2Stats } from './v2.js';

interface EidolonLayerStatRow {
  id: string;
  val: number | number[];
  override?: boolean;
}

interface EidolonLayerStatEntry {
  rows: EidolonLayerStatRow[];
}

// keyed by slug of the layer NAME, not id. two layers named the same would collide
const EIDOLON_LAYER_STAT_TABLE: Record<string, EidolonLayerStatEntry> = {};

function eidolonLayerStatRows(name: string): EidolonLayerStatRow[] {
  const entry = EIDOLON_LAYER_STAT_TABLE[slugifyName(name)];
  return entry === undefined ? [] : entry.rows.map((row) => ({ ...row }));
}

interface EidolonStatBlock {
  hp: number[];
  size: number;
  armor: number;
  heatcap: number;
  speed: number;
  sensor: number;
  evasion: number[];
  edef: number[];
  save: number[];
  skills: number[];
}

const EMPTY_STATS: EidolonStatBlock = {
  hp: [], size: 0, armor: 0, heatcap: 0, speed: 0, sensor: 0, evasion: [], edef: [], save: [], skills: [],
};

const EIDOLON_LAYER_STATS: EidolonStatBlock = { ...EMPTY_STATS };
const EIDOLON_SHARD_STATS: EidolonStatBlock = { ...EMPTY_STATS };
let EIDOLON_STRUCTURE = 0;
let EIDOLON_STRESS = 0;
// all set by installEidolonData, no useful defaults
let EIDOLON_HP_PER_PLAYER = 0;
let EIDOLON_ROLE = '';
const EIDOLON_CLASS_SIZES: { classSize: number; layers: number }[] = [];

function eidolonSignedText(values: number[]): string {
  return values.map((value) => (value < 0 ? String(value) : `+${value}`)).join('/');
}

function eidolonSizeText(size: number): string {
  return size === 0.5 ? '1/2' : String(size);
}

function eidolonShardStatRow(block: EidolonStatBlock): string {
  return `HP ${countText(block.hp)} | Size ${eidolonSizeText(block.size)} | Armor ${block.armor} | Heat Cap ${block.heatcap} | Speed ${block.speed} | Sensors ${block.sensor}`;
}

function eidolonDefenceRow(block: EidolonStatBlock): string {
  return `Evasion ${countText(block.evasion)} | E-Def ${countText(block.edef)} | Save ${countText(block.save)}`;
}

function eidolonReference(): ReferenceBlock[] {
  return [
  {
    title: 'Layer stats (T1/T2/T3)',
    rows: [
      `All stats ${eidolonSignedText(EIDOLON_LAYER_STATS.skills)}`,
      `HP ${countText(EIDOLON_LAYER_STATS.hp)}, +${EIDOLON_HP_PER_PLAYER} per player`,
      `Size ${eidolonSizeText(EIDOLON_LAYER_STATS.size)} | Armor ${EIDOLON_LAYER_STATS.armor} | Heat Cap ${EIDOLON_LAYER_STATS.heatcap} | Speed ${EIDOLON_LAYER_STATS.speed} | Sensors ${EIDOLON_LAYER_STATS.sensor}`,
      eidolonDefenceRow(EIDOLON_LAYER_STATS),
      `Structure ${EIDOLON_STRUCTURE} | Stress ${EIDOLON_STRESS}`,
    ],
  },
  {
    title: 'Shard stats (T1/T2/T3)',
    rows: [
      `All stats ${eidolonSignedText(EIDOLON_SHARD_STATS.skills)}`,
      eidolonShardStatRow(EIDOLON_SHARD_STATS),
      eidolonDefenceRow(EIDOLON_SHARD_STATS),
    ],
  },
  ];
}

export const EIDOLON_REFERENCE: ReferenceBlock[] = [];

interface EidolonData {
  layerStatTable: Record<string, EidolonLayerStatEntry>;
  layerStats: EidolonStatBlock;
  shardStats: EidolonStatBlock;
  structure: number;
  stress: number;
  hpPerPlayer: number;
  role: string;
  classSizes: typeof EIDOLON_CLASS_SIZES;
}

let eidolonDataReady = false;
let eidolonDataRequest: Promise<void> | null = null;

export function installEidolonData(data: EidolonData): void {
  Object.assign(EIDOLON_LAYER_STAT_TABLE, data.layerStatTable);
  Object.assign(EIDOLON_LAYER_STATS, data.layerStats);
  Object.assign(EIDOLON_SHARD_STATS, data.shardStats);
  EIDOLON_STRUCTURE = data.structure;
  EIDOLON_STRESS = data.stress;
  EIDOLON_HP_PER_PLAYER = data.hpPerPlayer;
  EIDOLON_ROLE = data.role;
  EIDOLON_CLASS_SIZES.splice(0, EIDOLON_CLASS_SIZES.length, ...data.classSizes);
  EIDOLON_REFERENCE.splice(0, EIDOLON_REFERENCE.length, ...eidolonReference());
  eidolonDataReady = true;
}

export function ensureEidolonData(): Promise<void> {
  if (eidolonDataReady) return Promise.resolve();
  eidolonDataRequest ??= fetch('./eidolon.json', { credentials: 'same-origin' })
    .then((response) => {
      if (!response.ok) throw new Error(`Eidolon data unavailable (${response.status})`);
      return response.json() as Promise<EidolonData>;
    })
    .then(installEidolonData)
    .catch((error: unknown) => {
      eidolonDataRequest = null;
      throw error;
    });
  return eidolonDataRequest;
}

const EIDOLON_BONUS_COLUMNS: FieldSpec[] = [
  { key: 'id', label: 'Stat', kind: 'text' },
  { key: 'val', label: 'Value', kind: 'number' },
  { key: 'override', label: 'Override', kind: 'checkbox' },
];

const EIDOLON_ACTION_COLUMNS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'activation', label: 'Activation', kind: 'select', vocab: 'activations' },
  { key: 'detail', label: 'Detail', kind: 'textarea', wide: true },
];

export function eidolonFeatureIdBase(owner: any, name: string): string {
  const ownerId = asText(owner?.id).trim();
  const slug = slugifyName(name) || 'feature';
  return [ownerId, slug].filter((part) => part !== '').join('_');
}

export function eidolonFeatureSeed(owner: any): any {
  const layerId = asText(owner?.id).trim();
  const siblings = Array.isArray(owner?.features) ? owner.features : [];
  const name = 'New Feature';
  const id = uniqueSiblingId(siblings, eidolonFeatureIdBase(owner, name), undefined);
  const type = referenceIndex.featureTypes[0] ?? '';
  const feature: any = { id, name, type, effect: '' };
  if (layerId !== '') feature.origin = layerId;
  return feature;
}

export const EIDOLON_FEATURE_COLUMNS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'id', label: 'ID', kind: 'id' },
  { key: 'type', label: 'Type', kind: 'select', vocab: 'featureTypes' },
  { key: 'trigger', label: 'Trigger', kind: 'textarea', wide: true, optional: true },
  { key: 'weapon_type', label: 'Weapon Type', kind: 'select', vocab: 'memeticTypes', optional: true },
  { key: 'attacks', label: 'Attacks', kind: 'number', min: 1, max: 9, optional: true },
  { key: 'attack_bonus', label: 'Attack Bonus', kind: 'tierscalar', optional: true },
  { key: 'accuracy', label: 'Accuracy', kind: 'tierscalar', optional: true },
  { key: 'damage', label: 'Damage', kind: 'damage', wide: true, addLabel: '+ Damage', tiered: true, optional: true },
  { key: 'range', label: 'Range', kind: 'range', wide: true, addLabel: '+ Range', optional: true },
  { key: 'effect', label: 'Effect', kind: 'textarea', wide: true, optional: true },
  { key: 'detail', label: 'Detail', kind: 'textarea', wide: true, optional: true },
  { key: 'on_attack', label: 'On Attack', kind: 'textarea', wide: true, optional: true },
  {
    key: 'on_hit',
    label: 'On Hit',
    kind: 'group',
    wide: true,
    optional: true,
    fields: [{ key: 'detail', label: 'Detail', kind: 'textarea', wide: true }],
  },
  {
    key: 'actions',
    label: 'Action',
    kind: 'rows',
    wide: true,
    optional: true,
    addLabel: '+ Action',
    columns: EIDOLON_ACTION_COLUMNS,
  },
  {
    key: 'bonuses',
    label: 'Bonus',
    kind: 'rows',
    wide: true,
    optional: true,
    addLabel: '+ Bonus',
    columns: EIDOLON_BONUS_COLUMNS,
  },
  { key: 'tags', label: 'Tags', kind: 'tags', wide: true, optional: true },
];

interface EidolonLayerChoice {
  id: string;
  name: string;
  pack: string;
  layer: any;
}

interface EidolonAssemblySpec {
  name: string;
  classSize: number;
  layers: EidolonLayerChoice[];
  prefix?: string;
  format?: PackFormat;
}

interface EidolonAssembly {
  classes: any[];
  features: any[];
}

const EIDOLON_CARRY_KEYS = [ // copied through untouched
  'type',
  'weapon_type',
  'attacks',
  'attack_bonus',
  'accuracy',
  'damage',
  'range',
  'effect',
  'trigger',
  'on_hit',
  'on_crit',
  'actions',
  'bonuses',
  'tags',
  'active_effects',
  'add_status',
  'add_resist',
  'add_other',
  'added_tags',
  'added_damage',
  'bonus_damage',
  'deployables',
  'mod',
];

function eidolonId(prefix: string, kind: string, parts: string[]): string {
  return [prefix, kind, ...parts].filter((part) => part !== '').join('_');
}

function eidolonSlotSlug(index: number, name: string): string {
  return `l${index + 1}_${slugifyName(name) || 'layer'}`;
}

// hull/agility/systems/engineering all take the same skills array
function eidolonNpcStats(block: EidolonStatBlock): any {
  return {
    hp: [...block.hp],
    armor: block.armor,
    structure: EIDOLON_STRUCTURE,
    stress: EIDOLON_STRESS,
    heatcap: block.heatcap,
    evade: [...block.evasion],
    edef: [...block.edef],
    speed: block.speed,
    sensor: block.sensor,
    save: [...block.save],
    hull: [...block.skills],
    agility: [...block.skills],
    systems: [...block.skills],
    engineering: [...block.skills],
    size: block.size,
    activations: 1,
  };
}

function eidolonFeatureList(owner: any, key: string): any[] {
  const list = owner === null || typeof owner !== 'object' ? undefined : (owner as any)[key];
  if (!Array.isArray(list)) return [];
  return list.filter((entry) => isPlainObject(entry));
}

function eidolonNpcFeature(source: any, id: string, name: string, origin: string, base: boolean): any {
  const out: any = { id, name, origin, base };
  out.type = 'Trait';
  const read = (key: string): any =>
    source === null || typeof source !== 'object' ? undefined : (source as any)[key];
  for (const key of EIDOLON_CARRY_KEYS) {
    const value = read(key);
    if (value === undefined || value === null) continue;
    out[key] = JSON.parse(JSON.stringify(value));
  }
  if (asText(out.type).trim() === '') out.type = 'Trait';

  const folded = [
    asText(out.effect),
    asText(read('detail')),
    asText(read('on_attack')).trim() === '' ? '' : `On attack: ${asText(read('on_attack'))}`,
  ].filter((part) => part.trim() !== '');
  if (folded.length > 0) out.effect = folded.join('<br>');
  return out;
}

// two layers can both ship a "Blast", so suffix has to be unique per assembly
function eidolonSuffixes(features: any[]): string[] {
  const taken = new Set<string>();
  return features.map((feature, idx) => {
    const suffix = firstFreeId(taken, slugifyName(asText(feature?.name)) || `feature_${idx + 1}`);
    taken.add(suffix);
    return suffix;
  });
}

interface EidolonNames {
  prefix: string;
  name: string;
  slug: string;
  order: string[];
}

function eidolonNames(spec: EidolonAssemblySpec): EidolonNames {
  const prefix = spec.format === 'v2' ? asText(spec.prefix).trim() : slugifyName(spec.prefix ?? '');
  const name = spec.name.trim() === '' ? 'Eidolon' : spec.name.trim();
  return {
    prefix,
    name,
    slug: slugifyName(name) || 'eidolon',
    order: spec.layers.map((pick) => pick.name),
  };
}

function eidolonLayerFeatures(
  names: EidolonNames,
  pick: EidolonLayerChoice,
  slot: string,
  ownerId: string,
  base: boolean,
  tagName: boolean,
): any[] {
  const out: any[] = [];
  const appearance = asText(pick.layer?.appearance).trim();
  const hints = asText(pick.layer?.hints).trim();
  const rulesTrait: any = {
    id: eidolonId(names.prefix, 'npcf', [names.slug, slot, 'rules']),
    name: pick.name,
    origin: ownerId,
    base,
    type: 'Trait',
    effect: [
      asText(pick.layer?.rules),
      appearance === '' ? '' : `Appearance: ${appearance}`,
      hints === '' ? '' : `Hints: ${hints}`,
    ]
      .filter((part) => part.trim() !== '')
      .join('<br>'),
  };
  const statRows = eidolonLayerStatRows(pick.name);
  if (statRows.length > 0) rulesTrait.bonuses = statRows;
  out.push(rulesTrait);

  const own = eidolonFeatureList(pick.layer, 'features');
  const suffixes = eidolonSuffixes(own);
  own.forEach((feature, at) => {
    const label = asText(feature.name) || pick.name;
    out.push(
      eidolonNpcFeature(
        feature,
        eidolonId(names.prefix, 'npcf', [names.slug, slot, suffixes[at]]),
        tagName ? `${label} (${pick.name})` : label,
        ownerId,
        base,
      ),
    );
  });
  return out;
}

function eidolonShardSummary(
  names: EidolonNames,
  pick: EidolonLayerChoice,
  slot: string,
  ownerId: string,
  base: boolean,
): any | null {
  const shards = pick.layer?.shards;
  if (!isPlainObject(shards)) return null;
  const count = countText((shards as any).count);
  const detail = asText((shards as any).detail);
  const summary: any = {
    id: eidolonId(names.prefix, 'npcf', [names.slug, slot, 'shards']),
    name: `${pick.name} Shards`,
    origin: ownerId,
    base,
    type: 'Trait',
    effect: [count === '' ? '' : `Shards: ${count}.`, detail].filter((part) => part !== '').join(' '),
  };
  for (const key of ['damage', 'add_status']) {
    const value = (shards as any)[key];
    if (Array.isArray(value)) summary[key] = JSON.parse(JSON.stringify(value));
  }
  return summary;
}

// own class, otherwise shard features collide with the parent's
function eidolonShardClass(names: EidolonNames, spec: EidolonAssemblySpec): EidolonAssembly {
  const shardId = eidolonId(names.prefix, 'npcc', [names.slug, 'shard']);
  const features: any[] = [];

  spec.layers.forEach((pick, idx) => {
    const slot = eidolonSlotSlug(idx, pick.name);
    const summary = eidolonShardSummary(names, pick, slot, shardId, false);
    if (summary !== null) features.push(summary);
    const shardFeatures = eidolonFeatureList(pick.layer?.shards, 'features');
    const suffixes = eidolonSuffixes(shardFeatures);
    shardFeatures.forEach((feature, at) => {
      features.push(
        eidolonNpcFeature(
          feature,
          eidolonId(names.prefix, 'npcf', [names.slug, slot, 'shard', suffixes[at]]),
          `${asText(feature.name) || pick.name} (${pick.name})`,
          shardId,
          false,
        ),
      );
    });
  });

  return {
    classes: [
      {
        id: shardId,
        name: `${names.name} Shard`,
        role: EIDOLON_ROLE,
        info: {
          flavor: `Shards of ${names.name}.`,
          tactics: 'Take the optional features of the active layer.',
        },
        stats: eidolonNpcStats(EIDOLON_SHARD_STATS),
      },
    ],
    features,
  };
}

function buildEidolonAssembly(spec: EidolonAssemblySpec): EidolonAssembly {
  const names = eidolonNames(spec);
  const classes: any[] = [];
  const features: any[] = [];

  const classId = eidolonId(names.prefix, 'npcc', [names.slug]);

  classes.push({
    id: classId,
    name: names.name,
    role: EIDOLON_ROLE,
    info: {
      flavor: `Class ${spec.classSize} Eidolon. ${names.order.join(' > ')}.`,
      tactics: `HP +${EIDOLON_HP_PER_PLAYER} per player character. Take the optional features of the active layer.`,
    },
    stats: eidolonNpcStats(EIDOLON_LAYER_STATS),
  });


  spec.layers.forEach((pick, idx) => {
    features.push(...eidolonLayerFeatures(names, pick, eidolonSlotSlug(idx, pick.name), classId, false, true));
  });

  const shard = eidolonShardClass(names, spec);
  const assembly: EidolonAssembly = {
    classes: [...classes, ...shard.classes],
    features: [...features, ...shard.features],
  };
  return spec.format === 'v2' ? toV2Assembly(assembly) : assembly;
}

function toV2Assembly(assembly: EidolonAssembly): EidolonAssembly {
  const owners = new Map<string, { name: string; kind: string }>();
  for (const item of assembly.classes) owners.set(asText(item.id), { name: asText(item.name), kind: 'Class' });

  const features = assembly.features.map((feature) => {
    const originId = asText(feature.origin);
    const base = feature.base === true;
    return v2Feature(feature, owners.get(originId), base);
  });

  const classes = assembly.classes.map((item) => {
    const link = deriveFeatureLinks(item, assembly.features);
    return {
      id: asText(item.id),
      name: asText(item.name),
      role: asText(item.role),
      info: JSON.parse(JSON.stringify(item.info ?? {})),
      stats: v2Stats(item.stats),
      base_features: link.base,
      optional_features: link.optional,
      power: V2_CLASS_POWER,
    };
  });

  return { classes, features };
}

function eidolonAssemblyIds(assembly: EidolonAssembly): string[] {
  return [...assembly.classes, ...assembly.features].map((item) => asText(item.id));
}

function eidolonAssemblyConflicts(assembly: EidolonAssembly, taken: Set<string>): string[] {
  return eidolonAssemblyIds(assembly).filter((id) => id !== '' && taken.has(id));
}

interface AssemblerState {
  name: string;
  classSize: number;
  slots: string[];
}

let assemblerState: AssemblerState | null = null;

function eidolonLayerChoices(): EidolonLayerChoice[] {
  const out: EidolonLayerChoice[] = [];
  const seen = new Set<string>();
  const packs = currentPack === null ? libraryDrafts : [currentPack, ...libraryDrafts];
  for (const pack of packs) {
    const list = pack.data[EIDOLON_LAYERS];
    if (!Array.isArray(list)) continue;
    for (const layer of list) {
      if (!isPlainObject(layer)) continue;
      const id = asText((layer as any).id).trim();
      if (id === '' || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: asText((layer as any).name) || id, pack: pack.name, layer });
    }
  }
  return out;
}

function eidolonSlotCount(classSize: number): number {
  const entry = EIDOLON_CLASS_SIZES.find((row) => row.classSize === classSize);
  return entry === undefined ? EIDOLON_CLASS_SIZES[0].layers : entry.layers;
}

function resizeAssemblerSlots() {
  if (assemblerState === null) return;
  const want = eidolonSlotCount(assemblerState.classSize);
  const choices = eidolonLayerChoices();
  const fallback = choices.length === 0 ? '' : choices[0].id;
  while (assemblerState.slots.length > want) assemblerState.slots.pop();
  while (assemblerState.slots.length < want) assemblerState.slots.push(fallback);
}

function assemblerPicks(): EidolonLayerChoice[] | null {
  if (assemblerState === null) return null;
  const choices = eidolonLayerChoices();
  const picks: EidolonLayerChoice[] = [];
  for (const id of assemblerState.slots) {
    const found = choices.find((choice) => choice.id === id);
    if (found === undefined) return null;
    picks.push(found);
  }
  return picks.length === 0 ? null : picks;
}

function renderAssemblerSummary() {
  const host = document.getElementById('assembler-summary')!;
  if (assemblerState === null) return;
  const picks = assemblerPicks();
  if (picks === null) {
    host.innerText = 'Pick a layer for every slot';
    return;
  }
  const assembly = buildEidolonAssembly({
    name: assemblerState.name,
    classSize: assemblerState.classSize,
    layers: picks,
    prefix: packItemPrefixRaw(),
    format: currentFormat(),
  });
  host.innerText = `${assembly.classes.length} classes | ${assembly.features.length} features`;
}

function moveAssemblerSlot(idx: number, step: number) {
  if (assemblerState === null) return;
  const next = idx + step;
  const slots = assemblerState.slots;
  if (next < 0 || next >= slots.length) return;
  const held = slots[idx];
  slots[idx] = slots[next];
  slots[next] = held;
  renderAssemblerSlots();
}

function assemblerSlotButton(label: string, description: string, onPick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-small';
  button.innerText = label;
  button.setAttribute('aria-label', description);
  button.addEventListener('click', onPick);
  return button;
}

function renderAssemblerSlots() {
  const host = document.getElementById('assembler-slots')!;
  if (assemblerState === null) return;
  const choices = eidolonLayerChoices();
  host.innerHTML = '';

  assemblerState.slots.forEach((chosen, idx) => {
    const row = document.createElement('div');
    row.className = 'assembler-slot';

    const num = document.createElement('span');
    num.className = 'assembler-slot-num';
    num.innerText = String(idx + 1);
    row.appendChild(num);

    const select = document.createElement('select');
    select.className = 'form-input';
    fillOptions(
      select,
      choices.map((choice) => ({ value: choice.id, label: `${choice.name} | ${choice.pack}`, selected: choice.id === chosen })),
    );
    select.addEventListener('change', () => {
      if (assemblerState === null) return;
      assemblerState.slots[idx] = select.value;
      renderAssemblerSummary();
    });
    row.appendChild(select);

    row.appendChild(assemblerSlotButton('↑', 'Move up', () => moveAssemblerSlot(idx, -1)));
    row.appendChild(assemblerSlotButton('↓', 'Move down', () => moveAssemblerSlot(idx, 1)));
    host.appendChild(row);
  });

  renderAssemblerSummary();
}

async function openAssemblerModal() {
  if (!currentPack || !eidolonUnlocked()) return;
  try {
    await ensureEidolonData();
  } catch {
    showToast('Eidolon data unavailable');
    return;
  }
  if (eidolonLayerChoices().length === 0) {
    showToast('No layers in the library');
    return;
  }

  assemblerState = { name: '', classSize: EIDOLON_CLASS_SIZES[0].classSize, slots: [] };
  resizeAssemblerSlots();

  const nameInput = document.getElementById('assembler-name') as HTMLInputElement;
  nameInput.value = '';
  nameInput.oninput = () => {
    if (assemblerState === null) return;
    assemblerState.name = nameInput.value;
    renderAssemblerSummary();
  };

  const classSelect = document.getElementById('assembler-class') as HTMLSelectElement;
  classSelect.innerHTML = '';
  fillOptions(
    classSelect,
    EIDOLON_CLASS_SIZES.map((entry) => ({ value: String(entry.classSize), label: `Class ${entry.classSize} | ${entry.layers} layers` })),
  );
  classSelect.value = String(assemblerState.classSize);
  classSelect.onchange = () => {
    if (assemblerState === null) return;
    assemblerState.classSize = Number(classSelect.value);
    resizeAssemblerSlots();
    renderAssemblerSlots();
  };

  renderAssemblerSlots();
  showModal('assembler-modal');
  nameInput.focus();
}

export function closeAssemblerModal() {
  assemblerState = null;
  closeModal('assembler-modal');
}

function applyEidolonAssembly(assembly: EidolonAssembly): number {
  if (!currentPack) return 0;
  const classes = standardListFor('npc_classes.json');
  const anchor = classes.length;
  const npcFeatures = standardListFor('npc_features.json');
  for (const item of assembly.classes) classes.push(item);
  for (const item of assembly.features) npcFeatures.push(item);

  flushPackSave();
  validateCurrentPack();
  renderEditorRail();
  selectCategory('npc_classes.json');
  const landed = slotIndexOf('npc_classes.json', 'npc_classes.json', anchor);
  selectItem(landed === -1 ? 0 : landed);
  return eidolonAssemblyIds(assembly).length;
}

export async function runEidolonAssembler() {
  if (!currentPack || assemblerState === null) return;
  const picks = assemblerPicks();
  if (picks === null) {
    showToast('Pick a layer for every slot');
    return;
  }
  if (assemblerState.name.trim() === '') {
    showToast('Name the eidolon');
    return;
  }

  const prefix = packItemPrefixRaw();
  const format = currentFormat();
  const classSize = assemblerState.classSize;
  let name = assemblerState.name;
  let assembly = buildEidolonAssembly({ name, classSize, layers: picks, prefix, format });
  let clash = eidolonAssemblyConflicts(assembly, packIdSet(currentPack));
  while (clash.length > 0) {
    const answer = await customPrompt(`${clash[0]} is taken. New name?`);
    if (answer === null) return;
    name = answer.value.trim();
    if (name === '') return;
    assembly = buildEidolonAssembly({ name, classSize, layers: picks, prefix, format });
    clash = eidolonAssemblyConflicts(assembly, packIdSet(currentPack));
  }

  const landed = applyEidolonAssembly(assembly);
  closeAssemblerModal();
  showToast(`Generated ${landed} items`);
}

let eidolonTargetDrafts: PackDraft[] = [];

export async function openEidolonTargetModal() {
  eidolonTargetDrafts = (await getDrafts()).sort((a, b) => a.name.localeCompare(b.name));

  const select = document.getElementById('eidolon-target-select') as HTMLSelectElement;
  select.innerHTML = '<option value="">-- Select Pack --</option>';
  fillOptions(select, eidolonTargetDrafts.map((draft) => ({ value: draft.id, label: draft.name })));

  showModal('eidolon-target-modal');
}

export function closeEidolonTargetModal() {
  closeModal('eidolon-target-modal');
}

export async function confirmEidolonTarget() {
  const select = document.getElementById('eidolon-target-select') as HTMLSelectElement;
  const chosen = eidolonTargetDrafts.find((draft) => draft.id === select.value);
  if (chosen === undefined) {
    showToast('Pick a pack');
    return;
  }
  closeEidolonTargetModal();
  openDraft(chosen);
  await openAssemblerModal();
}
