import { currentPack, currentCategory, PACK_MANIFEST, PackDraft, EIDOLON_LAYERS, PackFormat, REFERENCE_DATALIST_IDS, confirmDiscardJsonEdits, currentFormat, currentItemIndex, customConfirm, formatOfManifest, packFormatOf, persistDraft, referenceIndex, validateItem, REF_WALK_DEPTH } from './state.js';
import { humanizeKey, FieldSpec, ACTIVE_EFFECT_COLUMNS, ADD_STATUS_COLUMNS, BOND_POWER_COLUMNS, ACTION_COLUMNS, COUNTER_COLUMNS, DEPLOYABLE_COLUMNS, DOWNTIME_RESULT_COLUMNS, FRAME_STAT_CELLS, V2_FRAME_STAT_CELLS, FieldKind, IDENTITY_FIELDS, LayoutSpec, NAME_DESC_COLUMNS, NAME_DESC_EXTRA_COLUMNS, NPC_STAT_CELLS, ReferenceBlock, SYNERGY_COLUMNS, SYSTEM_BONUS_COLUMNS, TABLE_RESULT_COLUMNS, VocabKey, WEAPON_PROFILE_COLUMNS } from './fields.js';
import { EIDOLON_FEATURE_COLUMNS, EIDOLON_REFERENCE, eidolonFeatureIdBase, eidolonFeatureSeed } from './eidolon.js';
import { selectItem, TagDef, ItemRef, catCount, catItems, clearDragOver, clip, containerFor, dragSourceIndex, dropTargetIndex, isListCategory, itemAt, itemRefs, moveArrayItem, paintDragOver, refreshPreview, renderDetailForm, renderMasterList, renderRecursiveForm, reorderCategoryItem, selectCategory, slotIndexOf, standardListFor, tagDefs, tagEntryFor, validateCurrentItemScoped, validateCurrentPack, wireDragReorder } from './ui.js';

const WIDE_KINDS: ReadonlySet<string> = new Set(['chips', 'damage', 'derived', 'group', 'origin', 'range', 'rows', 'stats', 'stringlist', 'tags', 'textarea', 'tiers']);
const ROW_KINDS: ReadonlySet<string> = new Set(['damage', 'range', 'rows', 'stringlist']);
const LABEL_OVERRIDES: Record<string, string> = {
  id: 'ID',
  license_id: 'License ID',
  sp: 'SP',
  default_value: 'Default',
  val: 'Value',
  image_url: 'Image URL',
  y_pos: 'Y Position',
  mechtype: 'Mech Type',
  terse: 'Summary',
  base: 'Base Feature',
  pilot: 'Pilot Action',
  filter_ignore: 'Ignore In Filters',
  __derived: 'Features',
  light: 'Light Color',
  dark: 'Dark Color',
  pcVictory: 'PC Victory',
  enemyVictory: 'Enemy Victory',
  noVictory: 'No Victory',
  controlZone: 'Control Zone',
  master: 'Master Power',
  veteran: 'Veteran Power',
  v3: 'Format',
};
const ROW_LABELS: Record<string, string> = {
  actions: 'Action',
  profiles: 'Profile',
  counters: 'Counter',
  active_effects: 'Active Effect',
  bonuses: 'Bonus',
  deployables: 'Deployable',
  traits: 'Trait',
  synergies: 'Synergy',
  ranks: 'Rank',
  features: 'Shard Feature',
  skills: 'Skill',
  major_ideals: 'Major Ideal',
  minor_ideals: 'Minor Ideal',
  questions: 'Question',
  powers: 'Power',
  results: 'Result',
};

function labelFor(kind: FieldKind, key: string): string {
  if (ROW_KINDS.has(kind) && ROW_LABELS[key] !== undefined) return ROW_LABELS[key];
  return LABEL_OVERRIDES[key] ?? humanizeKey(key);
}

function f(kind: FieldKind, key: string = kind, extra: Partial<FieldSpec> = {}): FieldSpec {
  const label = extra.label ?? labelFor(kind, key);
  const spec: FieldSpec = { key, label, kind };
  if (WIDE_KINDS.has(kind)) spec.wide = true;
  if (ROW_KINDS.has(kind)) spec.addLabel = `+ ${label}`;
  return Object.assign(spec, extra);
}

const txt = (key: string, extra?: Partial<FieldSpec>) => f('text', key, extra);
const area = (key: string, extra?: Partial<FieldSpec>) => f('textarea', key, extra);
const chk = (key: string, extra?: Partial<FieldSpec>) => f('checkbox', key, extra);
const ident = (key: string, extra?: Partial<FieldSpec>) => f('id', key, extra);
const sel = (key: string, vocab: VocabKey, extra?: Partial<FieldSpec>) => f('select', key, { vocab, ...extra });
const num = (key: string, min?: number, max?: number, extra?: Partial<FieldSpec>) =>
  f('number', key, { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), ...extra });
const rows = (key: string, columns: FieldSpec[], extra?: Partial<FieldSpec>) => f('rows', key, { columns, ...extra });
const chips = (key: string, vocab: VocabKey, extra?: Partial<FieldSpec>) => f('chips', key, { vocab, ...extra });

type LayoutExtra = Omit<LayoutSpec, 'prefix' | 'sections'>;

function lay(prefix: string, sections: [string, FieldSpec[]][], extra: LayoutExtra = {}): LayoutSpec {
  return { prefix, sections: sections.map(([title, fields]) => ({ title, fields })), ...extra };
}

const modsLayout = (sizesKey: string) => lay('wm', [
  ['Identity', IDENTITY_FIELDS],
  ['Fits', [num('sp', 0, 12), f('number', 'cost', { optional: true }), chips('allowed_types', 'weaponTypes'), chips(sizesKey, 'mounts')]],
  ['Adds', [f('damage', 'added_damage', { addLabel: '+ Damage' }), f('range', 'added_range', { addLabel: '+ Range' }), f('tags', 'added_tags')]],
  ['Tags', [f('tags')]],
  ['Effect', [area('effect'), area('description', { optional: true }), area('on_hit', { optional: true })]],
  ['Actions', [rows('actions', ACTION_COLUMNS, { optional: true })]],
]);

const framesLayout = (cells: { key: string; label: string }[]) => lay('mf', [
  ['Identity', [txt('name', { wide: true }), ident('id'), txt('source', { list: 'sources' }), txt('license_id', { optional: true }), num('license_level', 0, 3), txt('variant', { optional: true }), txt('image_url', { wide: true, optional: true }), f('number', 'y_pos', { optional: true }), chips('mechtype', 'mechTypes')]],
  ['Stats', [f('stats', 'stats', { cells })]],
  ['Mounts', [chips('mounts', 'mounts')]],
  ['Traits', [rows('traits', NAME_DESC_EXTRA_COLUMNS)]],
  ['Core System', [f('group', 'core_system', { fields: [
    txt('name', { wide: true }), area('description'), txt('activation'), txt('active_name'), area('active_effect'), txt('passive_name'), area('passive_effect'),
    txt('use', { optional: true }), txt('frequency', { optional: true }), txt('duration', { optional: true }), txt('deactivation', { optional: true }),
    rows('active_actions', ACTION_COLUMNS, { optional: true }),
    rows('active_effects', ACTIVE_EFFECT_COLUMNS, { optional: true }),
    rows('active_bonuses', SYSTEM_BONUS_COLUMNS, { optional: true }),
    rows('active_synergies', SYNERGY_COLUMNS, { optional: true }),
    rows('active_counters', COUNTER_COLUMNS, { optional: true }),
    rows('active_deployables', DEPLOYABLE_COLUMNS, { optional: true }),
    rows('passive_actions', ACTION_COLUMNS, { optional: true }),
    rows('passive_effects', ACTIVE_EFFECT_COLUMNS, { optional: true }),
    rows('passive_active_effects', ACTIVE_EFFECT_COLUMNS, { optional: true }),
    rows('passive_synergies', SYNERGY_COLUMNS, { optional: true }),
    rows('counters', COUNTER_COLUMNS, { optional: true }),
    rows('deployables', DEPLOYABLE_COLUMNS, { optional: true }),
    f('stringlist', 'integrated', { optional: true }),
  ] })]],
  ['Counters', [rows('counters', COUNTER_COLUMNS, { optional: true }), rows('active_counters', COUNTER_COLUMNS, { label: 'Active Counter', addLabel: '+ Active Counter', optional: true })]],
  ['Description', [area('description')]],
]);

let categoryLayoutsCache: Record<string, LayoutSpec> | undefined;

