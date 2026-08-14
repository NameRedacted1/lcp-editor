import * as fflate from 'fflate';
import { currentPack, currentCategory, EIDOLON_LAYERS, MAX_ARCHIVE_DEPTH, DiscoveredPack, PACK_ARRAY_FILES, PACK_MANIFEST, PackData, PackDraft, PackFormat, V2_CLASS_POWER, V2_TEMPLATE_POWER, categoryTitle, chooseFormat, closeModal, currentFormat, customConfirm, esc, fillOptions, getDrafts, itemValidationErrors, manifestIsDecisive, openDraft, packFormatOf, renderLibrary, saveDraftOrToast, showModal, showToast, stampFormat, REF_WALK_DEPTH } from './state.js';
import { ID_ENTRY_ARRAY_KEYS, ID_SCALAR_KEYS, ID_STRING_ARRAY_KEYS, OWNER_KIND_BY_FILE, OwnerKeySnapshot, OwnerKind, asText, deriveFeatureLinks, flushPackSave, featureClaimsOwner, featureIsBase, firstFreeId, isPlainObject, slugifyName, statusIdFor, ownerKeysFor, regenerateNpcFeatureArrays, retargetFeatureOrigin } from './forms.js';
import { switchTab, selectItem, catCount, catItems, importableCategoryOptions, NPC_CATEGORY_BY_KIND, isListCategory, itemAt, joinParts, libraryDrafts, npcAggregateFiles, npcKindOf, railCategories, renderEditorRail, selectCategory, slotIndexOf, standardListFor, validateCurrentPack } from './ui.js';
import { V2_TIER_CELLS, v2Bonuses, V2_FOLDED_FEATURE_KEYS, v2DamageText, v2EffectText, v2FeatureType, v2OnHit, v2StatusText, v2TierCells, v2TierValue } from './v2.js';

const NOTICE_NAME_CAP = 4; // longer toasts are unreadable

// no filesystem here, just keeping the dir key sane. windows zips use backslashes
export function normalizeArchivePath(name: string): string {
  const parts = name.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

function isArchiveDirEntry(rawName: string): boolean {
  return rawName.replace(/\\/g, '/').endsWith('/');
}

function splitArchivePath(full: string): { dir: string; base: string } {
  const cut = full.lastIndexOf('/');
  if (cut === -1) return { dir: '', base: full };
  return { dir: full.slice(0, cut), base: full.slice(cut + 1) };
}

function stripArchiveExt(name: string): string {
  return name.replace(/\.(lcp|zip)$/i, '');
}

function nameList(names: string[]): string {
  if (names.length <= NOTICE_NAME_CAP) return names.join(', ');
  return `${names.slice(0, NOTICE_NAME_CAP).join(', ')} +${names.length - NOTICE_NAME_CAP} more`;
}

// side channel: collectArchiveJson fills, discoverPacks drains. depth 0 resets
let pendingArchiveDrops: string[] = [];

export function collectArchiveJson(
  bytes: Uint8Array,
  prefix: string,
  depth: number,
  out: Map<string, Uint8Array>,
) {
  if (depth === 0) pendingArchiveDrops = [];
  const unzipped = fflate.unzipSync(bytes);
  for (const [rawName, u8arr] of Object.entries(unzipped)) {
    if (isArchiveDirEntry(rawName)) continue;
    const name = normalizeArchivePath(rawName);
    if (!name) continue;
    const { base } = splitArchivePath(name);
    if (name.startsWith('__MACOSX/') || base.startsWith('._')) continue;
    const full = prefix ? `${prefix}/${name}` : name;
    const lower = base.toLowerCase();
    if (u8arr.length === 0) {
      pendingArchiveDrops.push(full);
      continue;
    }
    if (lower.endsWith('.lcp') || lower.endsWith('.zip')) {
      if (depth >= MAX_ARCHIVE_DEPTH) continue;
      try {
        collectArchiveJson(u8arr, full, depth + 1, out);
      } catch (e) {
        console.error(`Failed to read nested archive ${full}`);
      }
      continue;
    }
    if (!lower.endsWith('.json')) {
      pendingArchiveDrops.push(full);
      continue;
    }
    out.set(full, u8arr);
  }
}

// core ships statuses named but unidentified. every ref is by id, so derive them on the way in
function fillStatusIds(data: PackData): void {
  const list = data['statuses.json'];
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!isPlainObject(item) || asText(item.id).trim() !== '') continue;
    const id = statusIdFor(asText(item.name));
    if (id !== '') item.id = id;
  }
}

export function discoverPacks(entries: Map<string, Uint8Array>): DiscoveredPack[] {
  const byDir = new Map<string, PackData>();
  const unreadable: string[] = [];
  for (const [full, u8arr] of entries) {
    let parsed: any;
    try {
      parsed = JSON.parse(fflate.strFromU8(u8arr));
    } catch (e) {
      console.error(`Failed to parse ${full} in zip`);
      unreadable.push(full);
      continue;
    }
    const { dir, base } = splitArchivePath(full);
    const bucket = byDir.get(dir) ?? {};
    bucket[base] = parsed;
    byDir.set(dir, bucket);
  }

  const notice: string[] = [];
  if (unreadable.length > 0) notice.push(`${nameList(unreadable)} (bad JSON)`);
  if (pendingArchiveDrops.length > 0) notice.push(`${nameList(pendingArchiveDrops)} (not JSON)`);
  if (notice.length > 0) showToast(`Skipped: ${notice.join('; ')}`);
  pendingArchiveDrops = [];

  const packs: DiscoveredPack[] = [];
  for (const [dir, data] of byDir) {
    const qualifies =
      'lcp_manifest.json' in data ||
      'info.json' in data ||
      Object.entries(data).some(([base, value]) => PACK_ARRAY_FILES.has(base) && Array.isArray(value));
    if (!qualifies) continue;
    fillStatusIds(data);
    packs.push({ dir, data });
  }

  packs.sort((a, b) => {
    const depthA = a.dir === '' ? 0 : a.dir.split('/').length;
    const depthB = b.dir === '' ? 0 : b.dir.split('/').length;
    return depthA - depthB || a.dir.localeCompare(b.dir);
  });
  return packs;
}

const RULES_TERMS = new Set(['immunity', 'cover', 'grappled']);
const REF_EXTRA_SCALAR_KEYS = new Set(['immunity']);

interface StructuredRef {
  id: string;
  hard: boolean;
}


function collectRefs(value: any, key: string | null, depth: number, out: Map<string, boolean>) {
  if (value === null || value === undefined || depth >= REF_WALK_DEPTH) return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (key !== null && ID_STRING_ARRAY_KEYS.has(key) && typeof entry === 'string') {
        const id = entry.trim();
        if (id !== '') out.set(id, true);
        continue;
      }
      if (key !== null && ID_ENTRY_ARRAY_KEYS.has(key) && entry !== null && typeof entry === 'object') {
        const id = asText((entry as any).id).trim();
        if (id !== '') out.set(id, true);
      }
      collectRefs(entry, key, depth + 1, out);
    }
    return;
  }
  if (typeof value !== 'object') return;
  for (const [childKey, child] of Object.entries(value)) {
    if ((ID_SCALAR_KEYS.has(childKey) || REF_EXTRA_SCALAR_KEYS.has(childKey)) && typeof child === 'string') {
      const id = child.trim();
      if (id !== '' && !out.has(id)) out.set(id, false);
    }
    collectRefs(child, childKey, depth + 1, out);
  }
}

function structuredRefsOf(item: any): StructuredRef[] {
  const found = new Map<string, boolean>();
  collectRefs(item, null, 0, found);
  return Array.from(found.entries()).map(([id, hard]) => ({ id, hard }));
}

interface FieldRef {
  field: string;
  id: string;
  hard: boolean;
}

function structuredFieldRefsOf(item: any): FieldRef[] {
  if (!isPlainObject(item)) return [];
  const out: FieldRef[] = [];
  for (const [field, child] of Object.entries(item)) {
    for (const ref of structuredRefsOf({ [field]: child })) out.push({ field, id: ref.id, hard: ref.hard });
  }
  return out;
}

interface SourceEntry {
  cat: string;
  item: any;
  pack: string;
}

function indexPackInto(pack: PackDraft, index: Map<string, SourceEntry>) {
  for (const cat of railCategories(pack)) {
    if (cat === 'lcp_manifest.json' || !isListCategory(cat, pack)) continue;
    for (const item of catItems(cat, pack)) {
      if (!isPlainObject(item)) continue;
      const id = asText((item as any).id).trim();
      if (id === '' || index.has(id)) continue;
      index.set(id, { cat, item, pack: pack.name });
    }
  }
}

function buildLibraryIndex(source: PackDraft, others: PackDraft[]): Map<string, SourceEntry> {
  const index = new Map<string, SourceEntry>();
  indexPackInto(source, index);
  for (const pack of others) {
    if (pack.id === source.id) continue;
    if (currentPack !== null && pack.id === currentPack.id) continue;
    indexPackInto(pack, index);
  }
  return index;
}

export function packIdSet(pack: PackDraft): Set<string> {
  const ids = new Set<string>();
  for (const value of Object.values(pack.data)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!isPlainObject(item)) continue;
      const id = asText((item as any).id).trim();
      if (id !== '') ids.add(id);
    }
  }
  return ids;
}

interface DanglingRef {
  cat: string;
  index: number;
  field: string;
  id: string;
}

interface CrossPackRef {
  cat: string;
  index: number;
  field: string;
  id: string;
  pack: string;
}

interface RefClassification {
  dangling: DanglingRef[];
  crossPack: CrossPackRef[];
}

function classifyPackRefs(pack: PackDraft, library: PackDraft[]): RefClassification {
  const sameFormat = library.filter((entry) => entry.id !== pack.id && packFormatOf(entry) === packFormatOf(pack));
  const own = new Map<string, SourceEntry>();
  indexPackInto(pack, own);
  const index = buildLibraryIndex(pack, sameFormat);
  const dangling: DanglingRef[] = [];
  const crossPack: CrossPackRef[] = [];
  for (const cat of railCategories(pack)) {
    if (cat === 'lcp_manifest.json' || !isListCategory(cat, pack)) continue;
    catItems(cat, pack).forEach((item: any, idx: number) => {
      if (!isPlainObject(item)) return;
      for (const ref of structuredFieldRefsOf(item)) {
        if (!ref.hard || RULES_TERMS.has(ref.id) || own.has(ref.id)) continue;
        const entry = index.get(ref.id);
        if (entry === undefined) dangling.push({ cat, index: idx, field: ref.field, id: ref.id });
        else crossPack.push({ cat, index: idx, field: ref.field, id: ref.id, pack: entry.pack });
      }
    });
  }
  return { dangling, crossPack };
}