const CATEGORY_LAYOUTS = (): Record<string, LayoutSpec> => {
  categoryLayoutsCache ??= {
  'weapons.json': lay('mw', [
    ['Identity', IDENTITY_FIELDS],
    ['Mount & Type', [sel('mount', 'mounts'), sel('type', 'weaponTypes'), num('sp', 0, 12), f('number', 'cost', { optional: true })]],
    ['Damage & Range', [f('damage'), f('range')]],
    ['Tags', [f('tags')]],
    ['Effect', [area('effect'), area('description', { optional: true }), area('on_attack'), area('on_hit'), area('on_crit')]],
    ['Actions', [rows('actions', ACTION_COLUMNS, { optional: true })]],
    ['Profiles', [rows('profiles', WEAPON_PROFILE_COLUMNS, { optional: true })]],
    ['Counters', [rows('counters', COUNTER_COLUMNS, { optional: true })]],
    ['Active Effects', [rows('active_effects', ACTIVE_EFFECT_COLUMNS, { optional: true })]],
    ['Deployables', [rows('deployables', DEPLOYABLE_COLUMNS, { optional: true })]],
    ['Flags', [chk('no_attack'), chk('no_mods'), chk('no_core_bonus'), chk('no_synergies')]],
  ]),
  'systems.json': lay('ms', [
    ['Identity', IDENTITY_FIELDS],
    ['Profile', [sel('type', 'systemTypes'), num('sp', 0, 12)]],
    ['Tags', [f('tags')]],
    ['Effect', [area('effect'), area('description')]],
    ['Actions', [rows('actions', ACTION_COLUMNS, { optional: true })]],
    ['Bonuses', [rows('bonuses', SYSTEM_BONUS_COLUMNS, { optional: true })]],
    ['Counters', [rows('counters', COUNTER_COLUMNS, { optional: true })]],
    ['Active Effects', [rows('active_effects', ACTIVE_EFFECT_COLUMNS, { optional: true })]],
    ['Deployables', [rows('deployables', DEPLOYABLE_COLUMNS, { optional: true })]],
    ['Synergies', [rows('synergies', SYNERGY_COLUMNS, { optional: true })]],
  ]),
  'mods.json': modsLayout('restricted_sizes'),
  'frames.json': framesLayout(FRAME_STAT_CELLS),
  'talents.json': lay('t', [
    ['Identity', [txt('name', { wide: true }), ident('id'), txt('icon'), txt('icon_url', { wide: true, optional: true }), txt('terse', { wide: true })]],
    ['Description', [area('description')]],
    ['Ranks', [rows('ranks', NAME_DESC_EXTRA_COLUMNS)]],
  ]),
  'npc_features.json': lay('npcf', [
    ['Identity', [txt('name', { wide: true }), ident('id'), sel('type', 'featureTypes'), chk('base'), f('origin')]],
    ['Combat', [txt('weapon_type', { optional: true }), sel('activation', 'activations', { optional: true }), f('damage', 'damage', { optional: true, tiered: true }), f('range', 'range', { optional: true }), f('tierscalar', 'attack_bonus', { optional: true }), f('tierscalar', 'accuracy', { optional: true })]],
    ['Effect', [area('effect'), area('trigger'), area('on_hit', { optional: true })]],
    ['Tags', [f('tags')]],
    ['Counters', [rows('counters', COUNTER_COLUMNS, { optional: true })]],
  ]),
  'core_bonuses.json': lay('cb', [
    ['Identity', [txt('name', { wide: true }), ident('id'), txt('source', { list: 'sources' })]],
    ['Effect', [area('effect')]],
    ['Description', [area('description')]],
    ['Mounted Effect', [area('mounted_effect', { optional: true })]],
    ['Active Effects', [rows('active_effects', ACTIVE_EFFECT_COLUMNS, { optional: true })]],
    ['Bonuses', [rows('bonuses', SYSTEM_BONUS_COLUMNS, { optional: true })]],
    ['Actions', [rows('actions', ACTION_COLUMNS, { optional: true })]],
    ['Synergies', [rows('synergies', SYNERGY_COLUMNS, { optional: true })]],
  ]),
  'actions.json': lay('act', [
    ['Identity', [txt('name', { wide: true }), ident('id')]],
    ['Activation', [sel('activation', 'activations'), sel('action_type', 'activations', { optional: true }), area('trigger', { optional: true }), txt('frequency', { optional: true })]],
    ['Detail', [txt('terse', { wide: true }), area('detail')]],
    ['Add Status', [rows('add_status', ADD_STATUS_COLUMNS, { optional: true, addLabel: '+ Add Status' })]],
    ['Flags', [chk('pilot'), chk('hidden')]],
  ]),
  'pilot_gear.json': lay('pg', [
    ['Identity', [txt('name', { wide: true }), ident('id'), sel('type', 'gearTypes')]],
    ['Tags', [f('tags')]],
    ['Description', [area('description')]],
    ['Weapon', [f('damage', 'damage', { optional: true }), f('range', 'range', { optional: true }), area('effect', { optional: true }), area('on_hit', { optional: true })]],
    ['Active Effects', [rows('active_effects', ACTIVE_EFFECT_COLUMNS, { optional: true })]],
    ['Actions', [rows('actions', ACTION_COLUMNS, { optional: true })]],
    ['Bonuses', [rows('bonuses', SYSTEM_BONUS_COLUMNS, { optional: true })]],
    ['Deployables', [rows('deployables', DEPLOYABLE_COLUMNS, { optional: true })]],
  ]),
  'reserves.json': lay('reserve', [
    ['Identity', [txt('name', { wide: true }), ident('id'), sel('type', 'reserveTypes'), txt('label'), chk('deprecated')]],
    ['Description', [area('description')]],
    ['Resource', [txt('resource_name', { optional: true }), txt('resource_cost', { optional: true }), area('resource_note', { optional: true }), chk('consumable')]],
    ['Damage', [f('damage', 'damage', { optional: true, addLabel: '+ Damage' })]],
    ['Active Effects', [rows('active_effects', ACTIVE_EFFECT_COLUMNS, { optional: true })]],
    ['Actions', [rows('actions', ACTION_COLUMNS, { optional: true })]],
    ['Bonuses', [rows('bonuses', SYSTEM_BONUS_COLUMNS, { optional: true })]],
    ['Synergies', [rows('synergies', SYNERGY_COLUMNS, { optional: true })]],
    ['Deployables', [rows('deployables', DEPLOYABLE_COLUMNS, { optional: true })]],
  ]),
  'statuses.json': lay('', [
    ['Identity', [txt('name', { wide: true }), ident('id'), txt('icon', { optional: true })]],
    ['Profile', [sel('type', 'statusTypes'), txt('exclusive', { optional: true }), txt('terse', { wide: true })]],
    ['Effects', [area('effects')]],
  ]),
  'tags.json': lay('tg', [
    ['Identity', [txt('name', { wide: true }), ident('id')]],
    ['Description', [area('description')]],
    ['Flags', [chk('filter_ignore'), chk('hidden')]],
  ]),
  'npc_classes.json': lay('npcc', [
    ['Identity', [txt('name', { wide: true }), ident('id'), sel('role', 'npcRoles')]],
    ['Stats', [f('tiers', 'stats', { cells: NPC_STAT_CELLS })]],
    ['Features', [f('derived', '__derived')]],
    ['Info', [f('group', 'info', { fields: [area('flavor'), area('tactics')] })]],
  ], { derivedKeys: ['base_features', 'optional_features'] }),
  'npc_templates.json': lay('npct', [
    ['Identity', [txt('name', { wide: true }), ident('id'), f('number', 'power', { optional: true })]],
    ['Description', [area('description')]],
    ['Features', [f('derived', '__derived')]],
  ], { derivedKeys: ['base_features', 'optional_features'] }),
  'eidolon_layers.json': lay('elayer', [
    ['Identity', [txt('name', { wide: true }), ident('id')]],
    ['Flavour', [area('appearance'), area('hints')]],
    ['Rules', [area('rules')]],
    ['Shards', [f('group', 'shards', { fields: [f('count'), area('detail'), f('damage', 'damage', { optional: true }), rows('features', EIDOLON_FEATURE_COLUMNS, { optional: true, rowSeed: eidolonFeatureSeed, rowIdBase: eidolonFeatureIdBase })] })]],
    ['Features', [rows('features', EIDOLON_FEATURE_COLUMNS, { label: 'Feature', addLabel: '+ Feature', rowSeed: eidolonFeatureSeed, rowIdBase: eidolonFeatureIdBase })]],
  ], { reference: EIDOLON_REFERENCE }),
  'environments.json': lay('env', [
    ['Identity', [txt('name', { wide: true }), ident('id')]],
    ['Description', [area('description')]],
  ]),
  'glossary.json': lay('', [
    ['Identity', [txt('name', { wide: true })]],
    ['Description', [area('description')]],
  ]),
  'manufacturers.json': lay('', [
    ['Identity', [txt('name', { wide: true }), ident('id')]],
    ['Branding', [txt('logo'), txt('light'), txt('dark')]],
    ['Description', [area('quote'), area('description')]],
  ]),
  'sitreps.json': lay('sitrep', [
    ['Identity', [txt('name', { wide: true }), ident('id')]],
    ['Description', [area('description')]],
    ['Victory', [area('pcVictory'), area('enemyVictory'), area('noVictory', { optional: true })]],
    ['Rules', [area('controlZone', { optional: true }), area('deployment', { optional: true }), area('extraction', { optional: true }), area('objective', { optional: true })]],
  ]),
  'skills.json': lay('sk', [
    ['Identity', [txt('name', { wide: true }), ident('id'), txt('family')]],
    ['Description', [area('description'), area('detail')]],
  ]),
  'backgrounds.json': lay('pbg', [
    ['Identity', [txt('name', { wide: true }), ident('id')]],
    ['Description', [area('description')]],
    ['Skills', [f('stringlist', 'skills', { optional: true })]],
    ['Triggers', [area('triggers', { optional: true })]],
  ]),
  'bonds.json': lay('bond', [
    ['Identity', [txt('name', { wide: true }), ident('id')]],
    ['Ideals', [f('stringlist', 'major_ideals'), f('stringlist', 'minor_ideals')]],
    ['Questions', [f('stringlist', 'questions')]],
    ['Powers', [rows('powers', BOND_POWER_COLUMNS)]],
  ]),
  'tables.json': lay('table', [
    ['Identity', [txt('title', { wide: true }), ident('id'), num('die')]],
    ['Description', [area('description')]],
    ['Results', [rows('results', TABLE_RESULT_COLUMNS)]],
  ]),
  'downtime_actions.json': lay('dt', [
    ['Identity', [txt('name', { wide: true }), ident('id'), txt('activation', { optional: true })]],
    ['Detail', [txt('terse', { wide: true }), area('detail')]],
    ['Table', [f('group', 'table', { optional: true, fields: [txt('detail', { wide: true }), txt('die'), rows('results', DOWNTIME_RESULT_COLUMNS)] })]],
  ]),
  'lcp_manifest.json': lay('', [
    ['Pack Info', [txt('name', { wide: true }), txt('author'), txt('version'), txt('item_prefix'), f('format', 'v3'), txt('website', { wide: true }), area('description')]],
  ], { singleton: true }),
  };
  return categoryLayoutsCache;
};

const COMBO_MENU_CAP = 24; // scrolling a combo past this is worse than typing
let openComboPaint: (() => void) | null = null;
export const autoIdItems = new WeakSet<object>();
export let packSaveTimer: number | undefined;

interface PendingSlot {
  owner: any;
  key: string | number;
  value: any;
  seed: string;
}

let pendingSlots: PendingSlot[] = [];

export function resetPendingSlots() {
  pendingSlots = [];
}

function detachedSlot(owner: any, key: string | number, value: any): any {
  pendingSlots.push({ owner, key, value, seed: JSON.stringify(value) });
  return value;
}

function attachTouchedSlots() {
  if (pendingSlots.length === 0) return;
  const waiting: PendingSlot[] = [];
  for (let i = pendingSlots.length - 1; i >= 0; i -= 1) {
    const slot = pendingSlots[i];
    if (JSON.stringify(slot.value) === slot.seed) {
      waiting.push(slot);
      continue;
    }
    slot.owner[slot.key] = slot.value;
  }
  waiting.reverse();
  pendingSlots = waiting;
}

const V2_FEATURE_LINK_FIELDS: FieldSpec[] = [
  { key: '__derived', label: 'Features', kind: 'derived', wide: true },
];

let v2CategoryLayoutsCache: Record<string, LayoutSpec> | undefined;

const V2_CATEGORY_LAYOUTS = (): Record<string, LayoutSpec> => {
  v2CategoryLayoutsCache ??= {
  'frames.json': framesLayout(V2_FRAME_STAT_CELLS),
  'mods.json': modsLayout('restricted_mounts'),
  'npc_classes.json': lay('npcc', [
    ['Identity', [txt('name', { wide: true }), ident('id'), sel('role', 'npcRoles'), num('power')]],
    ['Stats', [f('tiers', 'stats', { cells: NPC_STAT_CELLS })]],
    ['Features', V2_FEATURE_LINK_FIELDS],
    ['Info', [f('group', 'info', { fields: [area('flavor'), area('tactics')] })]],
  ], { derivedKeys: ['base_features', 'optional_features'] }),
  'npc_templates.json': lay('npct', [
    ['Identity', [txt('name', { wide: true }), ident('id'), num('power')]],
    ['Description', [area('description')]],
    ['Features', V2_FEATURE_LINK_FIELDS],
  ], { derivedKeys: ['base_features', 'optional_features'] }),
  'npc_features.json': lay('npcf', [
    ['Identity', [txt('name', { wide: true }), ident('id'), sel('type', 'featureTypes'), f('origin'), chk('locked')]],
    ['Combat', [txt('weapon_type', { optional: true }), txt('tech_type', { optional: true }), f('damage', 'damage', { optional: true, tiered: true, rowKey: 'damage' }), f('range', 'range', { optional: true }), f('tierscalar', 'attack_bonus', { optional: true }), f('tierscalar', 'accuracy', { optional: true })]],
    ['Effect', [area('effect'), area('trigger'), area('on_hit', { optional: true })]],
    ['Tags', [f('tags')]],
    ['Counters', [rows('counters', COUNTER_COLUMNS, { optional: true })]],
  ]),
  'manufacturers.json': lay('', [
    ['Identity', [txt('name', { wide: true }), ident('id')]],
    ['Branding', [txt('logo'), txt('color')]],
    ['Description', [area('quote'), area('description')]],
  ]),
  };
  return v2CategoryLayoutsCache;
};

export function layoutFor(cat: string | null, format: PackFormat = currentFormat()): LayoutSpec | null {
  if (cat === null) return null;
  if (format === 'v2') return V2_CATEGORY_LAYOUTS()[cat] ?? CATEGORY_LAYOUTS()[cat] ?? null;
  return CATEGORY_LAYOUTS()[cat] ?? null;
}

export function layoutDeclaresId(cat: string | null, format: PackFormat = currentFormat()): boolean {
  const layout = layoutFor(cat, format);
  if (layout === null) return false;
  return layout.sections.some((section) => section.fields.some((field) => field.kind === 'id'));
}

export function identityFieldFor(cat: string | null, format: PackFormat = currentFormat()): string {
  const layout = layoutFor(cat, format);
  const first = layout?.sections[0]?.fields[0];
  return first !== undefined && first.kind === 'text' ? first.key : 'name';
}

export function currentTarget(): any {
  if (!currentPack || !currentCategory) return undefined;
  if (isListCategory(currentCategory)) {
    return currentItemIndex === null ? undefined : itemAt(currentCategory, currentItemIndex);
  }
  const dt = currentPack.data[currentCategory];
  if (!isPlainObject(dt)) return undefined;
  return layoutFor(currentCategory)?.singleton === true ? dt : undefined;
}

function designedRootPath(): (string | number)[] {
  return currentItemIndex === null ? [] : [currentItemIndex];
}

export function isPlainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function slugifyName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function packItemPrefixRaw(): string {
  const manifest = currentPack?.data[PACK_MANIFEST];
  if (!manifest || typeof manifest !== 'object') return '';
  return asText((manifest as any).item_prefix).trim();
}

function packItemPrefix(): string {
  return slugifyName(packItemPrefixRaw());
}

// these two don't derive from their name
const STATUS_ID_OVERRIDES: Record<string, string> = {
  shut_down: 'shut-down',
  slowed: 'slow',
};

export function statusIdFor(name: string): string {
  const slug = slugifyName(name.replace(/\([^)]*\)/g, ' '));
  return STATUS_ID_OVERRIDES[slug] ?? slug.replace(/_/g, '');
}

export function autoIdFor(cat: string, name: string): string {
  const slug = cat === 'statuses.json' ? statusIdFor(name) : slugifyName(name);
  if (slug === '') return '';
  return [packItemPrefix(), layoutFor(cat)?.prefix ?? '', slug].filter((part) => part !== '').join('_');
}

export function firstFreeId(taken: Set<string>, base: string, joiner = '_'): string {
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}${joiner}${suffix}`)) suffix += 1;
  return `${base}${joiner}${suffix}`;
}

export function uniqueSiblingId(list: any[], base: string, self: any): string {
  if (base === '') return base;
  const taken = new Set<string>();
  for (const entry of list) {
    if (entry === self || !entry || typeof entry !== 'object') continue;
    const id = asText((entry as any).id);
    if (id !== '') taken.add(id);
  }
  return firstFreeId(taken, base);
}

export function uniqueAutoId(cat: string, base: string, self: any, pack: PackDraft | null = currentPack): string {
  return uniqueSiblingId(catItems(cat, pack), base, self);
}

interface ValidationPass {
  items: Map<string, any[]>;
  refs: Map<string, (id: string) => ItemRef | undefined>;
}

let validationPass: ValidationPass | null = null;

// one sweep only. anything longer-lived goes stale the moment an id changes
export function withValidationPass<T>(run: () => T): T {
  const outer = validationPass;
  validationPass = { items: new Map(), refs: new Map() };
  try {
    return run();
  } finally {
    validationPass = outer;
  }
}

function passItems(cat: string): any[] {
  if (validationPass === null) return catItems(cat);
  let list = validationPass.items.get(cat);
  if (list === undefined) {
    list = catItems(cat);
    validationPass.items.set(cat, list);
  }
  return list;
}

function idIsTaken(cat: string, id: string, self: any): boolean {
  if (id === '') return false;
  return passItems(cat).some(
    (entry: any) => entry !== self && entry && typeof entry === 'object' && asText(entry.id) === id,
  );
}

export function flushPackSave() {
  if (packSaveTimer !== undefined) {
    clearTimeout(packSaveTimer);
    packSaveTimer = undefined;
  }
  if (currentPack) {
    regenerateNpcFeatureArrays(currentPack);
    persistDraft(currentPack);
  }
}

export const PACK_SAVE_DEBOUNCE_MS = 150; // feels ok while typing, bump if it fights the form

export function queuePackSave() {
  if (packSaveTimer !== undefined) clearTimeout(packSaveTimer);
  packSaveTimer = setTimeout(() => {
    packSaveTimer = undefined;
    if (currentPack) {
      regenerateNpcFeatureArrays(currentPack);
      persistDraft(currentPack);
    }
  }, PACK_SAVE_DEBOUNCE_MS) as unknown as number;
}

function syncMasterRowLabel() {
  if (currentItemIndex === null) return;
  const item = currentTarget();
  if (item === undefined) return;
  const cell = document.querySelector(`.master-list-item[data-idx="${currentItemIndex}"] .item-name`);
  if (!(cell instanceof HTMLElement)) return;
  const label = asText(item.name) || asText(item.id) || `Item ${currentItemIndex}`;
  cell.textContent = label;
}

interface CommitOptions {
  immediate?: boolean;
  rerender?: boolean;
}

function commitDesigned(options: CommitOptions = {}) {
  if (!currentPack || !currentCategory) return;
  attachTouchedSlots();
  regenerateNpcFeatureArrays(currentPack);
  if (currentCategory === 'lcp_manifest.json') {
    const manifest = currentPack.data[currentCategory];
    if (manifest !== null && typeof manifest === 'object') {
      currentPack.name = asText(manifest.name) || 'Unnamed';
      currentPack.version = asText(manifest.version) || '1.0';
      currentPack.author = asText(manifest.author);
    }
  }
  if (options.immediate === true) flushPackSave();
  else queuePackSave();
  validateCurrentItemScoped();
  syncMasterRowLabel();
  if (options.rerender === true) {
    const item = currentTarget();
    if (item !== undefined) renderDetailForm(item, designedRootPath());
    return;
  }
  refreshPreview();
  refreshFieldProblems();
}

function vocabFor(vocab: VocabKey, current: unknown): string[] {
  const values = referenceIndex[vocab] ?? [];
  const now = asText(current);
  if (now !== '' && !values.includes(now)) return [...values, now];
  return values;
}

function localTagDefs(): Map<string, TagDef> {
  const out = new Map<string, TagDef>();
  const list = currentPack?.data['tags.json'];
  if (!Array.isArray(list)) return out;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const id = asText((entry as any).id);
    if (id === '') continue;
    const name = asText((entry as any).name);
    const description = asText((entry as any).description);
    out.set(id, {
      id,
      name,
      description,
      hasVal: `${name}${description}`.includes('{VAL}'),
    });
  }
  return out;
}

export function tagDefFor(id: string): TagDef | undefined {
  const indexed = tagDefs.get(id);
  if (indexed !== undefined && indexed.name !== '') return indexed;
  const local = localTagDefs().get(id);
  const hasVal = local?.hasVal === true || indexed?.hasVal === true;
  if (local !== undefined && local.name !== '') return { ...local, hasVal };
  if (local === undefined) return indexed;
  return { ...local, hasVal };
}

function knownTags(): TagDef[] {
  const out = new Map<string, TagDef>();
  for (const [id, def] of tagDefs) out.set(id, def);
  for (const [id, def] of localTagDefs()) {
    const prev = out.get(id);
    out.set(id, { ...def, hasVal: def.hasVal || prev?.hasVal === true });
  }
  for (const id of referenceIndex.tagIds ?? []) {
    if (!out.has(id)) out.set(id, { id, name: '', description: '', hasVal: false });
  }
  return Array.from(out.values()).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

export function refreshTagLabels() {
  for (const chip of Array.from(document.querySelectorAll('.chip[data-tag]'))) {
    if (!(chip instanceof HTMLElement)) continue;
    const id = chip.dataset.tag ?? '';
    const def = tagDefFor(id);
    const cell = chip.querySelector('.chip-name');
    if (cell instanceof HTMLElement && def !== undefined) cell.textContent = chipTagName(def, id);
  }
  for (const chip of Array.from(document.querySelectorAll('.chip[data-ref]'))) {
    if (!(chip instanceof HTMLElement)) continue;
    const id = chip.dataset.ref ?? '';
    const ref = refFor('npc_features.json', id);
    const cell = chip.querySelector('.chip-name');
    if (cell instanceof HTMLElement && ref !== undefined && ref.name !== '') {
      cell.textContent = ref.name;
      chip.classList.remove('chip-unknown');
    }
  }
  openComboPaint?.();
  refreshPreview();
}

export function button(
  className: string,
  label: string,
  onClick: () => void,
  extras: { aria?: string; dataset?: Record<string, string> } = {},
): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.innerText = label;
  if (extras.aria !== undefined) el.setAttribute('aria-label', extras.aria);
  for (const [key, value] of Object.entries(extras.dataset ?? {})) el.dataset[key] = value;
  el.addEventListener('click', onClick);
  return el;
}

interface ChipSpec {
  label: string;
  dataset: Record<string, string>;
  onOpen?: () => void;
  onRemove?: () => void;
  value?: HTMLElement;
}

function chip(spec: ChipSpec): HTMLElement {
  const el = document.createElement('span');
  el.className = 'chip';
  for (const [key, value] of Object.entries(spec.dataset)) el.dataset[key] = value;
  if (spec.onOpen === undefined) {
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.innerText = spec.label;
    el.appendChild(name);
  } else {
    el.appendChild(button('chip-name chip-link', spec.label, spec.onOpen));
  }
  if (spec.value !== undefined) el.appendChild(spec.value);
  if (spec.onRemove !== undefined) el.appendChild(button('chip-remove', '×', spec.onRemove, { aria: 'Remove' }));
  return el;
}

export function controlId(fieldId: string): string {
  return `fld-${fieldId.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

function comboOptionsFor(vocab: VocabKey, current: unknown, needle: string): string[] {
  const values = vocabFor(vocab, current);
  if (needle === '') return values;
  return values.filter((value) => value.toLowerCase().includes(needle));
}

function buildVocabCombo(
  vocab: VocabKey,
  current: unknown,
  onPick: (value: string) => void,
  fieldId?: string,
  ariaLabel?: string,
): HTMLElement {
  return buildCombo(
    '',
    (needle) => comboOptionsFor(vocab, current, needle).map((value) => ({ id: value, name: value, note: '' })),
    onPick,
    fieldId,
    { ariaLabel, value: asText(current), onChange: onPick, blurOnEmptyEnter: true, hideOnPick: true, setInputOnPick: true },
  );
}

function fieldBindsPlainText(spec: FieldSpec): boolean {
  return spec.kind === 'textarea';
}

function structuredValuePresent(owner: any, key: string): boolean {
  if (owner === null || typeof owner !== 'object') return false;
  const value = owner[key];
  return value !== null && typeof value === 'object';
}

function designedFieldSpecs(specs: FieldSpec[], owner: any): FieldSpec[] {
  return specs.filter((spec) => !(fieldBindsPlainText(spec) && structuredValuePresent(owner, spec.key)));
}

export function renderDesignedForm(layout: LayoutSpec, item: any, rootPath: (string | number)[], container: HTMLElement) {
  const wrap = document.createElement('div');
  wrap.className = 'designed-layout';

  const form = document.createElement('div');
  form.className = 'designed-form';
  form.id = 'designed-form';

  const banner = document.createElement('p');
  banner.className = 'form-error hidden';
  banner.id = 'form-error';
  form.appendChild(banner);

  const covered = new Set<string>(layout.derivedKeys ?? []);
  for (const section of layout.sections) {
    const sectionFields = designedFieldSpecs(section.fields, item);
    if (sectionFields.length === 0) continue;
    const block = document.createElement('section');
    block.className = 'form-section';
    const title = document.createElement('h4');
    title.className = 'section-title';
    title.innerText = section.title;
    block.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'field-grid';
    for (const spec of sectionFields) covered.add(spec.key);
    for (const spec of sectionFields) {
      const echoesTitle =
        sectionFields.length === 1 && (spec.label === section.title || `${spec.label}s` === section.title);
      grid.appendChild(renderField(spec, item, [...rootPath, spec.key], spec.key, echoesTitle));
    }
    block.appendChild(grid);
    form.appendChild(block);
  }

  const advanced = advancedBlock(item, rootPath, covered, 'Advanced');
  if (advanced !== null) form.appendChild(advanced);

  const aside = document.createElement('aside');
  aside.className = 'preview-pane';
  const label = document.createElement('div');
  label.className = 'preview-label';
  label.innerText = 'Preview';
  const card = document.createElement('div');
  card.className = 'card-preview';
  card.id = 'preview-card';
  aside.appendChild(label);
  aside.appendChild(card);
  for (const block of layout.reference ?? []) aside.appendChild(referenceBlock(block));

  wrap.appendChild(form);
  wrap.appendChild(aside);
  container.appendChild(wrap);

  refreshPreview();
  refreshFieldProblems();
}

function referenceBlock(block: ReferenceBlock): HTMLElement {
  const details = document.createElement('details');
  details.className = 'ref-block';
  details.dataset.ref = block.title;
  const summary = document.createElement('summary');
  summary.innerText = block.title;
  details.appendChild(summary);
  const body = document.createElement('div');
  body.className = 'ref-body';
  for (const row of block.rows) {
    const line = document.createElement('p');
    line.className = 'ref-row';
    line.innerText = row;
    body.appendChild(line);
  }
  details.appendChild(body);
  return details;
}

function advancedBlock(
  owner: any,
  path: (string | number)[],
  covered: Set<string>,
  title: string,
  onlyIfExtra = false,
): HTMLElement | null {
  const extra = owner && typeof owner === 'object' ? Object.keys(owner).filter((key) => !covered.has(key)) : [];
  if (onlyIfExtra && extra.length === 0) return null;
  const details = document.createElement('details');
  details.className = 'form-fieldset advanced-block';
  const summary = document.createElement('summary');
  summary.className = 'form-legend';
  summary.innerText = extra.length > 0 ? `${title} | ${extra.length}` : title;
  details.appendChild(summary);
  const body = document.createElement('div');
  body.className = 'advanced-body';
  renderRecursiveForm(owner, path, body, { bare: true, hideKeys: covered });
  details.appendChild(body);
  return details;
}

function blankForKind(kind: FieldKind): any {
  switch (kind) {
    case 'number':
      return 0;
    case 'checkbox':
      return false;
    case 'damage':
    case 'range':
    case 'tags':
    case 'chips':
    case 'rows':
    case 'stringlist':
      return [];
    case 'group':
    case 'stats':
    case 'tiers':
      return {};
    case 'tierscalar':
      return [0, 0, 0];
    default:
      return '';
  }
}

function blankObjectRow(spec: FieldSpec, owner: any): any {
  if (spec.rowSeed !== undefined) return spec.rowSeed(owner);
  const columns = spec.columns ?? NAME_DESC_COLUMNS;
  const blank: Record<string, unknown> = {};
  for (const column of columns) {
    if (column.optional === true) continue;
    blank[column.key] = blankForKind(column.kind);
  }
  return blank;
}

function blankValueRow(spec: FieldSpec, vocab: VocabKey, numeric: boolean): any {
  const key = spec.rowKey ?? 'val';
  const seedType = referenceIndex[vocab]?.[0] ?? '';
  if (spec.tiered === true) return { type: seedType, [key]: [0, 0, 0] };
  return numeric ? { type: seedType, [key]: 5 } : { type: seedType, [key]: '' };
}

function objectSlotFor(owner: any, key: string): any | null {
  const value = owner[key];
  if (value === undefined || value === null || value === '') {
    return detachedSlot(owner, key, {} as Record<string, unknown>);
  }
  if (isPlainObject(value)) return value;
  return null;
}

function buildSlotFallback(spec: FieldSpec, owner: any, path: (string | number)[], fieldId: string): HTMLElement {
  const value = owner[spec.key];
  if (value !== null && typeof value === 'object') {
    const host = document.createElement('div');
    host.className = 'fallback-block';
    renderRecursiveForm(value, path, host, { bare: true });
    return host;
  }
  return buildTextInput({ ...spec, kind: 'text' }, owner, fieldId);
}

interface RowIdFollow {
  siblings: any[];
  idBase: (name: string) => string;
  idFieldId: string;
}

function renderField(
  spec: FieldSpec,
  owner: any,
  path: (string | number)[],
  fieldId: string,
  hideLabel = false,
  rowFollow?: RowIdFollow,
): HTMLElement {
  const field = document.createElement('div');
  field.className = spec.wide === true ? 'field wide' : 'field';
  field.dataset.field = fieldId;

  if (spec.optional === true && (owner === null || typeof owner !== 'object' || !(spec.key in owner))) {
    const add = button('btn-add-field btn-add-optional', `+ ${spec.label}`, () => {
      const blank = blankForKind(spec.kind);
      if (spec.kind === 'rows' && Array.isArray(blank)) {
        const created = blankObjectRow(spec, owner);
        if (spec.rowIdBase !== undefined) autoIdItems.add(created);
        blank.push(created);
      } else if (spec.kind === 'damage' && Array.isArray(blank)) {
        blank.push(blankValueRow(spec, 'damageTypes', false));
      } else if (spec.kind === 'range' && Array.isArray(blank)) {
        blank.push(blankValueRow(spec, 'rangeTypes', true));
      }
      owner[spec.key] = blank;
      commitDesigned({ immediate: true, rerender: true });
        }, { dataset: { add: spec.key } });
    field.appendChild(add);
    return field;
  }

  if (spec.kind === 'checkbox') {
    const line = document.createElement('label');
    line.className = 'field-check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = controlId(fieldId);
    box.checked = owner[spec.key] === true;
    box.addEventListener('change', () => {
      owner[spec.key] = box.checked;
      commitDesigned({ immediate: true });
    });
    const text = document.createElement('span');
    text.innerText = spec.label;
    line.appendChild(box);
    line.appendChild(text);
    field.appendChild(line);
  } else {
    if (!hideLabel) {
      const label = document.createElement('label');
      label.className = 'field-label';
      label.innerText = spec.label;
      label.htmlFor = controlId(fieldId);
      field.appendChild(label);
    }
    field.appendChild(buildControl(spec, owner, path, fieldId, rowFollow));
  }

  const error = document.createElement('p');
  error.className = 'field-error hidden';
  field.appendChild(error);
  return field;
}

function buildControl(
  spec: FieldSpec,
  owner: any,
  path: (string | number)[],
  fieldId: string,
  rowFollow?: RowIdFollow,
): HTMLElement {
  switch (spec.kind) {
    case 'textarea':
      return buildTextArea(spec, owner, fieldId);
    case 'number':
      return buildNumberInput(spec, owner, fieldId);
    case 'select':
      return buildSelectInput(spec, owner, fieldId);
    case 'damage':
      return buildValueRows(spec, owner, path, 'damageTypes', false, fieldId);
    case 'range':
      return buildValueRows(spec, owner, path, 'rangeTypes', true, fieldId);
    case 'tags':
      return buildTagsControl(owner, spec.key, fieldId);
    case 'chips':
      return buildChipsControl(spec, owner, fieldId);
    case 'rows':
      return buildObjectRows(spec, owner, path, fieldId);
    case 'stringlist':
      return buildStringListControl(spec, owner, fieldId);
    case 'stats':
      return buildStatsGrid(spec, owner, path, fieldId);
    case 'tiers':
      return buildTierGrid(spec, owner, path, fieldId);
    case 'tierscalar':
      return buildTierScalar(spec, owner, fieldId);
    case 'count':
      return buildCountInput(spec, owner, fieldId);
    case 'derived':
      return buildDerivedFeatures(owner);
    case 'origin':
      return buildOriginControl(spec, owner, path, fieldId);
    case 'group':
      return buildGroupControl(spec, owner, path, fieldId);
    case 'format':
      return buildFormatDisplay(owner, fieldId);
    default:
      return buildTextInput(spec, owner, fieldId, rowFollow);
  }
}

function buildTextInput(
  spec: FieldSpec,
  owner: any,
  fieldId: string,
  rowFollow?: RowIdFollow,
): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input';
  input.id = controlId(fieldId);
  input.autocomplete = 'off';
  input.value = asText(owner[spec.key]);
  if (spec.list !== undefined) {
    const listId = REFERENCE_DATALIST_IDS[spec.list];
    if (listId !== undefined) input.setAttribute('list', listId);
  }
  const ownsFeatures = spec.kind === 'id' || spec.key === 'name';
  let linked = ownsFeatures && rowFollow === undefined ? ownerKeySnapshot(owner) : null;
  let previousItemPrefix = spec.key === 'item_prefix' ? asText(owner[spec.key]) : null;
  let previousName = spec.key === 'name' ? asText(owner[spec.key]) : '';
  const write = (immediate: boolean) => {
    owner[spec.key] = input.value;
    if (spec.kind === 'id') {
      autoIdItems.delete(owner);
    } else if (spec.key === 'name') {
      if (rowFollow !== undefined) followRowNameWithId(owner, input.value, rowFollow, previousName);
      else followNameWithId(owner, input.value, previousName);
      if (currentCategory === 'frames.json' && currentPack) rehomeLicenseNames(currentPack.data, owner, previousName, input.value);
      previousName = input.value;
    } else if (previousItemPrefix !== null && immediate && input.value !== previousItemPrefix) {
      const pack = currentPack;
      const oldPrefix = previousItemPrefix;
      const newPrefix = input.value;
      previousItemPrefix = input.value;
      if (pack) void promptReprefixPack(pack, oldPrefix, newPrefix);
    }
    if (linked !== null) {
      if (linked.kind !== null) {
        rehomeDependentFeatures(owner, linked);
      } else if (isEidolonLayerOwner(owner)) {
        rehomeEidolonLayerFeatures(owner, linked);
      } else {
        const nextId = asText(owner.id);
        if (currentPack && nextId !== '' && !sameKey(nextId, linked.id)) {
          rewriteIdReferences(currentPack.data, new Map([[linked.id, nextId]]));
        }
      }
      linked = advanceOwnerKey(linked, owner);
    }
    commitDesigned({ immediate });
  };
  input.addEventListener('input', () => {
    write(false);
  });
  input.addEventListener('change', () => {
    write(true);
  });
  return input;
}