function originLinkedFeatures(pack: PackDraft, owner: any, kind: OwnerKind | null = null): SourceEntry[] {
  const keys = ownerKeysFor(owner);
  if (keys.size === 0) return [];
  const out: SourceEntry[] = [];
  for (const item of catItems('npc_features.json', pack)) {
    if (!item || typeof item !== 'object') continue;
    if (!featureClaimsOwner(item, keys, kind)) continue;
    out.push({ cat: 'npc_features.json', item, pack: pack.name });
  }
  return out;
}

interface ImportClosure {
  root: SourceEntry;
  imports: SourceEntry[];
  present: string[];
  unresolved: string[];
  rulesTerms: string[];
}

function buildImportClosure(
  pack: PackDraft,
  rootCat: string,
  rootItem: any,
  library: PackDraft[] = [],
): ImportClosure {
  const index = buildLibraryIndex(pack, library);
  const owned = currentPack === null ? new Set<string>() : packIdSet(currentPack);
  const visited = new Set<string>();
  const imports: SourceEntry[] = [];
  const present = new Set<string>();
  const unresolved = new Set<string>();
  const rulesTerms = new Set<string>();

  const queue: SourceEntry[] = [{ cat: rootCat, item: rootItem, pack: pack.name }];
  const rootId = asText(rootItem?.id).trim();
  if (rootId !== '') visited.add(rootId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const kind = npcKindOf(current.item);
    const linkable =
      current.cat === 'npc_classes.json' || current.cat === 'npc_templates.json' || kind === 'class' || kind === 'template';
    const ownerKind: OwnerKind | null =
      OWNER_KIND_BY_FILE[current.cat] ?? (kind === 'class' ? 'Class' : kind === 'template' ? 'Template' : null);
    const linked: SourceEntry[] = linkable
      ? [pack, ...library.filter((entry) => entry.id !== pack.id && (currentPack === null || entry.id !== currentPack.id))]
          .flatMap((source) => originLinkedFeatures(source, current.item, ownerKind))
      : [];

    const neighbours: { entry: SourceEntry | undefined; id: string; hard: boolean }[] = [];
    for (const ref of structuredRefsOf(current.item)) {
      neighbours.push({ entry: index.get(ref.id), id: ref.id, hard: ref.hard });
    }
    for (const entry of linked) {
      neighbours.push({ entry, id: asText(entry.item.id).trim(), hard: true });
    }

    for (const neighbour of neighbours) {
      const id = neighbour.id;
      if (id === '' || visited.has(id)) continue;
      if (owned.has(id)) {
        visited.add(id);
        present.add(id);
        if (neighbour.entry !== undefined) queue.push(neighbour.entry);
        continue;
      }
      if (neighbour.entry === undefined) {
        if (RULES_TERMS.has(id)) rulesTerms.add(id);
        else if (neighbour.hard) unresolved.add(id);
        continue;
      }
      visited.add(id);
      imports.push(neighbour.entry);
      queue.push(neighbour.entry);
    }
  }

  return {
    root: { cat: rootCat, item: rootItem, pack: pack.name },
    imports,
    present: Array.from(present).sort(),
    unresolved: Array.from(unresolved).sort(),
    rulesTerms: Array.from(rulesTerms).sort(),
  };
}

function categoryLabel(cat: string): string {
  return cat.replace('.json', '').replace(/_/g, ' ');
}

function closureSummary(closure: ImportClosure): string {
  const rootName = asText(closure.root.item?.name) || asText(closure.root.item?.id) || 'Item';
  const counts = new Map<string, number>();
  for (const entry of closure.imports) counts.set(entry.cat, (counts.get(entry.cat) ?? 0) + 1);
  const groups = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => `${count} ${categoryLabel(cat)}`);
  const notes: string[] = [];
  if (closure.present.length > 0) notes.push(`${closure.present.length} already present`);
  if (closure.unresolved.length > 0) notes.push(`${closure.unresolved.length} unresolved`);
  const tail = notes.length > 0 ? ` (${notes.join(', ')})` : '';
  const from = closure.root.pack === '' ? '' : ` <- ${closure.root.pack}`;
  if (groups.length === 0) return `${rootName}${from} - no dependencies${tail}`;
  return `${rootName}${from} + ${groups.join(' | ')}${tail}`;
}

function renderClosureDetail(closure: ImportClosure) {
  const panel = document.getElementById('import-closure')!;
  panel.innerHTML = '';
  const rows: string[] = [];
  for (const entry of closure.imports) {
    const name = asText(entry.item?.name) || asText(entry.item?.id);
    rows.push(
      `<div class="closure-row" data-pack="${esc(entry.pack)}"><span class="closure-cat">${esc(categoryLabel(entry.cat))}</span>${esc(name)}<span class="closure-pack">${esc(entry.pack)}</span></div>`,
    );
  }
  for (const id of closure.present) {
    rows.push(`<div class="closure-row muted"><span class="closure-cat">present</span>${esc(id)}</div>`);
  }
  for (const id of closure.rulesTerms) {
    rows.push(`<div class="closure-row muted"><span class="closure-cat">rules term</span>${esc(id)}</div>`);
  }
  for (const id of closure.unresolved) {
    rows.push(`<div class="closure-row warn"><span class="closure-cat">missing</span>${esc(id)}</div>`);
  }
  if (rows.length === 0) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  panel.innerHTML = `<details><summary>Details</summary><div class="closure-list">${rows.join('')}</div></details>`;
}

interface ImportRootRename {
  before: OwnerKeySnapshot;
  next: { id: string; name: string };
}

function applyImportClosure(closure: ImportClosure, rename: ImportRootRename | null = null): number {
  if (!currentPack) return 0;
  const owned = packIdSet(currentPack);
  let landed = 0;
  for (const entry of closure.imports) {
    const id = asText(entry.item?.id).trim();
    if (id !== '' && owned.has(id)) continue;
    const list = standardListFor(entry.cat);
    const copy = JSON.parse(JSON.stringify(entry.item));
    if (rename !== null) retargetFeatureOrigin(copy, rename.before, rename.next);
    list.push(copy);
    if (id !== '') owned.add(id);
    landed += 1;
  }
  return landed;
}

interface AppliedImport {
  cloned: any;
  deps: number;
  list: any[];
}

export function applyImport(closure: ImportClosure, cat: string, includeDeps: boolean): AppliedImport {
  if (!currentPack) return { cloned: null, deps: 0, list: [] };
  const taken = packIdSet(currentPack);
  const cloned = JSON.parse(JSON.stringify(closure.root.item));
  const rootId = asText(cloned.id).trim();
  if (rootId !== '' && taken.has(rootId)) {
    cloned.id = firstFreeId(taken, `${rootId}_imported`, '');
    if (typeof cloned.name === 'string') cloned.name += ' (Imported)';
  }
  const deps = includeDeps ? applyImportClosure(closure, importRootRename(cat, closure.root.item, cloned)) : 0;
  const list = standardListFor(cat);
  list.push(cloned);
  return { cloned, deps, list };
}

function importRootRename(cat: string, before: any, next: any): ImportRootRename | null {
  const beforeId = asText(before?.id);
  const beforeName = asText(before?.name);
  const nextId = asText(next?.id);
  const nextName = asText(next?.name);
  if (beforeId === nextId && beforeName === nextName) return null;
  return {
    before: { id: beforeId, name: beforeName, kind: OWNER_KIND_BY_FILE[cat] ?? null },
    next: { id: nextId, name: nextName },
  };
}

let importDrafts: PackDraft[] = [];
export let importClosure: ImportClosure | null = null;
export let importCategory: string | null = null;

function importSourcesFor(format: PackFormat, drafts: PackDraft[], openId: string): PackDraft[] {
  return drafts.filter((draft) => draft.id !== openId && packFormatOf(draft) === format);
}

function importCategoryChoices(pack: PackDraft, drafts: PackDraft[], preferred: string | null): string[] {
  const options = new Set(importableCategoryOptions(pack, drafts));
  if (preferred !== null) options.add(preferred);
  return Array.from(options).sort((a, b) => categoryTitle(a).localeCompare(categoryTitle(b)));
}

function resetImportItemSelect() {
  const itemSelect = document.getElementById('import-item-select') as HTMLSelectElement;
  itemSelect.innerHTML = '<option value="">-- Select Item --</option>';
  importClosure = null;
  showClosure(null);
}

export async function openImportModal() {
  if (!currentPack) return;

  const format = currentFormat();
  importDrafts = importSourcesFor(format, await getDrafts(), currentPack.id);

  const preferred = currentCategory !== null && isListCategory(currentCategory) ? currentCategory : null;
  const choices = importCategoryChoices(currentPack, importDrafts, preferred);

  const categorySelect = document.getElementById('import-category-select') as HTMLSelectElement;
  categorySelect.innerHTML = '';
  fillOptions(categorySelect, choices.map((cat) => ({ value: cat, label: categoryTitle(cat) })));
  importCategory = preferred !== null && choices.includes(preferred) ? preferred : (choices[0] ?? null);
  if (importCategory !== null) categorySelect.value = importCategory;

  const draftSelect = document.getElementById('import-draft-select') as HTMLSelectElement;
  draftSelect.innerHTML = '<option value="">-- Select Draft --</option>';
  fillOptions(draftSelect, importDrafts.map((d) => ({ value: d.id, label: `${d.name} | ${format}` })));

  const itemSelect = document.getElementById('import-item-select') as HTMLSelectElement;
  itemSelect.onchange = () => {
    const selectedDraft = importDrafts.find((d) => d.id === draftSelect.value);
    const item =
      selectedDraft === undefined || itemSelect.value === '' || importCategory === null
        ? undefined
        : itemAt(importCategory, Number(itemSelect.value), selectedDraft);
    if (selectedDraft === undefined || item === undefined || importCategory === null) {
      importClosure = null;
      showClosure(null);
      return;
    }
    importClosure = buildImportClosure(selectedDraft, importCategory, item, importDrafts);
    showClosure(importClosure);
  };

  const refreshItemOptions = () => {
    resetImportItemSelect();
    const selectedDraft = importDrafts.find(d => d.id === draftSelect.value);
    if (selectedDraft === undefined || importCategory === null) return;
    fillOptions(
      itemSelect,
      catItems(importCategory, selectedDraft).flatMap((item: any, idx: number) =>
        !item || typeof item !== 'object' ? [] : [{ value: String(idx), label: item.name || item.id || `Item ${idx}` }],
      ),
    );
  };

  categorySelect.onchange = () => {
    importCategory = categorySelect.value || null;
    refreshItemOptions();
  };

  draftSelect.onchange = refreshItemOptions;

  (document.getElementById('import-with-deps') as HTMLInputElement).checked = true;

  resetImportItemSelect();
  showModal('import-modal');
}