// follow the id only while it still looks name-derived. hand-edited, leave alone
function idMatchesDerivedBase(id: string, base: string): boolean {
  if (id === '' || base === '') return false;
  if (id === base) return true;
  if (!id.startsWith(`${base}_`)) return false;
  return /^[1-9][0-9]*$/.test(id.slice(base.length + 1));
}

function swapTrailingSlug(id: string, previousSlug: string, nextSlug: string): string | null {
  if (previousSlug === '') return null;
  let prefix: string | null = null;
  if (id === previousSlug) prefix = '';
  else if (id.endsWith(`_${previousSlug}`)) prefix = id.slice(0, id.length - previousSlug.length - 1);
  if (prefix === null) return null;
  if (nextSlug === '') return prefix;
  return prefix === '' ? nextSlug : `${prefix}_${nextSlug}`;
}

function followNameWithId(owner: any, name: string, previousName = '') {
  if (!currentCategory) return;
  const currentId = asText(owner.id);
  const swapped = swapTrailingSlug(currentId, slugifyName(previousName), slugifyName(name));
  const autoFollows =
    autoIdItems.has(owner) || idMatchesDerivedBase(currentId, autoIdFor(currentCategory, previousName)) || swapped !== null;
  if (!autoFollows) return;
  const base = swapped ?? autoIdFor(currentCategory, name);
  const next = uniqueAutoId(currentCategory, base, owner);
  owner.id = next;
  const idInput = document.getElementById(controlId('id'));
  if (idInput instanceof HTMLInputElement) idInput.value = next;
}

function followRowNameWithId(owner: any, name: string, follow: RowIdFollow, previousName = '') {
  const currentId = asText(owner.id);
  const swapped = swapTrailingSlug(currentId, slugifyName(previousName), slugifyName(name));
  const autoFollows = autoIdItems.has(owner) || idMatchesDerivedBase(currentId, follow.idBase(previousName)) || swapped !== null;
  if (!autoFollows) return;
  const base = swapped ?? follow.idBase(name);
  const next = uniqueSiblingId(follow.siblings, base, owner);
  owner.id = next;
  const idInput = document.getElementById(controlId(follow.idFieldId));
  if (idInput instanceof HTMLInputElement) idInput.value = next;
}

function buildTextArea(spec: FieldSpec, owner: any, fieldId: string): HTMLElement {
  const area = document.createElement('textarea');
  area.className = 'form-textarea';
  area.id = controlId(fieldId);
  area.value = asText(owner[spec.key]);
  area.addEventListener('input', () => {
    owner[spec.key] = area.value;
    commitDesigned();
  });
  area.addEventListener('change', () => {
    owner[spec.key] = area.value;
    commitDesigned({ immediate: true });
  });
  return area;
}

function buildNumberInput(spec: FieldSpec, owner: any, fieldId: string): HTMLElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'form-input';
  input.id = controlId(fieldId);
  if (spec.min !== undefined) input.min = String(spec.min);
  if (spec.max !== undefined) input.max = String(spec.max);
  const raw = owner[spec.key];
  input.value = typeof raw === 'number' || typeof raw === 'string' ? String(raw) : '';
  const write = (immediate: boolean) => {
    if (input.value.trim() === '') delete owner[spec.key];
    else owner[spec.key] = Number(input.value);
    commitDesigned({ immediate });
  };
  input.addEventListener('input', () => {
    write(false);
  });
  input.addEventListener('change', () => {
    write(true);
  });
  return input;
}

function buildSelectInput(spec: FieldSpec, owner: any, fieldId: string): HTMLElement {
  return buildVocabCombo(
    spec.vocab ?? 'sources',
    owner[spec.key],
    (value) => {
      if (value === '') delete owner[spec.key];
      else owner[spec.key] = value;
      commitDesigned({ immediate: true });
    },
    fieldId,
  );
}

function buildFormatDisplay(owner: any, fieldId: string): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input';
  input.id = controlId(fieldId);
  input.readOnly = true;
  input.disabled = true;
  input.value = formatOfManifest(owner);
  return input;
}

function entryObjectAt(list: any[], idx: number): any {
  const entry = list[idx];
  if (isPlainObject(entry)) return entry;
  return detachedSlot(list, idx, { val: entry ?? '' });
}

export function rowValueKey(entry: any): string {
  if (entry !== null && typeof entry === 'object' && !('val' in entry) && 'damage' in entry) return 'damage';
  return 'val';
}

function tierCells(
  holder: any,
  key: string,
  fieldId: string,
  onCommit: (immediate: boolean) => void,
  ariaLabel?: string,
): HTMLElement[] {
  const cells: HTMLElement[] = [];
  for (let tier = 0; tier < 3; tier += 1) {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'form-input tier-cell';
    input.id = controlId(`${fieldId}.${tier}`);
    input.dataset.tier = String(tier);
    if (ariaLabel !== undefined) input.setAttribute('aria-label', `${ariaLabel} tier ${tier + 1}`);
    input.value = tierCellText(holder[key], tier);
    input.addEventListener('input', () => {
      writeTierCell(holder, key, tier, input.value);
      onCommit(false);
    });
    input.addEventListener('change', () => {
      writeTierCell(holder, key, tier, input.value);
      onCommit(true);
    });
    cells.push(input);
  }
  return cells;
}

function buildTierScalar(spec: FieldSpec, owner: any, fieldId: string): HTMLElement {
  const host = document.createElement('div');
  host.className = 'row-line tier-scalar';
  host.dataset.tiers = spec.key;
  if (!Array.isArray(owner[spec.key])) host.dataset.shape = 'flat';
  for (const cell of tierCells(owner, spec.key, fieldId, (immediate) => commitDesigned({ immediate }), spec.label)) {
    host.appendChild(cell);
  }
  return host;
}

export function countText(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map((cell) => asText(cell)).join('/');
  return asText(raw);
}

function parseCount(text: string): number | number[] | string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  const parts = trimmed.split('/').map((part) => part.trim());
  if (parts.every((part) => part !== '' && !Number.isNaN(Number(part)))) {
    if (parts.length === 1) return Number(parts[0]);
    return parts.map((part) => Number(part));
  }
  return trimmed;
}

function buildCountInput(spec: FieldSpec, owner: any, fieldId: string): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input count-input';
  input.id = controlId(fieldId);
  input.autocomplete = 'off';
  input.placeholder = '4 or 4/5/6';
  input.value = countText(owner[spec.key]);
  const write = (immediate: boolean) => {
    owner[spec.key] = parseCount(input.value);
    commitDesigned({ immediate });
  };
  input.addEventListener('input', () => {
    write(false);
  });
  input.addEventListener('change', () => {
    write(true);
  });
  return input;
}

function buildValueRows(
  spec: FieldSpec,
  owner: any,
  path: (string | number)[],
  vocab: VocabKey,
  numeric: boolean,
  fieldId?: string,
): HTMLElement {
  const existing = owner[spec.key];
  if (existing !== undefined && existing !== null && !Array.isArray(existing)) {
    const fallback = document.createElement('div');
    fallback.className = 'fallback-block';
    renderRecursiveForm(existing, path, fallback, { bare: true });
    return fallback;
  }

  const host = document.createElement('div');
  host.className = 'row-editor';
  host.dataset.rows = spec.key;
  if (fieldId !== undefined) host.id = controlId(fieldId);

  const list: any[] = Array.isArray(existing) ? existing : [];
  list.forEach((_unused, idx) => {
    const entry = entryObjectAt(list, idx);
    const valueKey = rowValueKey(entry);
    const tiered = spec.tiered === true || Array.isArray(entry[valueKey]);
    const line = document.createElement('div');
    line.className = 'row-line';
    line.dataset.idx = String(idx);

    const type = buildVocabCombo(
      vocab,
      entry.type,
      (value) => {
        if (value === '') delete entry.type;
        else entry.type = value;
        commitDesigned({ immediate: true });
      },
      undefined,
      `${spec.label} type`,
    );
    type.classList.add('row-type');

    const remove = button('row-remove', '×', () => {
      list.splice(idx, 1);
      owner[spec.key] = list;
      commitDesigned({ immediate: true, rerender: true });
        }, { aria: 'Remove row' });

    if (tiered) {
      if (!Array.isArray(entry[valueKey])) line.dataset.shape = 'flat';
      line.appendChild(type);
      for (const cell of tierCells(
        entry,
        valueKey,
        `${spec.key}.${idx}`,
        (immediate) => commitDesigned({ immediate }),
        spec.label,
      )) {
        line.appendChild(cell);
      }
    } else {
      const val = document.createElement('input');
      val.className = 'form-input row-val';
      val.type = numeric ? 'number' : 'text';
      val.placeholder = numeric ? '10' : '2d6';
      val.setAttribute('aria-label', `${spec.label} value`);
      val.value = asText(entry[valueKey]);
      val.addEventListener('input', () => {
        entry[valueKey] = numeric ? (val.value.trim() === '' ? '' : Number(val.value)) : val.value;
        commitDesigned();
      });
      val.addEventListener('change', () => {
        entry[valueKey] = numeric ? (val.value.trim() === '' ? '' : Number(val.value)) : val.value;
        commitDesigned({ immediate: true });
      });
      line.appendChild(val);
      line.appendChild(type);
    }
    line.appendChild(remove);
    host.appendChild(line);
  });

  const add = button('btn-add-field btn-add-row', spec.addLabel ?? `+ ${spec.label}`, () => {
    list.push(blankValueRow(spec, vocab, numeric));
    owner[spec.key] = list;
    commitDesigned({ immediate: true, rerender: true });
    }, { dataset: { add: spec.key } });
  host.appendChild(add);
  return host;
}

function chipTagName(def: TagDef | undefined, id: string): string {
  const name = def?.name ?? '';
  if (name === '') return id;
  const trimmed = name.replace(/\s*\{VAL\}\s*/g, ' ').trim();
  return trimmed === '' ? id : trimmed;
}

export function tagIdOf(entry: any): string {
  if (entry !== null && typeof entry === 'object') return asText(entry.id);
  return asText(entry);
}

const TAG_CHIP_SURFACE = 'tags';

function tagChipVal(text: string): number | string {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return Number.isNaN(Number(trimmed)) ? trimmed : Number(trimmed);
}

function buildTagsControl(owner: any, key: string, fieldId?: string): HTMLElement {
  const host = document.createElement('div');
  host.className = 'tags-editor';
  host.dataset.tagsFor = key;

  const list: any[] = Array.isArray(owner[key]) ? owner[key] : [];
  const chips = document.createElement('div');
  chips.className = 'chip-row';
  list.forEach((entry, idx) => {
    const id = tagIdOf(entry);
    const def = tagDefFor(id);
    const carriesVal = def?.hasVal === true || (entry !== null && typeof entry === 'object' && entry.val !== undefined);
    let value: HTMLInputElement | undefined;
    if (carriesVal) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'chip-val';
      input.setAttribute('aria-label', `${chipTagName(def, id)} value`);
      input.value = asText(entry !== null && typeof entry === 'object' ? entry.val : '') || '0';
      input.addEventListener('change', () => {
        const target = entryObjectAt(list, idx);
        if (target.id === undefined) target.id = id;
        target.val = tagChipVal(input.value);
        commitDesigned({ immediate: true });
      });
      value = input;
    }

    const tag = chip({
      label: chipTagName(def, id),
      dataset: { tag: id },
      value,
      onRemove: () => {
        list.splice(idx, 1);
        owner[key] = list;
        commitDesigned({ immediate: true, rerender: true });
      },
    });
    wireDragReorder(tag, {
      index: idx,
      surface: TAG_CHIP_SURFACE,
      horizontal: true,
      onDrop: (from, after) => {
        if (!moveArrayItem(list, from, dropTargetIndex(from, idx, after))) return;
        owner[key] = list;
        commitDesigned({ immediate: true, rerender: true });
      },
    });
    chips.appendChild(tag);
  });
  host.appendChild(chips);

  const chosen = new Set(list.map((entry) => tagIdOf(entry)));
  host.appendChild(buildTagCombo(owner, key, list, chosen, fieldId));
  return host;
}

interface ComboOption {
  id: string;
  name: string;
  note: string;
}

interface ComboExtras {
  ariaLabel?: string;
  value?: string;
  onChange?: (value: string) => void;
  blurOnEmptyEnter?: boolean;
  hideOnPick?: boolean;
  setInputOnPick?: boolean;
  clearInputOnPick?: boolean;
  comboClass?: string;
  onFreeText?: (value: string) => void;
}

function buildCombo(
  placeholder: string,
  optionsFor: (needle: string) => ComboOption[],
  onPick: (id: string) => void,
  fieldId?: string,
  extras: ComboExtras = {},
): HTMLElement {
  const combo = document.createElement('div');
  combo.className = extras.comboClass ?? 'combo';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input combo-input';
  if (placeholder !== '') input.placeholder = placeholder;
  input.autocomplete = 'off';
  if (extras.ariaLabel !== undefined) input.setAttribute('aria-label', extras.ariaLabel);
  if (extras.value !== undefined) input.value = extras.value;
  if (fieldId !== undefined) input.id = controlId(fieldId);

  const menu = document.createElement('div');
  menu.className = 'combo-menu hidden';

  const paint = () => {
    const needle = input.value.trim().toLowerCase();
    menu.innerHTML = '';
    const options = optionsFor(needle).slice(0, COMBO_MENU_CAP);
    if (options.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'combo-empty';
      empty.innerText = 'No match';
      menu.appendChild(empty);
    }
    for (const option of options) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'combo-option';
      row.dataset.optId = option.id;
      const name = document.createElement('span');
      name.className = 'combo-option-name';
      name.innerText = option.name !== '' ? option.name : option.id;
      row.appendChild(name);
      if (option.note !== '') {
        const note = document.createElement('span');
        note.className = 'combo-option-note';
        note.innerText = option.note;
        row.appendChild(note);
      }
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
      row.addEventListener('click', () => {
        if (extras.setInputOnPick) input.value = option.id;
        onPick(option.id);
        if (extras.clearInputOnPick) input.value = '';
        if (extras.hideOnPick) menu.classList.add('hidden');
      });
      menu.appendChild(row);
    }
    menu.classList.remove('hidden');
  };

  input.addEventListener('focus', () => {
    openComboPaint = paint;
    paint();
  });
  input.addEventListener('input', paint);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      menu.classList.add('hidden');
      input.blur();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = menu.querySelector('.combo-option');
    if (first instanceof HTMLElement) {
      first.click();
      return;
    }
    if (extras.onFreeText !== undefined) {
      if (input.value.trim() !== '') extras.onFreeText(input.value);
      input.value = '';
      return;
    }
    if (extras.blurOnEmptyEnter) input.blur();
  });
  if (extras.onChange !== undefined) {
    const onChange = extras.onChange;
    input.addEventListener('change', () => {
      onChange(input.value);
    });
  }
  input.addEventListener('blur', () => {
    if (openComboPaint === paint) openComboPaint = null;
    setTimeout(() => menu.classList.add('hidden'), 150);
  });

  combo.appendChild(input);
  combo.appendChild(menu);
  return combo;
}

function buildTagCombo(owner: any, key: string, list: any[], chosen: Set<string>, fieldId?: string): HTMLElement {
  return buildCombo(
    'Add tag',
    (needle) =>
      knownTags()
        .filter((def) => !chosen.has(def.id))
        .filter((def) => needle === '' || `${def.name} ${def.id} ${def.description}`.toLowerCase().includes(needle))
        .map((def) => ({ id: def.id, name: chipTagName(def, def.id), note: clip(def.description, 60) })),
    (id) => {
      list.push(tagEntryFor(id));
      owner[key] = list;
      commitDesigned({ immediate: true, rerender: true });
    },
    fieldId,
  );
}

function localItemRefs(cat: string): Map<string, ItemRef> {
  const out = new Map<string, ItemRef>();
  if (!currentPack) return out;
  for (const item of passItems(cat)) {
    if (!isPlainObject(item)) continue;
    const id = asText((item as any).id).trim();
    if (id === '') continue;
    out.set(id, { id, name: asText((item as any).name), pack: currentPack?.name ?? '' });
  }
  return out;
}

function refLookup(cat: string): (id: string) => ItemRef | undefined {
  const cached = validationPass?.refs.get(cat);
  if (cached !== undefined) return cached;
  const local = localItemRefs(cat);
  const indexed = itemRefs.get(cat);
  const lookup = (id: string) => local.get(id) ?? indexed?.get(id);
  validationPass?.refs.set(cat, lookup);
  return lookup;
}

function refFor(cat: string, id: string): ItemRef | undefined {
  return refLookup(cat)(id);
}

function refIdOf(entry: any): string {
  if (entry !== null && typeof entry === 'object') return asText(entry.id);
  return asText(entry);
}

interface DerivedFeature {
  index: number;
  item: any;
  base: boolean;
}

export type OwnerKind = 'Class' | 'Template';

export const NPC_FEATURE_OWNER_FILES = ['npc_classes.json', 'npc_templates.json'];

export const OWNER_KIND_BY_FILE: Record<string, OwnerKind> = {
  'npc_classes.json': 'Class',
  'npc_templates.json': 'Template',
};

function ownerKindOf(raw: unknown): OwnerKind | null {
  const text = asText(raw).trim().toLowerCase();
  if (text === 'class') return 'Class';
  if (text === 'template') return 'Template';
  return null;
}

function featureOriginKind(feature: any): OwnerKind | null {
  if (!feature || typeof feature !== 'object') return null;
  const origin = (feature as any).origin;
  if (!isPlainObject(origin)) return null;
  return ownerKindOf((origin as any).type);
}

function featureOriginKeys(feature: any, kind: OwnerKind | null = null): string[] {
  if (!feature || typeof feature !== 'object') return [];
  if (kind !== null) {
    const declared = featureOriginKind(feature);
    if (declared !== null && declared !== kind) return [];
  }
  const origin = (feature as any).origin;
  const keys: string[] = [];
  if (typeof origin === 'string') keys.push(origin);
  else if (origin !== null && typeof origin === 'object') {
    keys.push(asText((origin as any).id));
    keys.push(asText((origin as any).name));
  }
  return keys.map((key) => key.trim().toLowerCase()).filter((key) => key !== '');
}

export function featureClaimsOwner(feature: any, keys: Set<string>, kind: OwnerKind | null): boolean {
  if (keys.size === 0) return false;
  return featureOriginKeys(feature, kind).some((key) => keys.has(key));
}

function ownerKindIn(owner: any, pack: PackDraft | null = currentPack): OwnerKind | null {
  if (owner === null || typeof owner !== 'object' || pack === null) return null;
  for (const file of NPC_FEATURE_OWNER_FILES) {
    if (catItems(file, pack).includes(owner)) return OWNER_KIND_BY_FILE[file] ?? null;
  }
  return null;
}

export function featureIsBase(feature: any): boolean {
  if (!feature || typeof feature !== 'object') return false;
  const entry = feature as any;
  if (entry.base === true) return true;
  const origin = entry.origin;
  return origin !== null && typeof origin === 'object' && (origin as any).base === true;
}

export function ownerKeysFor(owner: any): Set<string> {
  const keys = new Set<string>();
  for (const value of [asText(owner?.id), asText(owner?.name)]) {
    const key = value.trim().toLowerCase();
    if (key !== '') keys.add(key);
  }
  return keys;
}

export function derivedFeaturesFor(
  owner: any,
  pack: PackDraft | null = currentPack,
  kind: OwnerKind | null = ownerKindIn(owner, pack),
): DerivedFeature[] {
  const keys = ownerKeysFor(owner);
  const out: DerivedFeature[] = [];
  if (keys.size === 0) return out;
  catItems('npc_features.json', pack).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    if (!featureClaimsOwner(item, keys, kind)) return;
    out.push({ index, item, base: featureIsBase(item) });
  });
  return out;
}

interface FeatureLinks {
  base: string[];
  optional: string[];
}

export function deriveFeatureLinks(owner: any, features: any[], kind: OwnerKind | null = null): FeatureLinks {
  const keys = ownerKeysFor(owner);
  const base: string[] = [];
  const optional: string[] = [];
  if (keys.size === 0) return { base, optional };
  const seen = new Set<string>();
  for (const item of features) {
    if (!item || typeof item !== 'object') continue;
    if (!featureClaimsOwner(item, keys, kind)) continue;
    const id = asText(item.id);
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    (featureIsBase(item) ? base : optional).push(id);
  }
  return { base, optional };
}

const FEATURE_LINK_KEYS = ['base_features', 'optional_features'];

function ownerStoresFeatureLinks(owner: any): boolean {
  return FEATURE_LINK_KEYS.some((key) => key in owner);
}