function showClosure(closure: ImportClosure | null) {
  document.getElementById('import-summary')!.innerText = closure === null ? '' : closureSummary(closure);
  if (closure === null) {
    const panel = document.getElementById('import-closure')!;
    panel.innerHTML = '';
    panel.classList.add('hidden');
    return;
  }
  renderClosureDetail(closure);
}

export function closeImportModal() {
  closeModal('import-modal');
}

export function confirmImport() {
  if (!currentPack || importCategory === null || importClosure === null) return;
  const cat = importCategory;
  const includeDeps = (document.getElementById('import-with-deps') as HTMLInputElement).checked;
  const { deps, list } = applyImport(importClosure, cat, includeDeps);
  flushPackSave();
  validateCurrentPack();
  renderEditorRail();
  selectCategory(cat);
  const landed = slotIndexOf(cat, cat, list.length - 1);
  selectItem(landed === -1 ? catCount(cat) - 1 : landed);
  closeImportModal();
  if (deps > 0) showToast(`Imported ${deps + 1} items`);
}

const NPC_CLASS_FILE = 'npc_classes.json';
const NPC_FEATURE_FILE = 'npc_features.json';
const NPC_TEMPLATE_FILE = 'npc_templates.json';

// map = real equivalent key, fold = into the effect text, drop = nothing sensible, carry = leave it
// only the files i've actually converted are listed. rest falls through untouched
type ConvertFieldPlan = 'map' | 'fold' | 'drop' | 'carry';

const CONVERT_V3_ONLY_FIELDS: Record<string, Record<string, ConvertFieldPlan>> = {
  'actions.json': {
    add_special: 'fold',
    add_status: 'fold',
    damage: 'fold',
    frequency: 'fold',
    hidden: 'fold',
    trigger: 'fold',
  },
  'core_bonuses.json': { actions: 'fold', active_effects: 'fold', bonuses: 'fold', synergies: 'fold' },
  'frames.json': { active_counters: 'fold' },
  'lcp_manifest.json': { v3: 'map', version_history: 'carry' },
  'manufacturers.json': { dark: 'map', light: 'map' },
  'mods.json': { actions: 'fold', cost: 'fold', on_hit: 'fold', restricted_sizes: 'map' },
  'pilot_gear.json': { active_effects: 'fold', add_resist: 'fold', deployables: 'fold', on_hit: 'fold' },
  'reserves.json': {
    active_effects: 'fold',
    add_other: 'fold',
    add_resist: 'fold',
    add_special: 'fold',
    add_status: 'fold',
    damage: 'fold',
    deprecated: 'fold',
  },
  'rules.json': { base_pilot_save_target: 'drop', base_pilot_sensors: 'drop' },
  'statuses.json': { exclusive: 'fold', id: 'drop' },
  'systems.json': { active_effects: 'fold', add_resist: 'fold', ammo: 'fold', bonuses: 'fold', counters: 'fold' },
  'weapons.json': {
    active_effects: 'fold',
    bonus_damage: 'fold',
    no_attack: 'fold',
    no_core_bonus: 'fold',
    no_mods: 'fold',
    no_synergies: 'fold',
  },
  [NPC_CLASS_FILE]: { optionalClassMax: 'drop', optionalClassMin: 'drop', prohibitTemplates: 'drop' },
  [NPC_FEATURE_FILE]: {
    actions: 'fold',
    activation: 'fold',
    active_effects: 'fold',
    add_other: 'fold',
    add_resist: 'map',
    add_status: 'fold',
    added_damage: 'fold',
    added_tags: 'fold',
    attacks: 'fold',
    base: 'map',
    bonus_damage: 'fold',
    bonuses: 'map',
    deployables: 'fold',
    deprecated: 'fold',
    mod: 'fold',
    on_crit: 'fold',
    synergies: 'fold',
  },
  [NPC_TEMPLATE_FILE]: {
    caveat: 'fold',
    forceTag: 'drop',
    optionalClassMax: 'drop',
    optionalClassMin: 'drop',
    optionalMax: 'drop',
    optionalMin: 'drop',
    optionalPerTier: 'drop',
    prohibitTemplates: 'drop',
    tactics: 'fold',
    template: 'map',
  },
};

const CONVERT_V2_ONLY_FIELDS: Record<string, Record<string, ConvertFieldPlan>> = {
  'actions.json': { action_type: 'map', description: 'map', reserve: 'fold' },
  'backgrounds.json': { triggers: 'map' },
  'frames.json': { aptitude: 'drop', data_type: 'drop', other_art: 'carry' },
  'info.json': { active: 'drop' },
  'manufacturers.json': { color: 'map' },
  'mods.json': {
    added_damage: 'map',
    applied_string: 'drop',
    applied_to: 'map',
    aptitude: 'drop',
    data_type: 'drop',
    restricted_mounts: 'map',
  },
  'pilot_gear.json': {
    armor: 'map',
    edef: 'map',
    evasion: 'map',
    hp_bonus: 'map',
    speed: 'map',
    uses: 'fold',
  },
  'systems.json': { aptitude: 'drop', data_type: 'drop' },
  'talents.json': { counters: 'map' },
  'weapons.json': { aptitude: 'drop', data_type: 'drop' },
  [NPC_CLASS_FILE]: { base_features: 'carry', optional_features: 'carry', power: 'drop' },
  [NPC_FEATURE_FILE]: { exclusive: 'carry', immunity: 'map', locked: 'drop', override: 'map', resistance: 'map' },
  [NPC_TEMPLATE_FILE]: { power: 'drop' },
};

function planKeys(table: Record<string, Record<string, ConvertFieldPlan>>, plan: ConvertFieldPlan): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [file, fields] of Object.entries(table)) {
    const keys = Object.keys(fields).filter((key) => fields[key] === plan);
    if (keys.length > 0) out[file] = keys;
  }
  return out;
}

const CONVERT_DROP_V2_ONLY: Record<string, string[]> = planKeys(CONVERT_V2_ONLY_FIELDS, 'drop');

const CONVERT_DROP_V3_ONLY: Record<string, string[]> = planKeys(CONVERT_V3_ONLY_FIELDS, 'drop');

const CONVERT_FOLD_V2_ONLY: Record<string, string[]> = planKeys(CONVERT_V2_ONLY_FIELDS, 'fold');

const CONVERT_FOLD_V3_ONLY: Record<string, string[]> = planKeys(CONVERT_V3_ONLY_FIELDS, 'fold');


const CONVERT_INFO_DROP_V3_ONLY = ['terse'];

const CONVERT_TEXT_FIELD: Record<string, string> = {
  'actions.json': 'detail',
  'backgrounds.json': 'description',
  'frames.json': 'description',
  'manufacturers.json': 'description',
  'pilot_gear.json': 'description',
  'reserves.json': 'description',
  'statuses.json': 'effects',
  'talents.json': 'description',
  [NPC_TEMPLATE_FILE]: 'description',
};

function convertTextField(file: string): string {
  return CONVERT_TEXT_FIELD[file] ?? 'effect';
}

const CONVERT_EVIDENCE_NEEDS_VALUE = new Set([
  `${NPC_CLASS_FILE} base_features`,
  `${NPC_CLASS_FILE} optional_features`,
]);

// show up in both formats in the wild, useless as evidence
const CONVERT_EVIDENCE_SHARED_FIELDS = new Set([
  'frames.json data_type',
  'frames.json other_art',
  'info.json active',
  'mods.json added_damage',
]);