export function regenerateNpcFeatureArrays(pack: PackDraft | null = currentPack): void {
  if (pack === null) return;
  const features = catItems('npc_features.json', pack);
  const alwaysStores = packFormatOf(pack) === 'v2';
  for (const file of NPC_FEATURE_OWNER_FILES) {
    const kind = OWNER_KIND_BY_FILE[file] ?? null;
    for (const owner of catItems(file, pack)) {
      if (!owner || typeof owner !== 'object') continue;
      if (!alwaysStores && !ownerStoresFeatureLinks(owner)) continue;
      const links = deriveFeatureLinks(owner, features, kind);
      owner.base_features = links.base;
      owner.optional_features = links.optional;
    }
  }
}

export interface OwnerKeySnapshot {
  id: string;
  name: string;
  kind: OwnerKind | null;
}

export function ownerKeySnapshot(owner: any, pack: PackDraft | null = currentPack): OwnerKeySnapshot {
  return { id: asText(owner?.id), name: asText(owner?.name), kind: ownerKindIn(owner, pack) };
}

function sameKey(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  return left !== '' && left === b.trim().toLowerCase();
}

export function retargetFeatureOrigin(
  feature: any,
  before: { id: string; name: string },
  next: { id: string; name: string },
): boolean {
  if (!feature || typeof feature !== 'object') return false;
  const origin = (feature as any).origin;
  if (typeof origin === 'string') {
    if (next.id !== '' && sameKey(origin, before.id)) {
      (feature as any).origin = next.id;
      return true;
    }
    if (next.name !== '' && sameKey(origin, before.name)) {
      (feature as any).origin = next.name;
      return true;
    }
    return false;
  }
  if (!isPlainObject(origin)) return false;
  let touched = false;
  if (next.id !== '' && sameKey(asText((origin as any).id), before.id)) {
    (origin as any).id = next.id;
    touched = true;
  }
  if (next.name !== '' && sameKey(asText((origin as any).name), before.name)) {
    (origin as any).name = next.name;
    touched = true;
  }
  return touched;
}

export function rehomeDependentFeatures(
  owner: any,
  before: OwnerKeySnapshot,
  pack: PackDraft | null = currentPack,
): number {
  if (pack === null || owner === null || typeof owner !== 'object') return 0;
  const next = { id: asText(owner.id), name: asText(owner.name) };
  if (sameKey(next.id, before.id) && sameKey(next.name, before.name)) return 0;
  const keys = new Set<string>();
  for (const value of [before.id, before.name]) {
    const key = value.trim().toLowerCase();
    if (key !== '') keys.add(key);
  }
  if (keys.size === 0) return 0;
  let moved = 0;
  for (const feature of catItems('npc_features.json', pack)) {
    if (!feature || typeof feature !== 'object') continue;
    if (!featureClaimsOwner(feature, keys, before.kind)) continue;
    if (retargetFeatureOrigin(feature, before, next)) moved += 1;
  }
  return moved;
}

function swapLeadingSegment(id: string, oldSegment: string, newSegment: string): string | null {
  if (oldSegment === '') return null;
  let rest: string | null = null;
  if (id === oldSegment) rest = '';
  else if (id.startsWith(`${oldSegment}_`)) rest = id.slice(oldSegment.length + 1);
  if (rest === null) return null;
  if (newSegment === '') return rest;
  return rest === '' ? newSegment : `${newSegment}_${rest}`;
}

function reprefixIdFor(id: string, oldPrefix: string, newPrefix: string): string | null {
  if (oldPrefix !== '') return swapLeadingSegment(id, oldPrefix, newPrefix);
  if (newPrefix === '') return null;
  if (id === newPrefix || id.startsWith(`${newPrefix}_`)) return null;
  return `${newPrefix}_${id}`;
}

export const ID_STRING_ARRAY_KEYS = new Set([
  'integrated',
  'base_features',
  'optional_features',
  'deployables',
  'special_equipment',
  'skills',
]);
export const ID_ENTRY_ARRAY_KEYS = new Set(['tags', 'added_tags', 'add_status']);

function rewriteIdArrayInPlace(list: unknown[], renamed: Map<string, string>): void {
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (typeof entry === 'string') {
      const next = renamed.get(entry);
      if (next !== undefined) list[i] = next;
    } else if (entry !== null && typeof entry === 'object' && typeof (entry as any).id === 'string') {
      const next = renamed.get((entry as any).id);
      if (next !== undefined) (entry as any).id = next;
    }
  }
}

export const ID_SCALAR_KEYS = new Set(['origin', 'license_id', 'source']);


export function rewriteIdReferences(data: Record<string, unknown>, renamed: Map<string, string>): void {
  if (renamed.size === 0) return;
  const walk = (node: unknown, depth = 0): void => {
    if (depth >= REF_WALK_DEPTH) return;
    if (Array.isArray(node)) {
      for (const entry of node) if (entry !== null && typeof entry === 'object') walk(entry, depth + 1);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      const value = (node as any)[key];
      if (ID_SCALAR_KEYS.has(key) && typeof value === 'string') {
        const next = renamed.get(value);
        if (next !== undefined) (node as any)[key] = next;
        continue;
      }
      if ((ID_STRING_ARRAY_KEYS.has(key) || ID_ENTRY_ARRAY_KEYS.has(key)) && Array.isArray(value)) {
        rewriteIdArrayInPlace(value, renamed);
        continue;
      }
      if (key === 'synergies' && Array.isArray(value)) {
        for (const entry of value) {
          if (entry === null || typeof entry !== 'object') continue;
          if (typeof (entry as any).id === 'string') {
            const next = renamed.get((entry as any).id);
            if (next !== undefined) (entry as any).id = next;
          }
          if (Array.isArray((entry as any).locations)) rewriteIdArrayInPlace((entry as any).locations, renamed);
        }
        continue;
      }
      if (value !== null && typeof value === 'object') walk(value, depth + 1);
    }
  };
  for (const cat of Object.keys(data)) {
    if (cat === PACK_MANIFEST) continue;
    const items = (data as any)[cat];
    if (items === null || typeof items !== 'object') continue;
    walk(items);
  }
}

function rehomeLicenseNames(data: Record<string, unknown>, frame: any, beforeName: string, afterName: string): number {
  if (afterName === '') return 0;
  const frameId = asText(frame?.id).trim();
  const frameSource = asText(frame?.source).trim();
  let moved = 0;
  for (const cat of Object.keys(data)) {
    if (cat === PACK_MANIFEST || cat === 'frames.json') continue;
    const items = (data as any)[cat];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!isPlainObject(item)) continue;
      const licenseId = asText((item as any).license_id).trim();
      const currentLicense = asText((item as any).license).trim();
      const linkedById = frameId !== '' && licenseId === frameId;
      const linkedByName =
        licenseId === '' &&
        beforeName !== '' &&
        currentLicense === beforeName &&
        asText((item as any).source).trim() === frameSource;
      if (!linkedById && !linkedByName) continue;
      if (currentLicense !== afterName) {
        (item as any).license = afterName;
        moved += 1;
      }
    }
  }
  return moved;
}

function isEidolonLayerOwner(owner: any, pack: PackDraft | null = currentPack): boolean {
  if (owner === null || typeof owner !== 'object' || pack === null) return false;
  const layers = pack.data[EIDOLON_LAYERS];
  return Array.isArray(layers) && layers.includes(owner);
}

function eidolonLayerFeatureLists(layer: any): any[][] {
  const lists: any[][] = [];
  if (Array.isArray(layer?.features)) lists.push(layer.features);
  const shards = layer?.shards;
  if (shards !== null && typeof shards === 'object' && Array.isArray(shards.features)) lists.push(shards.features);
  return lists;
}

function reidPrefixedLayerFeatures(layer: any, oldLayerId: string, newLayerId: string): Map<string, string> {
  const renamed = new Map<string, string>();
  if (oldLayerId === '' || newLayerId === '' || sameKey(newLayerId, oldLayerId)) return renamed;
  for (const list of eidolonLayerFeatureLists(layer)) {
    for (const feature of list) {
      if (!feature || typeof feature !== 'object') continue;
      const featureId = asText(feature.id);
      if (featureId === '') continue;
      const candidate = swapLeadingSegment(featureId, oldLayerId, newLayerId);
      if (candidate === null || candidate === featureId) continue;
      const finalId = uniqueSiblingId(list, candidate, feature);
      feature.id = finalId;
      if (finalId !== featureId) renamed.set(featureId, finalId);
    }
  }
  return renamed;
}

function rehomeEidolonLayerFeatures(
  layer: any,
  before: { id: string },
  pack: PackDraft | null = currentPack,
): void {
  if (pack === null) return;
  const beforeId = before.id.trim();
  const afterId = asText(layer?.id).trim();
  const renamed = reidPrefixedLayerFeatures(layer, beforeId, afterId);
  if (beforeId !== '' && afterId !== '' && beforeId !== afterId) renamed.set(beforeId, afterId);
  rewriteIdReferences(pack.data, renamed);
}

interface PackIdEntry {
  cat: string;
  item: Record<string, unknown>;
}

function collectPackIdItems(data: Record<string, unknown>): PackIdEntry[] {
  const out: PackIdEntry[] = [];
  for (const cat of Object.keys(data)) {
    if (cat === PACK_MANIFEST) continue;
    const items = data[cat];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!isPlainObject(item)) continue;
      out.push({ cat, item: item as Record<string, unknown> });
    }
  }
  return out;
}

function reprefixPlan(pack: PackDraft, oldPrefixRaw: string, newPrefixRaw: string): Map<string, string> {
  const oldPrefix = slugifyName(oldPrefixRaw);
  const oldPrefixLiteral = oldPrefixRaw.trim();
  const newPrefix = slugifyName(newPrefixRaw);
  const renamed = new Map<string, string>();
  if (oldPrefix === newPrefix) return renamed;
  const entries = collectPackIdItems(pack.data);
  const taken = new Set<string>();
  for (const entry of entries) {
    const id = entry.item.id;
    if (typeof id === 'string' && id !== '') taken.add(id);
  }
  for (const entry of entries) {
    const id = entry.item.id;
    if (typeof id !== 'string' || id === '') continue;
    const candidate =
      reprefixIdFor(id, oldPrefix, newPrefix) ??
      (oldPrefixLiteral !== oldPrefix ? reprefixIdFor(id, oldPrefixLiteral, newPrefix) : null);
    if (candidate === null || candidate === id) continue;
    const finalId = firstFreeId(taken, candidate);
    taken.delete(id);
    taken.add(finalId);
    renamed.set(id, finalId);
  }
  return renamed;
}

function reprefixCandidateCount(pack: PackDraft, oldPrefixRaw: string, newPrefixRaw: string): number {
  return reprefixPlan(pack, oldPrefixRaw, newPrefixRaw).size;
}

export function reprefixPack(pack: PackDraft, oldPrefixRaw: string, newPrefixRaw: string): void {
  const plan = reprefixPlan(pack, oldPrefixRaw, newPrefixRaw);
  if (plan.size === 0) return;
  const combined = new Map(plan);
  for (const entry of collectPackIdItems(pack.data)) {
    const id = entry.item.id;
    if (typeof id !== 'string') continue;
    const next = plan.get(id);
    if (next === undefined) continue;
    entry.item.id = next;
    if (entry.cat === EIDOLON_LAYERS) {
      for (const [oldFid, newFid] of reidPrefixedLayerFeatures(entry.item, id, next)) combined.set(oldFid, newFid);
    }
  }
  rewriteIdReferences(pack.data, combined);
}

async function promptReprefixPack(pack: PackDraft, oldPrefix: string, newPrefix: string): Promise<void> {
  if (slugifyName(oldPrefix) === '' && slugifyName(newPrefix) !== '') {
    const count = reprefixCandidateCount(pack, oldPrefix, newPrefix);
    if (count === 0) return;
    const ok = await customConfirm(`Prefix ${count} item ids?`);
    if (!ok) return;
    reprefixPack(pack, oldPrefix, newPrefix);
    renderMasterList();
    refreshPreview();
    return;
  }
  reprefixPack(pack, oldPrefix, newPrefix);
  renderMasterList();
}

function ownerFilesForKind(kind: OwnerKind | null): string[] {
  if (kind === null) return NPC_FEATURE_OWNER_FILES;
  return NPC_FEATURE_OWNER_FILES.filter((file) => OWNER_KIND_BY_FILE[file] === kind);
}

function featureOriginLabel(feature: any): string {
  const origin = (feature as any)?.origin;
  if (typeof origin === 'string') return asText(origin);
  if (origin === null || typeof origin !== 'object') return '';
  return asText((origin as any).name) || asText((origin as any).id);
}

function featureOriginProblem(feature: any, pack: PackDraft | null = currentPack): string | null {
  if (pack === null || !feature || typeof feature !== 'object') return null;
  const keys = featureOriginKeys(feature);
  if (keys.length === 0) return null;
  const kind = featureOriginKind(feature);
  let owners = 0;
  for (const file of ownerFilesForKind(kind)) {
    for (const owner of catItems(file, pack)) {
      if (!owner || typeof owner !== 'object') continue;
      owners += 1;
      for (const key of ownerKeysFor(owner)) {
        if (keys.includes(key)) return null;
      }
    }
  }
  if (owners === 0) return null;
  const what = kind === 'Template' ? 'template' : kind === 'Class' ? 'class' : 'class or template';
  return `No ${what} named ${featureOriginLabel(feature)}.`;
}

function advanceOwnerKey(before: OwnerKeySnapshot, owner: any): OwnerKeySnapshot {
  const id = asText(owner?.id);
  const name = asText(owner?.name);
  return {
    id: id === '' ? before.id : id,
    name: name === '' ? before.name : name,
    kind: before.kind,
  };
}

function featureListIn(pack: PackDraft, targetFile: string): any[] {
  const home = pack.data[targetFile];
  if (Array.isArray(home)) return home;
  const own = pack.data['npc_features.json'];
  if (Array.isArray(own)) return own;
  const created: any[] = [];
  pack.data['npc_features.json'] = created;
  return created;
}

export function cloneOwnerFeatures(
  source: any,
  clone: any,
  targetFile: string,
  pack: PackDraft | null = currentPack,
): number {
  if (pack === null || clone === null || typeof clone !== 'object') return 0;
  const derived = derivedFeaturesFor(source, pack);
  if (derived.length === 0) return 0;
  const list = featureListIn(pack, targetFile);
  const before = { id: asText(source?.id), name: asText(source?.name) };
  const next = { id: asText(clone.id), name: asText(clone.name) };
  let landed = 0;
  for (const entry of derived) {
    const copy = JSON.parse(JSON.stringify(entry.item));
    const sourceId = asText(copy.id);
    if (sourceId !== '') copy.id = uniqueAutoId('npc_features.json', `${sourceId}_copy`, copy, pack);
    retargetFeatureOrigin(copy, before, next);
    list.push(copy);
    landed += 1;
  }
  return landed;
}

async function gotoCategoryItem(cat: string, index: number) {
  if (index < 0) return;
  if (!(await confirmDiscardJsonEdits())) return;
  selectCategory(cat);
  selectItem(index);
}

const FEATURE_CHIP_SURFACE = 'chip';

function markFeatureBase(feature: any, base: boolean): void {
  if (!feature || typeof feature !== 'object') return;
  const origin = (feature as any).origin;
  const objectOrigin = isPlainObject(origin);
  if (objectOrigin) {
    (origin as any).base = base;
    if (!base && 'base' in (feature as any)) delete (feature as any).base;
    else if (base && 'base' in (feature as any)) (feature as any).base = true;
    return;
  }
  if (base) (feature as any).base = true;
  else delete (feature as any).base;
}

function groupDropIndex(owner: any, base: boolean, from: number): number {
  const entries = derivedFeaturesFor(owner).filter((entry) => entry.base === base && entry.index !== from);
  if (entries.length === 0) return -1;
  return dropTargetIndex(from, entries[entries.length - 1].index, true);
}

function dropFeatureIntoGroup(from: number, base: boolean, targetIndex: number): boolean {
  const feature = catItems('npc_features.json')[from];
  if (feature === undefined || feature === null || typeof feature !== 'object') return false;
  const flipped = featureIsBase(feature) !== base;
  if (flipped) markFeatureBase(feature, base);
  const moved = targetIndex >= 0 && reorderCategoryItem('npc_features.json', from, targetIndex);
  return flipped || moved;
}

function wireFeatureChipDrag(target: HTMLElement, realIndex: number, base: boolean) {
  wireDragReorder(target, {
    index: realIndex,
    surface: FEATURE_CHIP_SURFACE,
    horizontal: true,
    stopOnTarget: true,
    onDrop: (from, after) => {
      if (!dropFeatureIntoGroup(from, base, dropTargetIndex(from, realIndex, after))) return;
      commitDesigned({ immediate: true, rerender: true });
    },
  });
}

function wireFeatureGroupDrop(row: HTMLElement, owner: any, base: boolean) {
  row.addEventListener('dragover', (e) => paintDragOver(e, row, true));
  row.addEventListener('dragleave', () => clearDragOver(row));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDragOver(row);
    const from = dragSourceIndex(e, FEATURE_CHIP_SURFACE);
    if (from === null) return;
    if (!dropFeatureIntoGroup(from, base, groupDropIndex(owner, base, from))) return;
    commitDesigned({ immediate: true, rerender: true });
  });
}

function scaffoldFeatureFor(owner: any, base: boolean): any {
  const siblings = derivedFeaturesFor(owner);
  const usesStringOrigin = siblings.some((entry) => typeof entry.item?.origin === 'string');
  const usesObjectOrigin = siblings.some(
    (entry) => entry.item?.origin !== null && typeof entry.item?.origin === 'object',
  );
  const classId = asText(owner?.id);
  const className = asText(owner?.name);
  const objectOrigin = usesObjectOrigin ? !usesStringOrigin : currentFormat() === 'v2';
  const feature: any = objectOrigin
    ? { id: '', name: 'New Feature', origin: {}, locked: false, type: 'Trait', effect: '', tags: [] }
    : { id: '', name: 'New Feature', origin: '', base, type: 'Trait', effect: '' };
  if (objectOrigin) {
    feature.origin = {
      type: currentCategory === 'npc_templates.json' ? 'Template' : 'Class',
      name: className !== '' ? className : classId,
      base,
    };
  } else {
    feature.origin = classId !== '' ? classId : className;
  }
  feature.id = uniqueAutoId('npc_features.json', autoIdFor('npc_features.json', feature.name), feature);
  return feature;
}

function linkFeatureId(owner: any, base: boolean, id: string) {
  if (id === '' || owner === null || typeof owner !== 'object') return;
  const key = base ? 'base_features' : 'optional_features';
  const list = Array.isArray(owner[key]) ? owner[key] : [];
  if (!list.some((entry: any) => refIdOf(entry) === id)) list.push(id);
  owner[key] = list;
}

function addDerivedFeature(owner: any, base: boolean) {
  if (!currentPack || !currentCategory || currentItemIndex === null) return;
  const home = containerFor(currentCategory, currentItemIndex);
  const targetFile = home !== null && home.file !== currentCategory ? home.file : 'npc_features.json';
  const list = Array.isArray(currentPack.data[targetFile])
    ? currentPack.data[targetFile]
    : standardListFor('npc_features.json');
  const feature = scaffoldFeatureFor(owner, base);
  list.push(feature);
  if (currentFormat() === 'v2') linkFeatureId(owner, base, asText(feature.id));
  autoIdItems.add(feature);
  flushPackSave();
  validateCurrentPack();
  const landed = slotIndexOf('npc_features.json', targetFile, list.length - 1);
  void gotoCategoryItem('npc_features.json', landed === -1 ? catCount('npc_features.json') - 1 : landed);
}

function buildDerivedFeatures(owner: any): HTMLElement {
  const host = document.createElement('div');
  host.className = 'derived-features';

  const derived = derivedFeaturesFor(owner);
  const groups: { title: string; base: boolean; entries: DerivedFeature[] }[] = [
    { title: 'Base Features', base: true, entries: derived.filter((entry) => entry.base) },
    { title: 'Optional Features', base: false, entries: derived.filter((entry) => !entry.base) },
  ];

  for (const group of groups) {
    const block = document.createElement('div');
    block.className = 'derived-group';
    block.dataset.group = group.base ? 'base' : 'optional';

    const label = document.createElement('div');
    label.className = 'field-label';
    label.innerText = group.title;
    block.appendChild(label);

    const chips = document.createElement('div');
    chips.className = 'chip-row';
    wireFeatureGroupDrop(chips, owner, group.base);
    for (const entry of group.entries) {
      const ref = chip({
        label: asText(entry.item.name) || asText(entry.item.id),
        dataset: { ref: asText(entry.item.id) },
        onOpen: () => {
          void gotoCategoryItem('npc_features.json', entry.index);
        },
      });
      wireFeatureChipDrag(ref, entry.index, group.base);
      chips.appendChild(ref);
    }
    if (group.entries.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'derived-empty';
      empty.innerText = 'None';
      chips.appendChild(empty);
    }
    block.appendChild(chips);

    const add = button('btn-add-field btn-add-row', group.base ? '+ Base Feature' : '+ Optional Feature', () => {
      addDerivedFeature(owner, group.base);
        }, { dataset: { add: group.base ? 'base_feature' : 'optional_feature' } });
    block.appendChild(add);
    host.appendChild(block);
  }
  return host;
}

const ORIGIN_OBJECT_FIELDS: FieldSpec[] = [
  { key: 'type', label: 'Origin Type', kind: 'text' },
  { key: 'name', label: 'Origin Name', kind: 'text' },
  { key: 'base', label: 'Base Feature', kind: 'checkbox' },
];

function buildOriginControl(spec: FieldSpec, owner: any, path: (string | number)[], fieldId: string): HTMLElement {
  const value = owner[spec.key];
  if (isPlainObject(value)) {
    return buildGroupControl({ ...spec, kind: 'group', fields: ORIGIN_OBJECT_FIELDS }, owner, path, fieldId);
  }
  return buildTextInput({ ...spec, kind: 'text' }, owner, fieldId);
}

function tierCellText(raw: any, tier: number): string {
  if (Array.isArray(raw)) {
    const cell = raw[tier];
    if (Array.isArray(cell)) return asText(cell[0]);
    return asText(cell);
  }
  return asText(raw);
}

function writeTierCell(stats: any, key: string, tier: number, text: string) {
  const next = text.trim() === '' ? '' : Number(text);
  const raw = stats[key];
  if (Array.isArray(raw)) {
    const cell = raw[tier];
    if (Array.isArray(cell)) {
      if (cell.length === 0) cell.push(next);
      else cell[0] = next;
      return;
    }
    while (raw.length < 3) raw.push('');
    raw[tier] = next;
    return;
  }
  const base = raw === undefined || raw === null ? '' : raw;
  const promoted = [base, base, base];
  promoted[tier] = next;
  stats[key] = promoted;
}

function tierStatKeys(spec: FieldSpec, stats: any): { key: string; label: string }[] {
  const rows = [...(spec.cells ?? [])];
  const seen = new Set(rows.map((row) => row.key));
  for (const key of Object.keys(stats ?? {})) {
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, label: humanizeKey(key) });
  }
  return rows;
}

function buildTierGrid(spec: FieldSpec, owner: any, path: (string | number)[], fieldId: string): HTMLElement {
  const stats = objectSlotFor(owner, spec.key);
  if (stats === null) return buildSlotFallback(spec, owner, path, fieldId);

  const host = document.createElement('div');
  host.className = 'tier-grid';
  host.dataset.tiers = spec.key;

  const head = document.createElement('div');
  head.className = 'tier-row tier-head';
  const corner = document.createElement('span');
  corner.className = 'tier-label';
  head.appendChild(corner);
  for (const tier of ['Tier 1', 'Tier 2', 'Tier 3']) {
    const cell = document.createElement('span');
    cell.className = 'tier-col';
    cell.innerText = tier;
    head.appendChild(cell);
  }
  host.appendChild(head);

  for (const row of tierStatKeys(spec, stats)) {
    const line = document.createElement('div');
    line.className = 'tier-row';
    line.dataset.stat = row.key;
    if (!Array.isArray(stats[row.key]) && stats[row.key] !== undefined) line.dataset.shape = 'flat';
    const label = document.createElement('span');
    label.className = 'tier-label';
    label.innerText = row.label;
    line.appendChild(label);
    for (let tier = 0; tier < 3; tier += 1) {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'form-input tier-cell';
      input.id = controlId(`${fieldId}.${row.key}.${tier}`);
      input.dataset.tier = String(tier);
      input.setAttribute('aria-label', `${row.label} tier ${tier + 1}`);
      input.value = tierCellText(stats[row.key], tier);
      input.addEventListener('input', () => {
        writeTierCell(stats, row.key, tier, input.value);
        commitDesigned();
      });
      input.addEventListener('change', () => {
        writeTierCell(stats, row.key, tier, input.value);
        commitDesigned({ immediate: true });
      });
      line.appendChild(input);
    }
    host.appendChild(line);
  }
  return host;
}

function buildChipsControl(spec: FieldSpec, owner: any, fieldId?: string): HTMLElement {
  const host = document.createElement('div');
  host.className = 'chips-editor';
  host.dataset.chipsFor = spec.key;

  const list: any[] = Array.isArray(owner[spec.key]) ? owner[spec.key] : [];
  const chips = document.createElement('div');
  chips.className = 'chip-row';
  list.forEach((entry, idx) => {
    const value = asText(entry);
    chips.appendChild(
      chip({
        label: value,
        dataset: { value },
        onRemove: () => {
          list.splice(idx, 1);
          owner[spec.key] = list;
          commitDesigned({ immediate: true, rerender: true });
        },
      }),
    );
  });
  host.appendChild(chips);

  const vocab = spec.vocab ?? 'mounts';
  const chosen = new Set(list.map((entry) => asText(entry)));
  const addChip = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '' || chosen.has(trimmed)) return;
    list.push(trimmed);
    owner[spec.key] = list;
    commitDesigned({ immediate: true, rerender: true });
  };

  host.appendChild(
    buildCombo(
      `+ ${spec.label}`,
      (needle) =>
        comboOptionsFor(vocab, '', needle)
          .filter((value) => !chosen.has(value))
          .map((value) => ({ id: value, name: value, note: '' })),
      addChip,
      fieldId,
      { comboClass: 'combo chip-add', clearInputOnPick: true, hideOnPick: true, onFreeText: addChip },
    ),
  );
  return host;
}