// counts format-only fields per side. caller abstains on a tie
function evidenceSignals(data: PackData): { v2: Set<string>; v3: Set<string> } {
  const v2 = new Set<string>();
  const v3 = new Set<string>();
  const aggregateFiles = new Set(npcAggregateFiles({ id: '', name: '', version: '', author: '', data } as PackDraft));
  const carries = (file: string, key: string, item: Record<string, unknown>) => {
    if (!(key in item)) return false;
    if (!CONVERT_EVIDENCE_NEEDS_VALUE.has(`${file} ${key}`)) return true;
    const value = item[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
  };
  const score = (file: string, item: Record<string, unknown>) => {
    for (const key of Object.keys(CONVERT_V2_ONLY_FIELDS[file] ?? {})) {
      if (CONVERT_EVIDENCE_SHARED_FIELDS.has(`${file} ${key}`)) continue;
      if (carries(file, key, item)) v2.add(`${file} ${key}`);
    }
    for (const key of Object.keys(CONVERT_V3_ONLY_FIELDS[file] ?? {})) {
      if (CONVERT_EVIDENCE_SHARED_FIELDS.has(`${file} ${key}`)) continue;
      if (carries(file, key, item)) v3.add(`${file} ${key}`);
    }
  };
  for (const [file, value] of Object.entries(data)) {
    if (!Array.isArray(value)) {
      if (value === null || typeof value !== 'object') continue;
      score(file, value as Record<string, unknown>);
      continue;
    }
    for (const entry of value) {
      if (!isPlainObject(entry)) continue;
      const item = entry as Record<string, unknown>;
      const kind = aggregateFiles.has(file) ? npcKindOf(item) : null;
      const canonicalFile = kind === null ? file : NPC_CATEGORY_BY_KIND[kind];
      score(canonicalFile, item);
      if (canonicalFile === NPC_FEATURE_FILE) {
        const origin = item['origin'];
        if (isPlainObject(origin)) v2.add(`${NPC_FEATURE_FILE} origin object`);
        else if (typeof origin === 'string' && origin !== '') v3.add(`${NPC_FEATURE_FILE} origin id`);
      }
      if (canonicalFile === NPC_CLASS_FILE) {
        const stats = item['stats'];
        const size = stats !== null && typeof stats === 'object' ? (stats as Record<string, unknown>)['size'] : undefined;
        if (Array.isArray(size)) v2.add(`${NPC_CLASS_FILE} stats.size nested`);
        else if (size !== undefined) v3.add(`${NPC_CLASS_FILE} stats.size scalar`);
      }
    }
  }
  return { v2, v3 };
}

function evidenceFormat(data: PackData): PackFormat | undefined {
  const { v2, v3 } = evidenceSignals(data);
  if (v2.size === v3.size) return undefined;
  return v2.size > v3.size ? 'v2' : 'v3';
}

interface ConversionRow {
  kind: 'dropped' | 'transformed' | 'kept';
  label: string;
  count: number;
  values?: string[];
}

const CONVERT_MAX_VALUES = 4; // sample values per report row

interface ConversionPlan {
  source: PackFormat;
  target: PackFormat;
  rows: ConversionRow[];
  data: PackData;
}

function conversionTally() {
  const rows = new Map<string, ConversionRow>();
  return {
    note(kind: ConversionRow['kind'], label: string, count = 1, value?: unknown) {
      if (count <= 0) return;
      const row = rows.get(`${kind}:${label}`) ?? { kind, label, count: 0 };
      row.count += count;
      if (value !== undefined) {
        const seen = row.values ?? [];
        const text = String(value);
        if (!seen.includes(text)) seen.push(text);
        row.values = seen;
      }
      rows.set(`${kind}:${label}`, row);
    },
    rows(): ConversionRow[] {
      const order: ConversionRow['kind'][] = ['dropped', 'transformed', 'kept'];
      return [...rows.values()].sort(
        (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.label.localeCompare(b.label),
      );
    },
  };
}

type Tally = ReturnType<typeof conversionTally>;

const CONVERT_BONUS_LABEL_TABLE =
  'range:Range|damage:Damage|attack_roll:Attack roll|tech_attack:Tech attack|hp:HP|armor:Armor|' +
  'structure:Structure|stress:Stress|heatcap:Heat cap|repcap:Repair cap|speed:Speed|evasion:Evasion|' +
  'edef:E-Defense|sensor:Sensors|attack:Attack|grapple:Grapple|ram:Ram|save:Save|sp:SP|size:Size|' +
  'boost:Boost|armor_max:Max armor|accuracy:Accuracy|thrown:Thrown|threat:Threat|hull:Hull|' +
  'agility:Agility|engineering:Engineering|systems:Systems|hull_check:Hull checks|' +
  'agility_check:Agility checks|engineering_check:Engineering checks|systems_check:Systems checks|' +
  'hull_save:Hull saves|agility_save:Agility saves|engineering_save:Engineering saves|' +
  'systems_save:Systems saves|deploy_count:Deploy count|skill_point:Skill points|' +
  'mech_skill_point:Mech skill points|talent_point:Talent points|license_point:License points|' +
  'cb_point:CORE bonus points|ai_cap:AI capacity|cheap_struct:Cheap structure repair|' +
  'cheap_stress:Cheap stress repair|overcharge:Overcharge track|limited_bonus:Limited uses|' +
  'pilot_hp:Pilot HP|pilot_armor:Pilot armor|pilot_evasion:Pilot evasion|pilot_edef:Pilot E-Defense|' +
  'pilot_speed:Pilot speed|pilot_armor_slots:Pilot armor slots|pilot_gear_slots:Pilot gear slots|' +
  'pilot_weapon_slots:Pilot weapon slots|mount_accuracy:Mounted accuracy|mount_range:Mounted range|' +
  'mount_damage:Mounted damage|mount_damage_type:Mounted damage type|mount_range_type:Mounted range type|' +
  'mount_weapon_type:Mounted weapon type|add_mount:Extra mount|sizes:Size options|activations:Activations|' +
  'activations_pct:Activations per PC|no_mods:No mods|core_power:CORE power|' +
  'deployable_hp:Deployable HP|deployable_resist:Deployable resistance|drone_hp:Drone HP|' +
  'drone_resist:Drone resistance|extra_action:Extra action|immunity:Immunity|knockback:Knockback|' +
  'melee:Melee|no_cascade:No cascade|superheavy_mounting:Superheavy mounting';

const CONVERT_BONUS_LABELS: Record<string, string> = Object.fromEntries(
  CONVERT_BONUS_LABEL_TABLE.split('|').map((pair) => {
    const at = pair.indexOf(':');
    return [pair.slice(0, at), pair.slice(at + 1)];
  }),
);

function convertKeyLabel(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words === '' ? key : words.charAt(0).toUpperCase() + words.slice(1);
}

function objectRows(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : [value]).filter(isPlainObject);
}

function convertValueSummary(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (value === true) return 'yes';
  if (Array.isArray(value)) return value.map((cell) => convertValueSummary(cell)).filter((text) => text !== '').join(', ');
  if (isPlainObject(value)) {
    const named = joinParts([asText(value['name']), asText(value['detail'])], ': ');
    if (named !== '') return named;
    return Object.entries(value)
      .map(([inner, cell]) => joinParts([convertKeyLabel(inner), convertValueSummary(cell)], ' '))
      .filter((text) => text !== '')
      .join(', ');
  }
  return asText(value).trim();
}

function convertActionLine(row: Record<string, unknown>): string {
  const head = joinParts([asText(row['name']), asText(row['activation']), asText(row['frequency'])], ' - ');
  const body = joinParts([asText(row['trigger']), asText(row['detail'])], ' ');
  return joinParts([head, body], ': ');
}

function convertCounterLine(row: Record<string, unknown>): string {
  const range = joinParts([asText(row['min']), asText(row['max'])], '-');
  const start = asText(row['default_value']);
  const detail = joinParts([start === '' ? '' : `start ${start}`, range === '' ? '' : `range ${range}`], ', ');
  return joinParts([`Counter: ${asText(row['name']) || asText(row['id'])}`, detail], ' (') + (detail === '' ? '' : ')');
}

function convertBonusLine(row: Record<string, unknown>): string {
  const id = asText(row['id']).trim();
  if (id === '') return '';
  const label = CONVERT_BONUS_LABELS[id] ?? id;
  const raw = row['val'];
  const value = raw === true ? '' : raw === undefined ? asText(row['accuracy']) : convertValueSummary(raw);
  const scope = joinParts(
    [convertValueSummary(row['weapon_types']), convertValueSummary(row['range_types']), convertValueSummary(row['damage_types'])],
    ', ',
  );
  const mode = row['replace'] === true ? 'replace' : row['override'] === true || row['overwrite'] === true ? 'override' : '';
  const tail = joinParts([scope, mode], '; ');
  return joinParts([`Bonus: ${label}`, value], ' ') + (tail === '' ? '' : ` (${tail})`);
}

function convertDeployableLine(row: Record<string, unknown>): string {
  const head = joinParts([asText(row['name']), asText(row['type']), asText(row['activation'])], ' - ');
  const stats = joinParts(
    [
      asText(row['size']) === '' ? '' : `size ${asText(row['size'])}`,
      asText(row['hp']) === '' ? '' : `HP ${asText(row['hp'])}`,
      asText(row['armor']) === '' ? '' : `armor ${asText(row['armor'])}`,
      asText(row['evasion']) === '' ? '' : `evasion ${asText(row['evasion'])}`,
      asText(row['edef']) === '' ? '' : `edef ${asText(row['edef'])}`,
    ],
    ', ',
  );
  return joinParts([`Deployable: ${head}`, joinParts([asText(row['detail']) || asText(row['description']), stats], ' ')], ': ');
}

function convertFoldText(key: string, value: unknown): string {
  if (value === undefined || value === null || value === false) return '';
  switch (key) {
    case 'active_effects':
    case 'passive_effects':
      return objectRows(value)
        .map((row) => joinParts([asText(row['name']), joinParts([asText(row['condition']), asText(row['detail'])], ' ')], ': '))
        .filter((text) => text !== '')
        .join('<br>');
    case 'bonuses':
      return objectRows(value).map(convertBonusLine).filter((text) => text !== '').join('<br>');
    case 'synergies':
      return objectRows(value)
        .map((row) => joinParts(['Synergy', convertValueSummary(row['locations']), asText(row['detail'])], ': '))
        .filter((text) => text !== '')
        .join('<br>');
    case 'actions':
      return objectRows(value).map(convertActionLine).filter((text) => text !== '').join('<br>');
    case 'counters':
    case 'active_counters':
      return objectRows(value).map(convertCounterLine).filter((text) => text !== '').join('<br>');
    case 'deployables':
      return objectRows(value).map(convertDeployableLine).filter((text) => text !== '').join('<br>');
    case 'ammo':
      return objectRows(value)
        .map((row) => joinParts([`Ammo: ${asText(row['name'])}`, asText(row['detail'])], ': '))
        .filter((text) => text !== '')
        .join('<br>');
    case 'damage':
    case 'added_damage':
    case 'bonus_damage':
      return v2DamageText(Array.isArray(value) ? value : [value]);
    case 'add_status':
      return v2StatusText(value);
    case 'on_hit': {
      const row = isPlainObject(value) ? value : {};
      const body = joinParts(
        [v2OnHit(value), v2DamageText(row['damage']), asText(row['activation']) === '' ? '' : `Activation: ${asText(row['activation'])}`],
        ' ',
      );
      return joinParts(['On hit', body === '' ? convertValueSummary(value) : body], ': ');
    }
    case 'on_crit':
      return joinParts(['On crit', convertValueSummary(value)], ': ');
    default:
      break;
  }
  const label = convertKeyLabel(key);
  if (value === true) return `${label}.`;
  const summary = convertValueSummary(value);
  return summary === '' ? '' : `${label}: ${summary}`;
}

function appendFoldText(out: any, field: string, text: string): void {
  if (text === '') return;
  const existing = asText(out[field]).trim();
  out[field] = existing === '' ? text : `${existing}<br>${text}`;
}

function foldFields(item: any, out: any, file: string, keys: string[], tally: Tally, target: PackFormat): number {
  const field = convertTextField(file);
  let folded = 0;
  for (const key of keys) {
    if (!(key in item)) continue;
    const text = convertFoldText(key, item[key]);
    appendFoldText(out, field, text);
    delete out[key];
    tally.note(
      'transformed',
      text === ''
        ? `${file} ${key} carried no ${target} text (empty)`
        : `${file} ${key} folded into ${field}`,
    );
    folded += 1;
  }
  return folded;
}

const CONVERT_TITLE_KEEP = new Set(['CQB', 'SP', 'AI', 'HP']);

function convertTitleWords(value: unknown): string {
  return asText(value)
    .split(' ')
    .map((word) => {
      const upper = word.toUpperCase();
      if (CONVERT_TITLE_KEEP.has(upper)) return upper;
      return word === '' ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function convertLowerWords(value: unknown): string {
  return asText(value).toLowerCase();
}

// function convertSlug(value: unknown): string {
//   return asText(value)
//     .toLowerCase()
//     .replace(/[^a-z0-9]+/g, '_')
//     .replace(/^_+|_+$/g, '');
// }

const CONVERT_TRIGGER_PREFIX = 'Example triggers:';

interface ConvertIndex {
  skillIds: Set<string>;
}

function conversionIndex(data: PackData): ConvertIndex {
  const skillIds = new Set<string>();
  for (const item of conversionItems(data, 'skills.json')) {
    const id = asText(item.id).trim();
    if (id !== '') skillIds.add(id);
  }
  return { skillIds };
}

function v3SkillIds(value: unknown, known?: Set<string>): { ids: string[]; unresolved: string[] } {
  const text = asText(value).trim();
  const body = text.startsWith(CONVERT_TRIGGER_PREFIX) ? text.slice(CONVERT_TRIGGER_PREFIX.length) : text;
  const ids: string[] = [];
  const unresolved: string[] = [];
  for (const part of body.split(',')) {
    const slug = slugifyName(asText(part));
    if (slug === '') continue;
    const id = `sk_${slug}`;
    if (known === undefined || known.size === 0 || known.has(id)) ids.push(id);
    else unresolved.push(part.trim());
  }
  return { ids, unresolved };
}

const CONVERT_PILOT_GEAR_BONUS: Record<string, string> = {
  hp_bonus: 'pilot_hp',
  armor: 'pilot_armor',
  evasion: 'pilot_evasion',
  edef: 'pilot_edef',
  speed: 'pilot_speed',
};

const CONVERT_PILOT_GEAR_REPLACE = new Set(['evasion', 'edef', 'speed']);

function mapActions(item: any, out: any, target: PackFormat, tally: Tally): void {
  if (target !== 'v3') return;
  if ('action_type' in item) {
    out.activation = convertTitleWords(item.action_type);
    tally.note('transformed', 'actions.json action_type -> activation');
  }
  if ('description' in item) {
    if (asText(item.terse).trim() === '') {
      out.terse = item.description;
      tally.note('transformed', 'actions.json description -> terse');
    } else {
      appendFoldText(out, convertTextField('actions.json'), convertFoldText('description', item.description));
      tally.note('transformed', 'actions.json description folded into detail');
    }
  }
}

function mapBackgrounds(item: any, out: any, target: PackFormat, tally: Tally, index: ConvertIndex): void {
  if (target !== 'v3' || !('triggers' in item)) return;
  const field = convertTextField('backgrounds.json');
  if (Array.isArray(item.skills)) {
    appendFoldText(out, field, convertFoldText('triggers', item.triggers));
    tally.note('transformed', 'backgrounds.json triggers folded into description');
    return;
  }
  const { ids, unresolved } = v3SkillIds(item.triggers, index.skillIds);
  if (ids.length > 0) {
    out.skills = ids;
    tally.note('transformed', 'backgrounds.json triggers -> skills', ids.length);
  }
  if (unresolved.length === 0) return;
  appendFoldText(out, field, `${CONVERT_TRIGGER_PREFIX} ${unresolved.join(', ')}`);
  tally.note('transformed', 'backgrounds.json triggers with no skill id folded into description', unresolved.length);
}

function mapManufacturers(item: any, out: any, target: PackFormat, tally: Tally): void {
  if (target === 'v2' && ('light' in item || 'dark' in item)) {
    out.color = asText(item.light) === '' ? item.dark : item.light;
    tally.note('transformed', 'manufacturers.json light/dark -> color');
    return;
  }
  if (target === 'v3' && 'color' in item) {
    out.light = item.color;
    out.dark = item.color;
    tally.note('transformed', 'manufacturers.json color -> light/dark');
  }
}

function mapMods(item: any, out: any, target: PackFormat, tally: Tally): void {
  const words = (value: unknown, shape: (cell: unknown) => string) =>
    (Array.isArray(value) ? value : []).map((cell) => shape(cell));
  if (target === 'v3') {
    if ('applied_to' in item) {
      out.allowed_types = words(item.applied_to, convertTitleWords);
      tally.note('transformed', 'mods.json applied_to -> allowed_types');
    }
    if ('restricted_mounts' in item) {
      out.restricted_sizes = words(item.restricted_mounts, convertTitleWords);
      tally.note('transformed', 'mods.json restricted_mounts -> restricted_sizes');
    }
    if ('added_damage' in item) {
      out.added_damage = Array.isArray(item.added_damage) ? item.added_damage : [item.added_damage];
      tally.note('transformed', 'mods.json added_damage -> damage rows');
    }
    return;
  }
  if ('restricted_sizes' in item) {
    out.restricted_mounts = words(item.restricted_sizes, convertLowerWords);
    tally.note('transformed', 'mods.json restricted_sizes -> restricted_mounts');
  }
  if (!('added_damage' in item) && isPlainObject(item.on_hit)) {
    const rows = (Array.isArray(item.on_hit.damage) ? item.on_hit.damage : [])
      .filter(isPlainObject)
      .map((row: any) => ({ ...row, type: asText(row.type).toLowerCase() }));
    if (rows.length > 0) {
      out.added_damage = rows.length === 1 ? rows[0] : rows;
      tally.note('transformed', 'mods.json on_hit.damage -> added_damage');
    }
  }
}

function mapPilotGear(item: any, out: any, target: PackFormat, tally: Tally): void {
  if (target !== 'v3') return;
  const rows: any[] = Array.isArray(out.bonuses) ? out.bonuses : [];
  let moved = 0;
  for (const [key, id] of Object.entries(CONVERT_PILOT_GEAR_BONUS)) {
    if (!(key in item)) continue;
    const row: any = { id, val: item[key] };
    if (CONVERT_PILOT_GEAR_REPLACE.has(key)) row.replace = true;
    rows.push(row);
    moved += 1;
  }
  if (moved === 0) return;
  out.bonuses = rows;
  tally.note('transformed', 'pilot_gear.json stat fields -> bonuses rows', moved);
}

function mapStatuses(item: any, out: any, target: PackFormat, tally: Tally): void {
  if (target !== 'v3' || asText(item.id).trim() !== '') return;
  const id = statusIdFor(asText(item.name));
  if (id === '') return;
  out.id = id;
  tally.note('transformed', 'statuses.json id derived from name', 1, id);
}

function mapTalents(item: any, out: any, target: PackFormat, tally: Tally): void {
  if (target !== 'v3') return;
  const ranks: any[] = Array.isArray(out.ranks) ? out.ranks : [];
  let moved = 0;
  let stranded = 0;
  for (const row of objectRows(item.counters)) {
    const level = Number(asText(row['level']));
    const at = Number.isFinite(level) && level >= 1 ? level - 1 : 0;
    const rank = ranks[at];
    if (rank === undefined || !isPlainObject(rank)) {
      appendFoldText(out, convertTextField('talents.json'), convertFoldText('counters', [row]));
      stranded += 1;
      continue;
    }
    const counter: any = {};
    for (const [key, cell] of Object.entries(row)) if (key !== 'level') counter[key] = cell;
    rank.counters = [...(Array.isArray(rank.counters) ? rank.counters : []), counter];
    moved += 1;
  }
  if (moved > 0) tally.note('transformed', 'talents.json counters -> rank counters', moved);
  if (stranded > 0) tally.note('transformed', 'talents.json counters folded into description', stranded);
}

const V2_EFFECT_OBJECT_SKIP_KEYS = new Set(['effect_type', 'detail']);

function mapV2EffectObject(item: any, out: any, file: string, target: PackFormat, tally: Tally): void {
  if (target !== 'v3') return;
  const value = item.effect;
  if (typeof value === 'string' || value === undefined || value === null) return;
  if (isPlainObject(value)) {
    const effectType = asText((value as any)['effect_type']).trim();
    if (effectType === 'Bonus') {
      const rows: any[] = Array.isArray(out.bonuses) ? out.bonuses : [];
      let moved = 0;
      for (const [key, cell] of Object.entries(value)) {
        if (V2_EFFECT_OBJECT_SKIP_KEYS.has(key) || typeof cell !== 'number') continue;
        rows.push({ id: key, val: cell });
        moved += 1;
      }
      out.effect = asText((value as any)['detail']);
      if (moved > 0) out.bonuses = rows;
      tally.note('transformed', `${file} effect object (Bonus) -> effect text + bonuses rows`, moved > 0 ? moved : 1);
      return;
    }
    out.effect = value;
    tally.note(
      'kept',
      `${file} effect object (effect_type ${effectType === '' ? '(none)' : effectType}) left v2-shaped`,
      1,
    );
    return;
  }
  out.effect = value;
  tally.note('kept', `${file} effect array left v2-shaped`, 1);
}

function applyFieldMaps(item: any, out: any, file: string, target: PackFormat, tally: Tally, index: ConvertIndex): void {
  if (file === 'actions.json') mapActions(item, out, target, tally);
  else if (file === 'backgrounds.json') mapBackgrounds(item, out, target, tally, index);
  else if (file === 'manufacturers.json') mapManufacturers(item, out, target, tally);
  else if (file === 'mods.json') mapMods(item, out, target, tally);
  else if (file === 'pilot_gear.json') mapPilotGear(item, out, target, tally);
  else if (file === 'statuses.json') mapStatuses(item, out, target, tally);
  else if (file === 'talents.json') mapTalents(item, out, target, tally);
  else if (file === 'systems.json' || file === 'weapons.json') mapV2EffectObject(item, out, file, target, tally);
}

function convertGenericItem(item: any, file: string, target: PackFormat, tally: Tally, index: ConvertIndex): any {
  const table = (target === 'v3' ? CONVERT_V2_ONLY_FIELDS[file] : CONVERT_V3_ONLY_FIELDS[file]) ?? {};
  const out: any = {};
  for (const [key, cell] of Object.entries(item)) {
    const plan = table[key];
    if (plan === 'drop') {
      tally.note('dropped', `${file} ${key}`);
      continue;
    }
    if (plan === 'fold' || plan === 'map') continue;
    if (plan === 'carry') tally.note('kept', `${file} ${key} (no ${target} slot)`);
    out[key] = cell;
  }
  applyFieldMaps(item, out, file, target, tally, index);
  foldFields(item, out, file, Object.keys(table).filter((key) => table[key] === 'fold'), tally, target);
  return out;
}

function conversionItems(data: PackData, file: string): any[] {
  const list = data[file];
  return Array.isArray(list) ? list.filter((entry) => isPlainObject(entry)) : [];
}

function conversionOwners(data: PackData): { byName: Map<string, any>; byId: Map<string, { item: any; kind: string }> } {
  const byName = new Map<string, any>();
  const byId = new Map<string, { item: any; kind: string }>();
  for (const [file, kind] of [
    [NPC_CLASS_FILE, 'Class'],
    [NPC_TEMPLATE_FILE, 'Template'],
  ] as const) {
    for (const item of conversionItems(data, file)) {
      const name = asText(item.name);
      const id = asText(item.id);
      if (name !== '' && !byName.has(name)) byName.set(name, item);
      if (id !== '') byId.set(id, { item, kind });
    }
  }
  return { byName, byId };
}

function conversionFeatures(data: PackData): any[] {
  const out: any[] = [];
  for (const value of Object.values(data)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (!isPlainObject(entry)) continue;
      if (npcKindOf(entry) === 'feature') out.push(entry);
    }
  }
  return out;
}

function v3SizeValue(raw: unknown): unknown {
  if (!Array.isArray(raw) || raw.length !== V2_TIER_CELLS) return raw;
  const cells = raw.map((cell) => (Array.isArray(cell) && cell.length === 1 ? cell[0] : undefined));
  if (cells.some((cell) => cell === undefined)) return raw;
  return cells.every((cell) => cell === cells[0]) ? cells[0] : raw;
}

function v2SizeValue(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  return Array.from({ length: V2_TIER_CELLS }, () => [raw]);
}

function v3StatValue(raw: unknown): unknown {
  if (!Array.isArray(raw) || raw.length !== V2_TIER_CELLS) return raw;
  if (raw.some((cell) => cell === null || typeof cell === 'object')) return raw;
  return raw.every((cell) => cell === raw[0]) ? raw[0] : raw;
}

function convertLinkFeatures(out: any, item: any, file: string, features: any[], tally: Tally): void {
  const link = deriveFeatureLinks(item, features);
  out.base_features = link.base;
  out.optional_features = link.optional;
  tally.note('transformed', `${file} feature links rebuilt from origin + base`, 1);
}

function convertNpcClass(item: any, target: PackFormat, tally: Tally, features: any[]): any {
  const out: any = {};
  for (const [key, value] of Object.entries(item)) {
    if (target === 'v3') {
      if (key === 'power') {
        tally.note('dropped', `${NPC_CLASS_FILE} power`);
        continue;
      }
    } else if (key === 'optionalClassMin' || key === 'optionalClassMax' || key === 'prohibitTemplates') {
      tally.note('dropped', `${NPC_CLASS_FILE} ${key}`);
      continue;
    }
    if (key === 'info' && isPlainObject(value)) {
      const info: any = {};
      for (const [inner, text] of Object.entries(value as Record<string, unknown>)) {
        if (target === 'v2' && CONVERT_INFO_DROP_V3_ONLY.includes(inner)) {
          tally.note('dropped', `${NPC_CLASS_FILE} info.${inner}`);
          continue;
        }
        info[inner] = text;
      }
      out.info = info;
      continue;
    }
    if (key === 'stats' && isPlainObject(value)) {
      const stats: any = {};
      let tiered = 0;
      for (const [stat, cell] of Object.entries(value as Record<string, unknown>)) {
        if (stat === 'size') {
          stats.size = target === 'v3' ? v3SizeValue(cell) : v2SizeValue(cell);
          continue;
        }
        if (target === 'v2' && !Array.isArray(cell)) {
          stats[stat] = v2TierValue(cell);
          tiered += 1;
          continue;
        }
        if (target === 'v3') {
          const collapsed = v3StatValue(cell);
          stats[stat] = collapsed;
          if (collapsed !== cell) tiered += 1;
          continue;
        }
        stats[stat] = cell;
      }
      out.stats = stats;
      if (tiered > 0) {
        tally.note(
          'transformed',
          `${NPC_CLASS_FILE} stats ${target === 'v2' ? 'scalar -> tier triple' : 'uniform tier triple -> scalar'}`,
          1,
        );
      }
      tally.note('transformed', `${NPC_CLASS_FILE} stats.size ${target === 'v3' ? 'nested -> scalar' : 'scalar -> nested'}`);
      continue;
    }
    out[key] = value;
  }
  if (target === 'v2') {
    convertLinkFeatures(out, item, NPC_CLASS_FILE, features, tally);
    if (out.power === undefined) {
      out.power = V2_CLASS_POWER;
      tally.note('transformed', `${NPC_CLASS_FILE} power added (${V2_CLASS_POWER})`);
    }
  }
  return out;
}

function convertNpcTemplate(item: any, target: PackFormat, tally: Tally, features: any[]): any {
  const out: any = {};
  const table = (target === 'v3' ? CONVERT_V2_ONLY_FIELDS[NPC_TEMPLATE_FILE] : CONVERT_V3_ONLY_FIELDS[NPC_TEMPLATE_FILE]) ?? {};
  const folds = Object.keys(table).filter((key) => table[key] === 'fold');
  for (const [key, value] of Object.entries(item)) {
    if (target === 'v3' && key === 'power') {
      tally.note('dropped', `${NPC_TEMPLATE_FILE} power`, 1, value);
      continue;
    }
    if (target === 'v2' && key === 'template') {
      tally.note('dropped', `${NPC_TEMPLATE_FILE} template`);
      continue;
    }
    if (table[key] === 'drop') {
      tally.note('dropped', `${NPC_TEMPLATE_FILE} ${key}`);
      continue;
    }
    if (table[key] === 'fold') continue;
    out[key] = value;
  }
  foldFields(item, out, NPC_TEMPLATE_FILE, folds, tally, target);
  if (target === 'v3' && out.template === undefined) {
    out.template = true;
    tally.note('transformed', `${NPC_TEMPLATE_FILE} template flag added`);
  }
  if (target === 'v2') {
    convertLinkFeatures(out, item, NPC_TEMPLATE_FILE, features, tally);
    if (out.power === undefined) {
      out.power = V2_TEMPLATE_POWER;
      tally.note('transformed', `${NPC_TEMPLATE_FILE} power added (${V2_TEMPLATE_POWER})`);
    }
  }
  return out;
}

function convertDamageRows(value: unknown, target: PackFormat): any[] {
  const from = target === 'v3' ? 'damage' : 'val';
  const to = target === 'v3' ? 'val' : 'damage';
  const out: any[] = [];
  for (const row of Array.isArray(value) ? value : []) {
    if (!isPlainObject(row)) continue;
    const next: any = {};
    for (const [key, cell] of Object.entries(row as Record<string, unknown>)) {
      if (key === from) next[to] = target === 'v2' ? v2TierValue(cell) : v3StatValue(cell);
      else next[key] = cell;
    }
    out.push(next);
  }
  return out;
}

function npcFeatureTextFolds(target: PackFormat): string[] {
  if (target === 'v3') return CONVERT_FOLD_V2_ONLY[NPC_FEATURE_FILE] ?? [];
  return (CONVERT_FOLD_V3_ONLY[NPC_FEATURE_FILE] ?? []).filter(
    (key) => !V2_FOLDED_FEATURE_KEYS.includes(key) && key !== 'actions',
  );
}

function convertNpcFeature(
  item: any,
  target: PackFormat,
  owners: ReturnType<typeof conversionOwners>,
  tally: Tally,
): any {
  const out: any = {};
  const drops = (target === 'v3' ? CONVERT_DROP_V2_ONLY[NPC_FEATURE_FILE] : CONVERT_DROP_V3_ONLY[NPC_FEATURE_FILE]) ?? [];
  const folds = npcFeatureTextFolds(target);
  const carries = (target === 'v3' ? CONVERT_V2_ONLY_FIELDS[NPC_FEATURE_FILE] : CONVERT_V3_ONLY_FIELDS[NPC_FEATURE_FILE]) ?? {};

  for (const [key, value] of Object.entries(item)) {
    if (drops.includes(key)) {
      tally.note('dropped', `${NPC_FEATURE_FILE} ${key}`);
      continue;
    }
    if (folds.includes(key)) continue;
    if (carries[key] === 'carry') {
      tally.note('kept', `${NPC_FEATURE_FILE} ${key} (no ${target} slot)`);
      out[key] = value;
      continue;
    }
    if ((key === 'immunity' || key === 'resistance') && target === 'v3') {
      const rows: any[] = Array.isArray(out.add_resist) ? out.add_resist : [];
      for (const cell of Array.isArray(value) ? value : [value]) rows.push({ [key]: cell });
      out.add_resist = rows;
      tally.note('transformed', `${NPC_FEATURE_FILE} ${key} -> add_resist rows`);
      continue;
    }
    if (key === 'add_resist' && target === 'v2') {
      let scoped = 0;
      for (const row of Array.isArray(value) ? value : []) {
        if (!isPlainObject(row)) continue;
        const cell = row as Record<string, unknown>;
        for (const side of ['immunity', 'resistance']) {
          if (cell[side] === undefined) continue;
          out[side] = [...(Array.isArray(out[side]) ? out[side] : []), cell[side]];
        }
        for (const extra of Object.keys(cell)) if (extra !== 'immunity' && extra !== 'resistance') scoped += 1;
      }
      tally.note('transformed', `${NPC_FEATURE_FILE} add_resist rows -> immunity/resistance`);
      if (scoped > 0) tally.note('dropped', `${NPC_FEATURE_FILE} add_resist row scope`, scoped);
      continue;
    }
    if (key === 'base' && target === 'v2') continue;
    if (key === 'origin') {
      if (target === 'v3') {
        const owner = isPlainObject(value) ? (value as any) : null;
        const match = owner === null ? undefined : owners.byName.get(asText(owner.name));
        out.origin = match === undefined ? asText(owner?.name) : asText(match.id);
        out.base = owner?.base === true;
        tally.note('transformed', `${NPC_FEATURE_FILE} origin object -> origin id + base`);
      } else {
        const originId = asText(value);
        const match = owners.byId.get(originId);
        const kind = match !== undefined ? match.kind : originId === '' ? '' : 'Class';
        out.origin = {
          type: kind,
          name: match === undefined ? originId : asText(match.item.name),
          base: featureIsBase(item),
        };
        out.locked = false;
        tally.note('transformed', `${NPC_FEATURE_FILE} origin id + base -> origin object`);
      }
      continue;
    }
    if (key === 'damage') {
      out.damage = convertDamageRows(value, target);
      tally.note('transformed', `${NPC_FEATURE_FILE} damage row ${target === 'v3' ? 'damage -> val' : 'val -> damage'}`);
      continue;
    }
    if ((key === 'accuracy' || key === 'attack_bonus') && target === 'v3') {
      const collapsed = v3StatValue(value);
      out[key] = collapsed;
      if (collapsed !== value) tally.note('transformed', `${NPC_FEATURE_FILE} ${key} tier triple -> scalar`);
      continue;
    }
    if ((key === 'accuracy' || key === 'attack_bonus') && target === 'v2') {
      const cells = v2TierCells(value);
      out[key] = cells;
      if (JSON.stringify(cells) !== JSON.stringify(value)) {
        tally.note('transformed', `${NPC_FEATURE_FILE} ${key} scalar -> tier triple`);
      }
      continue;
    }
    if (target === 'v2' && V2_FOLDED_FEATURE_KEYS.includes(key)) {
      tally.note('transformed', `${NPC_FEATURE_FILE} ${key} folded into effect`);
      continue;
    }
    if (key === 'on_hit' && target === 'v2' && value !== null && typeof value === 'object') {
      out.on_hit = v2OnHit(value);
      tally.note('transformed', `${NPC_FEATURE_FILE} on_hit object -> text`);
      continue;
    }
    if (key === 'bonuses' && target === 'v2') {
      const split = v2Bonuses(value);
      if (split.bonus !== undefined) out.bonus = split.bonus;
      if (split.override !== undefined) out.override = split.override;
      tally.note('transformed', `${NPC_FEATURE_FILE} bonuses rows -> bonus/override`);
      continue;
    }
    if ((key === 'bonus' || key === 'override') && target === 'v3') {
      const rows = Array.isArray(out.bonuses) ? out.bonuses : [];
      for (const [stat, cell] of Object.entries((value ?? {}) as Record<string, unknown>)) {
        const row: any = { id: stat, val: cell };
        if (key === 'override') row.override = true;
        rows.push(row);
      }
      out.bonuses = rows;
      tally.note('transformed', `${NPC_FEATURE_FILE} bonus/override -> bonuses rows`);
      continue;
    }
    if (key === 'actions' && target === 'v2') {
      tally.note('transformed', `${NPC_FEATURE_FILE} actions folded into effect`);
      continue;
    }
    out[key] = value;
  }

  if (target === 'v3') {
    foldFields(item, out, NPC_FEATURE_FILE, folds, tally, target);
    return out;
  }

  const type = v2FeatureType(out.type);
  if (type !== asText(out.type)) {
    tally.note('transformed', `${NPC_FEATURE_FILE} type ${asText(out.type) === '' ? '(none)' : asText(out.type)} -> Trait`);
  }
  out.type = type;
  const effect = v2EffectText({ ...item, effect: out.effect }, type);
  if (effect !== asText(out.effect)) out.effect = effect;
  else if (out.effect === undefined) {
    out.effect = '';
    tally.note('transformed', `${NPC_FEATURE_FILE} effect added (empty)`);
  }
  foldFields(item, out, NPC_FEATURE_FILE, folds, tally, target);
  if (type === 'Weapon') {
    let completed = 0;
    if (out.attack_bonus === undefined) {
      out.attack_bonus = v2TierCells(0);
      completed += 1;
    }
    if (!Array.isArray(out.damage)) {
      out.damage = [];
      completed += 1;
    }
    if (!Array.isArray(out.range)) {
      out.range = [];
      completed += 1;
    }
    if (out.on_hit === undefined) {
      out.on_hit = '';
      completed += 1;
    }
    if (completed > 0) tally.note('transformed', `${NPC_FEATURE_FILE} weapon attack rows completed`, completed);
  } else {
    for (const key of ['weapon_type', 'damage', 'range', 'on_hit']) {
      if (out[key] === undefined) continue;
      delete out[key];
      tally.note('dropped', `${NPC_FEATURE_FILE} ${key} on a ${type} feature`);
    }
  }
  if (out.locked === undefined) {
    out.locked = false;
    tally.note('transformed', `${NPC_FEATURE_FILE} locked added (false)`);
  }
  return out;
}

function existingNpcIds(list: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(list)) return ids;
  for (const item of list) {
    if (!isPlainObject(item)) continue;
    const id = asText((item as any).id).trim();
    if (id !== '') ids.add(id);
  }
  return ids;
}

function mergeAggregateOwners(
  owners: ReturnType<typeof conversionOwners>,
  data: PackData,
  aggregateFiles: Set<string>,
): void {
  for (const file of aggregateFiles) {
    for (const item of conversionItems(data, file)) {
      const kind = npcKindOf(item);
      if (kind !== 'class' && kind !== 'template') continue;
      const entry = item as any;
      const name = asText(entry.name);
      const id = asText(entry.id);
      if (name !== '' && !owners.byName.has(name)) owners.byName.set(name, entry);
      if (id !== '') owners.byId.set(id, { item: entry, kind: kind === 'class' ? 'Class' : 'Template' });
    }
  }
}

// wallflower packs ship one file per npc. split them back into the standard three
function foldAggregateNpcFiles(
  source: PackData,
  aggregateFiles: Set<string>,
  data: PackData,
  target: PackFormat,
  tally: Tally,
  owners: ReturnType<typeof conversionOwners>,
  features: any[],
): void {
  const seen: Record<string, Set<string>> = {
    [NPC_CLASS_FILE]: existingNpcIds(data[NPC_CLASS_FILE]),
    [NPC_TEMPLATE_FILE]: existingNpcIds(data[NPC_TEMPLATE_FILE]),
    [NPC_FEATURE_FILE]: existingNpcIds(data[NPC_FEATURE_FILE]),
  };
  for (const file of [...aggregateFiles].sort((a, b) => a.localeCompare(b))) {
    for (const entry of conversionItems(source, file)) {
      const kind = npcKindOf(entry);
      if (kind === null) continue;
      const targetFile = NPC_CATEGORY_BY_KIND[kind];
      const id = asText(entry.id).trim();
      if (id !== '' && seen[targetFile].has(id)) {
        tally.note('dropped', `${file} ${id} (duplicate of an existing ${targetFile} entry)`);
        continue;
      }
      const item = JSON.parse(JSON.stringify(entry));
      const next =
        kind === 'class'
          ? convertNpcClass(item, target, tally, features)
          : kind === 'template'
            ? convertNpcTemplate(item, target, tally, features)
            : convertNpcFeature(item, target, owners, tally);
      const list = Array.isArray(data[targetFile]) ? (data[targetFile] as any[]) : (data[targetFile] = []);
      list.push(next);
      if (id !== '') seen[targetFile].add(id);
      tally.note('transformed', `${file} item folded into ${targetFile}`, 1, id === '' ? undefined : id);
    }
  }
}

export function planConversion(pack: PackDraft, target: PackFormat): ConversionPlan {
  const source = packFormatOf(pack);
  const tally = conversionTally();
  const data: PackData = {};
  const owners = conversionOwners(pack.data);
  const aggregateFiles = target === 'v2' ? new Set(npcAggregateFiles(pack)) : new Set<string>();
  if (aggregateFiles.size > 0) mergeAggregateOwners(owners, pack.data, aggregateFiles);
  const features = target === 'v2' ? conversionFeatures(pack.data) : [];
  const index = conversionIndex(pack.data);

  for (const [file, value] of Object.entries(pack.data)) {
    if (file === PACK_MANIFEST) {
      const manifest = JSON.parse(JSON.stringify(value ?? {}));
      const isManifestObject = isPlainObject(manifest);
      if (target === 'v3' && isManifestObject) {
        stampFormat(manifest, 'v3');
        tally.note('transformed', `${PACK_MANIFEST} v3 flag added`);
      } else if (target === 'v3') {
        tally.note('dropped', `${PACK_MANIFEST} v3 flag not added (manifest is not an object)`);
      } else if (isManifestObject && manifest['v3'] !== undefined) {
        delete manifest['v3'];
        tally.note('transformed', `${PACK_MANIFEST} v3 flag removed`);
      }
      data[file] = manifest;
      continue;
    }
    if (file === EIDOLON_LAYERS && target === 'v2') {
      tally.note('dropped', `${EIDOLON_LAYERS} (whole file, v3 only)`, conversionItems(pack.data, file).length);
      continue;
    }
    if (aggregateFiles.has(file)) {
      tally.note('dropped', `${file} (aggregate NPC file, folded into standard files)`, conversionItems(pack.data, file).length);
      continue;
    }
    if (!Array.isArray(value)) {
      const copied = JSON.parse(JSON.stringify(value ?? null));
      const hasPlan = (target === 'v3' ? CONVERT_V2_ONLY_FIELDS[file] : CONVERT_V3_ONLY_FIELDS[file]) !== undefined;
      data[file] =
        hasPlan && isPlainObject(copied)
          ? convertGenericItem(copied, file, target, tally, index)
          : copied;
      continue;
    }

    const converted: any[] = [];
    let touched = 0;
    for (const entry of value) {
      if (!isPlainObject(entry)) {
        converted.push(entry);
        continue;
      }
      const item = JSON.parse(JSON.stringify(entry));
      const mark = JSON.stringify(item);
      let next: any;
      if (file === NPC_CLASS_FILE) next = convertNpcClass(item, target, tally, features);
      else if (file === NPC_TEMPLATE_FILE) next = convertNpcTemplate(item, target, tally, features);
      else if (file === NPC_FEATURE_FILE) next = convertNpcFeature(item, target, owners, tally);
      else next = convertGenericItem(item, file, target, tally, index);
      converted.push(next);
      if (JSON.stringify(next) !== mark) touched += 1;
    }
    data[file] = converted;
    tally.note('kept', `${file} unchanged`, converted.length - touched);
  }

  if (aggregateFiles.size > 0) foldAggregateNpcFiles(pack.data, aggregateFiles, data, target, tally, owners, features);

  return { source, target, rows: tally.rows(), data };
}

function convertedDraft(pack: PackDraft, target: PackFormat, plan: ConversionPlan): PackDraft {
  const id = `draft:convert:${target}:${pack.id}`;
  return { id, name: pack.name, version: pack.version, author: pack.author, format: target, data: plan.data };
}

export async function handleZipUpload(file: File) {
  const entries = new Map<string, Uint8Array>();
  try {
    const buffer = await file.arrayBuffer();
    collectArchiveJson(new Uint8Array(buffer), '', 0, entries);
  } catch (e: any) {
    showToast(`Not a readable .lcp/zip: ${e.message || e}`);
    return;
  }

  const packs = discoverPacks(entries);
  if (packs.length === 0) {
    showToast(`No pack data in ${file.name}`);
    return;
  }

  const stamp = Date.now();
  const archiveName = stripArchiveExt(file.name);
  const drafts: PackDraft[] = packs.map((pack, idx) => {
    const manifest = pack.data['lcp_manifest.json'] || {};
    const info = pack.data['info.json'] || {};
    const dirName = stripArchiveExt(pack.dir.split('/').filter(Boolean).pop() ?? '');
    const draft: PackDraft = {
      id: `draft:upload:${stamp}-${idx}`,
      name: String(manifest.name || info.name || dirName || archiveName || 'Imported Pack'),
      version: String(manifest.version || info.version || '1.0'),
      author: String(manifest.author || info.author || ''),
      data: pack.data,
    };
    const inferred = evidenceFormat(pack.data);
    if (inferred !== undefined) draft.format = inferred;
    return draft;
  });

  for (const draft of drafts) {
    if (draft.format === undefined && !manifestIsDecisive(draft.data['lcp_manifest.json'])) {
      const picked = await chooseFormat();
      if (picked === null) return;
      draft.format = picked;
    }
    if (!(await saveDraftOrToast(draft))) return;
  }
  openDraft(drafts[0]);
  renderLibrary();
  if (drafts.length > 1) showToast(`Imported ${drafts.length} packs`);
}

export function exportFileTexts(data: PackData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [filename, json] of Object.entries(data)) {
    out[filename] = JSON.stringify(json, null, 2);
  }
  return out;
}

function filenamePart(value: string, fallback: string): string {
  return (value || fallback).replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

export async function exportPack() {
  if (!currentPack) return;
  validateCurrentPack();
  if (itemValidationErrors.size > 0) {
    if (!(await customConfirm('Export with validation errors?'))) {
      return;
    }
  }
  if (!currentPack) return;
  const exportDraft: PackDraft = { ...currentPack, data: JSON.parse(JSON.stringify(currentPack.data)) };
  regenerateNpcFeatureArrays(exportDraft);

  const zipData: Record<string, Uint8Array> = {};
  for (const [filename, text] of Object.entries(exportFileTexts(exportDraft.data))) {
    zipData[filename] = fflate.strToU8(text);
  }

  const zipped = fflate.zipSync(zipData);
  const blob = new Blob([zipped], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  const safeName = filenamePart(exportDraft.name, 'unnamed_pack');
  const safeVersion = filenamePart(exportDraft.version, '1.0');
  a.download = `${safeName}_v${safeVersion}.lcp`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

let convertPlan: ConversionPlan | null = null;

export function setConvertPlan(value: ConversionPlan | null) {
  convertPlan = value;
}

function convertTarget(): PackFormat {
  return currentFormat() === 'v2' ? 'v3' : 'v2';
}

const CONVERT_SECTIONS: { kind: ConversionRow['kind']; title: string }[] = [
  { kind: 'dropped', title: 'Dropped' },
  { kind: 'transformed', title: 'Transformed' },
  { kind: 'kept', title: 'Kept' },
];

export function renderConvertReport() {
  if (!currentPack) return;
  const target = convertTarget();
  let plan: ConversionPlan;
  try {
    plan = planConversion(currentPack, target);
  } catch (e: any) {
    convertPlan = null;
    document.getElementById('convert-source')!.innerText = '';
    document.getElementById('convert-target')!.innerText = '';
    document.getElementById('convert-report')!.innerHTML = '';
    console.error(e);
    showToast('Conversion failed');
    return;
  }
  convertPlan = plan;
  document.getElementById('convert-source')!.innerText = `${currentPack.name} (${plan.source})`;
  document.getElementById('convert-target')!.innerText = target;

  const panel = document.getElementById('convert-report')!;
  panel.innerHTML = '';
  for (const section of CONVERT_SECTIONS) {
    const rows = plan.rows.filter((row) => row.kind === section.kind);
    const block = document.createElement('div');
    block.className = `convert-section convert-${section.kind}`;
    const head = document.createElement('p');
    head.className = 'hint';
    head.textContent = `${section.title} (${rows.length})`;
    block.appendChild(head);
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'convert-row';
      const shown = row.values ?? [];
      const extra =
        shown.length === 0
          ? ''
          : ` (${shown.slice(0, CONVERT_MAX_VALUES).join(', ')}${shown.length > CONVERT_MAX_VALUES ? ', ...' : ''})`;
      line.innerHTML = `<span class="convert-count">${row.count}</span><span class="convert-label">${esc(row.label + extra)}</span>`;
      block.appendChild(line);
    }
    panel.appendChild(block);
  }
}

export async function runConversion() {
  if (!currentPack || convertPlan === null) return;
  const target = convertPlan.target;
  const draft = convertedDraft(currentPack, target, convertPlan);
  const existing = await getDrafts();
  if (existing.some((entry) => entry.id === draft.id)) {
    const ok = await customConfirm(`Replace the existing ${target} draft?`);
    if (!ok) return;
  }
  if (!(await saveDraftOrToast(draft))) return;
  showToast(`Converted to ${target}`);
  renderLibrary();
}

export function renderExportPanels() {
  const refs = currentPack === null ? null : classifyPackRefs(currentPack, libraryDrafts);
  renderExportProblems(refs);
  renderExportNotices(refs);
}

function renderExportProblems(refs: RefClassification | null = null) {
  const panel = document.getElementById('export-problems')!;
  panel.innerHTML = '';
  if (!currentPack) return;

  const dangling = (refs ?? classifyPackRefs(currentPack, libraryDrafts)).dangling;
  if (itemValidationErrors.size === 0 && dangling.length === 0) return;

  const head = document.createElement('p');
  head.className = 'hint';
  head.textContent = `${itemValidationErrors.size + dangling.length} problem(s):`;
  panel.appendChild(head);
  for (const [key, err] of itemValidationErrors) {
    const sep = key.lastIndexOf(':');
    const cat = key.slice(0, sep);
    const idx = Number(key.slice(sep + 1));
    const item = itemAt(cat, idx);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'problem-row';
    row.innerHTML = `<span class="problem-loc">${esc(cat.replace('.json', ''))} - ${esc(item?.name || item?.id || `#${idx}`)}</span><span class="problem-msg">${esc(err)}</span>`;
    row.addEventListener('click', () => {
      switchTab('editor');
      selectCategory(cat);
      selectItem(idx);
    });
    panel.appendChild(row);
  }
  for (const ref of dangling) {
    const item = itemAt(ref.cat, ref.index);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'problem-row';
    row.innerHTML = `<span class="problem-loc">${esc(ref.cat.replace('.json', ''))} - ${esc(item?.name || item?.id || `#${ref.index}`)}</span><span class="problem-msg">${esc(ref.field)}: unresolved ${esc(ref.id)}</span>`;
    row.addEventListener('click', () => {
      switchTab('editor');
      selectCategory(ref.cat);
      selectItem(ref.index);
    });
    panel.appendChild(row);
  }
}

function renderExportNotices(refs: RefClassification | null = null) {
  const panel = document.getElementById('export-notices')!;
  panel.innerHTML = '';
  if (!currentPack) return;

  const crossPack = (refs ?? classifyPackRefs(currentPack, libraryDrafts)).crossPack;
  if (crossPack.length === 0) return;

  const head = document.createElement('p');
  head.className = 'hint';
  head.textContent = `${crossPack.length} linked to other packs:`;
  panel.appendChild(head);
  for (const ref of crossPack) {
    const item = itemAt(ref.cat, ref.index);
    const row = document.createElement('div');
    row.className = 'notice-row';
    row.innerHTML = `<span class="closure-cat">${esc(ref.cat.replace('.json', ''))}</span>${esc(item?.name || item?.id || `#${ref.index}`)} - ${esc(ref.field)}: ${esc(ref.id)} (${esc(ref.pack)})`;
    panel.appendChild(row);
  }
}