interface ListEditorSpec<T> {
  rowData: (idx: number) => T;
  title: (data: T, idx: number) => string;
  body: (row: HTMLElement, data: T, idx: number) => void;
  blank: () => any;
}

function listEditor<T>(spec: FieldSpec, owner: any, list: any[], editor: ListEditorSpec<T>): HTMLElement {
  const host = document.createElement('div');
  host.className = 'sub-rows';
  host.dataset.rows = spec.key;

  list.forEach((_unused, idx) => {
    const data = editor.rowData(idx);
    const row = document.createElement('div');
    row.className = 'sub-row';
    row.dataset.idx = String(idx);

    const head = document.createElement('div');
    head.className = 'sub-row-head';
    const title = document.createElement('span');
    title.className = 'sub-row-title';
    title.innerText = editor.title(data, idx);
    head.appendChild(title);
    head.appendChild(button('row-remove', '×', () => {
      list.splice(idx, 1);
      owner[spec.key] = list;
      commitDesigned({ immediate: true, rerender: true });
    }, { aria: 'Remove row' }));
    row.appendChild(head);

    editor.body(row, data, idx);
    host.appendChild(row);
  });

  host.appendChild(button('btn-add-field btn-add-row', spec.addLabel ?? `+ ${spec.label}`, () => {
    list.push(editor.blank());
    owner[spec.key] = list;
    commitDesigned({ immediate: true, rerender: true });
  }, { dataset: { add: spec.key } }));
  return host;
}

function buildObjectRows(spec: FieldSpec, owner: any, path: (string | number)[], fieldId: string): HTMLElement {
  const columns = spec.columns ?? NAME_DESC_COLUMNS;
  const list: any[] = Array.isArray(owner[spec.key]) ? owner[spec.key] : [];
  return listEditor(spec, owner, list, {
    rowData: (idx) => entryObjectAt(list, idx),
    title: (entry, idx) => (asText(entry.name) !== '' ? asText(entry.name) : `${spec.label} ${idx + 1}`),
    body: (row, entry, idx) => {
      const grid = document.createElement('div');
      grid.className = 'field-grid';
      const covered = new Set<string>();
      for (const column of designedFieldSpecs(columns, entry)) {
        covered.add(column.key);
        const columnFieldId = `${fieldId}.${idx}.${column.key}`;
        const rowFollow: RowIdFollow | undefined =
          spec.rowIdBase !== undefined && (column.key === 'id' || column.key === 'name')
            ? {
                siblings: list,
                idBase: (name: string) => spec.rowIdBase!(owner, name),
                idFieldId: `${fieldId}.${idx}.id`,
              }
            : undefined;
        grid.appendChild(renderField(column, entry, [...path, idx, column.key], columnFieldId, false, rowFollow));
      }
      row.appendChild(grid);
      const more = advancedBlock(entry, [...path, idx], covered, 'More', true);
      if (more !== null) row.appendChild(more);
    },
    blank: () => {
      const created = blankObjectRow(spec, owner);
      if (spec.rowIdBase !== undefined) autoIdItems.add(created);
      return created;
    },
  });
}

function buildStringListControl(spec: FieldSpec, owner: any, fieldId: string): HTMLElement {
  const list: any[] = Array.isArray(owner[spec.key]) ? owner[spec.key] : [];
  return listEditor(spec, owner, list, {
    rowData: (idx) => list[idx],
    title: (_value, idx) => `${spec.label} ${idx + 1}`,
    body: (row, value, idx) => {
      const input = document.createElement('textarea');
      input.className = 'form-textarea';
      input.id = controlId(`${fieldId}.${idx}`);
      input.value = asText(value);
      input.addEventListener('change', () => {
        list[idx] = input.value;
        owner[spec.key] = list;
        commitDesigned({ immediate: true });
      });
      row.appendChild(input);
    },
    blank: () => '',
  });
}

function buildStatsGrid(spec: FieldSpec, owner: any, path: (string | number)[], fieldId: string): HTMLElement {
  const stats = objectSlotFor(owner, spec.key);
  if (stats === null) return buildSlotFallback(spec, owner, path, fieldId);
  const host = document.createElement('div');
  host.className = 'stat-grid';
  for (const cell of spec.cells ?? []) {
    const wrap = document.createElement('label');
    wrap.className = 'stat-cell';
    const label = document.createElement('span');
    label.className = 'stat-label';
    label.innerText = cell.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'form-input';
    input.id = controlId(`${fieldId}.${cell.key}`);
    const raw = stats[cell.key];
    input.value = typeof raw === 'number' || typeof raw === 'string' ? String(raw) : '';
    input.addEventListener('input', () => {
      if (input.value.trim() === '') delete stats[cell.key];
      else stats[cell.key] = Number(input.value);
      commitDesigned();
    });
    input.addEventListener('change', () => {
      commitDesigned({ immediate: true });
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    host.appendChild(wrap);
  }
  return host;
}

function buildGroupControl(spec: FieldSpec, owner: any, path: (string | number)[], fieldId: string): HTMLElement {
  const group = objectSlotFor(owner, spec.key);
  if (group === null) return buildSlotFallback(spec, owner, path, fieldId);
  const host = document.createElement('div');
  host.className = 'group-block';
  const grid = document.createElement('div');
  grid.className = 'field-grid';
  const covered = new Set<string>();
  for (const sub of designedFieldSpecs(spec.fields ?? [], group)) {
    covered.add(sub.key);
    grid.appendChild(renderField(sub, group, [...path, sub.key], `${fieldId}.${sub.key}`));
  }
  host.appendChild(grid);
  const more = advancedBlock(group, path, covered, 'More', true);
  if (more !== null) host.appendChild(more);
  return host;
}

function isNumericCell(value: unknown): boolean {
  const cell = Array.isArray(value) ? value[0] : value;
  if (typeof cell === 'number') return Number.isFinite(cell);
  const text = asText(cell).trim();
  return text !== '' && !Number.isNaN(Number(text));
}

function tierValueProblem(raw: any, emptyMessage: string): string | null {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return 'Each tier needs a number.';
    return raw.every((cell) => isNumericCell(cell)) ? null : 'Each tier needs a number.';
  }
  if (typeof raw === 'number') return Number.isFinite(raw) ? null : 'Needs a number.';
  return asText(raw).trim() === '' ? emptyMessage : null;
}

function isValueRowShaped(entry: unknown): entry is Record<string, unknown> {
  if (!isPlainObject(entry)) return false;
  return 'type' in entry && ('val' in entry || 'damage' in entry);
}

function findEmptyTypeRow(node: unknown, seen: Set<unknown> = new Set()): boolean {
  if (node === null || typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const entry of node) {
      if (isValueRowShaped(entry) && asText((entry as any).type).trim() === '') return true;
      if (findEmptyTypeRow(entry, seen)) return true;
    }
    return false;
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    if (findEmptyTypeRow(value, seen)) return true;
  }
  return false;
}

function rowTypeProblem(item: any): string | null {
  return findEmptyTypeRow(item) ? 'A damage or range row is missing its type.' : null;
}

function fieldProblems(cat: string, item: any): Map<string, string> {
  const problems = new Map<string, string>();
  if (item === null || typeof item !== 'object') return problems;

  if (validateItem(cat, item) === 'missing-id') problems.set('id', 'Needs an ID.');

  const rowIssue = rowTypeProblem(item);
  if (rowIssue !== null) problems.set('rows', rowIssue);

  const layout = layoutFor(cat);
  if (layout === null) return problems;

  const identityKey = identityFieldFor(cat);
  if (asText(item[identityKey]).trim() === '') {
    problems.set(identityKey, `Needs a ${humanizeKey(identityKey).toLowerCase()}.`);
  }

  const id = asText(item.id);
  if (id !== '' && idIsTaken(cat, id, item)) problems.set('id', 'ID already used in this pack.');
  else if (/\s/.test(id)) problems.set('id', 'IDs cannot contain spaces.');

  const tieredCat = cat === 'npc_features.json';
  const rowsProblem = (list: any[], emptyMessage: string, typeMessage: string): string | null => {
    for (const entry of list) {
      if (!isPlainObject(entry)) return 'Each row needs a type and a value.';
      const problem = tierValueProblem(entry[rowValueKey(entry)], tieredCat ? 'Needs a number or three tier values.' : emptyMessage);
      if (problem !== null) return problem;
    }
    if (list.some((entry: any) => asText(entry.type).trim() === '')) return typeMessage;
    return null;
  };

  for (const key of ['damage', 'added_damage']) {
    const list = item[key];
    if (!Array.isArray(list) || list.length === 0) continue;
    const problem = rowsProblem(list, 'Every damage row needs a value like 2d6.', 'Pick a damage type.');
    if (problem !== null) problems.set(key, problem);
  }

  for (const key of ['range', 'added_range']) {
    const list = item[key];
    if (!Array.isArray(list) || list.length === 0) continue;
    const problem = rowsProblem(list, 'Every range row needs a number.', 'Pick a range type.');
    if (problem !== null) problems.set(key, problem);
  }

  for (const key of ['accuracy', 'attack_bonus']) {
    if (item[key] === undefined) continue;
    const problem = tierValueProblem(item[key], 'Needs a number or three tier values.');
    if (problem !== null) problems.set(key, problem);
  }

  const level = item.license_level;
  if (
    level !== undefined &&
    level !== '' &&
    (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 3)
  ) {
    problems.set('license_level', 'License level runs 0 to 3.');
  }

  const sp = item.sp;
  if (sp !== undefined && (typeof sp !== 'number' || !Number.isFinite(sp) || sp < 0)) {
    problems.set('sp', 'SP cannot be negative.');
  }

  if (cat === 'talents.json' && Array.isArray(item.ranks) && item.ranks.length === 0) {
    problems.set('ranks', 'A talent needs at least one rank.');
  }

  if (cat === 'npc_classes.json') {
    const stats = item.stats;
    if (isPlainObject(stats)) {
      const gap = Object.values(stats).some(
        (raw) => Array.isArray(raw) && raw.some((cell) => cell === '' || cell === null),
      );
      if (gap) problems.set('stats', 'Every tier needs a number.');
    }
  }

  if (cat === EIDOLON_LAYERS) {
    if (asText(item.rules).trim() === '') problems.set('rules', 'Needs rules text.');
    const shards = item.shards;
    if (isPlainObject(shards)) {
      const count = (shards as any).count;
      if (count !== undefined && countText(count).trim() === '') problems.set('shards', 'Shards need a count.');
    }
    const features = item.features;
    if (Array.isArray(features)) {
      const seen = new Set<string>();
      let problem: string | null = null;
      for (const feature of features) {
        if (!isPlainObject(feature)) {
          problem = 'Every feature needs a name and an id.';
          break;
        }
        const name = asText((feature as any).name).trim();
        const featureId = asText((feature as any).id).trim();
        if (name === '' || featureId === '') {
          problem = 'Every feature needs a name and an id.';
          break;
        }
        if (seen.has(featureId)) {
          problem = `Two features share the id ${featureId}.`;
          break;
        }
        seen.add(featureId);
      }
      if (problem !== null) problems.set('features', problem);
    }
  }

  if (cat === 'npc_features.json') {
    const orphan = featureOriginProblem(item);
    if (orphan !== null) problems.set('origin', orphan);
  }

  if (cat === 'npc_classes.json' || cat === 'npc_templates.json') {
    const linked = ['base_features', 'optional_features'].filter((key) => {
      const list = item[key];
      return Array.isArray(list) && list.length > 0;
    });
    const lookup = linked.length === 0 ? null : refLookup('npc_features.json');
    for (const key of linked) {
      const missing = (item[key] as any[])
        .map((entry: any) => refIdOf(entry))
        .filter((id: string) => id !== '' && lookup!(id) === undefined);
      if (missing.length > 0) problems.set(key, `No feature with id ${missing.slice(0, 2).join(', ')}.`);
    }
  }

  return problems;
}

export function itemProblemSummary(cat: string, item: any): string {
  return Array.from(fieldProblems(cat, item).values()).join('; ');
}

export function refreshFieldProblems() {
  const form = document.getElementById('designed-form');
  if (form === null || currentCategory === null) return;
  for (const node of Array.from(form.querySelectorAll('.field-error'))) {
    node.textContent = '';
    node.classList.add('hidden');
  }
  for (const node of Array.from(form.querySelectorAll('.field.has-error'))) node.classList.remove('has-error');
  const banner = document.getElementById('form-error')!;
  banner.textContent = '';
  banner.classList.add('hidden');

  const item = currentTarget();
  if (item === undefined) return;
  const problems = fieldProblems(currentCategory, item);
  const loose: string[] = [];
  for (const [key, message] of problems) {
    const field = key === '*' ? null : form.querySelector(`.field[data-field="${key}"]`);
    if (!(field instanceof HTMLElement)) {
      loose.push(message);
      continue;
    }
    const slot = field.querySelector('.field-error');
    if (slot instanceof HTMLElement) {
      slot.textContent = message;
      slot.classList.remove('hidden');
    }
    field.classList.add('has-error');
  }
  if (loose.length > 0) {
    banner.textContent = loose.join(' ');
    banner.classList.remove('hidden');
  }
}
