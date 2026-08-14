import { isPlainObject, packSaveTimer, refreshTagLabels, regenerateNpcFeatureArrays } from './forms.js';
import { switchTab, PartInfo, TagDef, ItemRef, harvestDraftItemRefs, harvestDraftObjectKeys, harvestDraftParts, harvestTagDefs, hidePackSearch, isListCategory, itemAt, refreshEidolonCreatorButton, refreshEidolonVisibility, renderEditorRail, renderMasterList, renderPackSearch, renderPartsStrip, setItemRefs, setLibraryDrafts, setObjectKeys, setPartsCatalog, setTagDefs, updateDataAt, validateCurrentPack } from './ui.js';
import { setConvertPlan } from './io.js';
import { ensureEidolonData } from './eidolon.js';

const REFERENCE_DEFAULTS: Record<string, string[]> = {
  mounts: [],
  weaponTypes: [],
  damageTypes: [],
  rangeTypes: [],
  systemTypes: [],
  mechTypes: [],
  featureTypes: [],
  activations: [],
  statusTypes: [],
  reserveTypes: [],
  gearTypes: [],
  npcRoles: [],
  memeticTypes: [],
  tagIds: [],
  sources: [],
  licenses: [],
  bonusIds: [],
  statusIds: [],
  synergyLocations: [],
};

export const REFERENCE_DATALIST_IDS: Record<string, string> = {
  tagIds: 'dl-ref-tag-ids',
  sources: 'dl-ref-sources',
  licenses: 'dl-ref-licenses',
  mounts: 'dl-ref-mounts',
  weaponTypes: 'dl-ref-weapon-types',
  damageTypes: 'dl-ref-damage-types',
  rangeTypes: 'dl-ref-range-types',
  bonusIds: 'dl-ref-bonus-ids',
  systemTypes: 'dl-ref-system-types',
  mechTypes: 'dl-ref-mech-types',
  featureTypes: 'dl-ref-feature-types',
  activations: 'dl-ref-activations',
  statusTypes: 'dl-ref-status-types',
  reserveTypes: 'dl-ref-reserve-types',
  gearTypes: 'dl-ref-gear-types',
  npcRoles: 'dl-ref-npc-roles',
  memeticTypes: 'dl-ref-memetic-types',
  statusIds: 'dl-ref-status-ids',
};

export let referenceIndex: Record<string, string[]> = { ...REFERENCE_DEFAULTS };
let referenceRefreshTimer: number | undefined;

function addReference(bucket: Set<string>, value: unknown) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed) bucket.add(trimmed);
}

export function dedupeVocab(values: Iterable<string>): string[] {
  const groups = new Map<string, string>();
  for (const raw of values) {
    const groupKey = raw.toLowerCase();
    const existing = groups.get(groupKey);
    if (existing === undefined || raw < existing) groups.set(groupKey, raw);
  }
  return Array.from(groups.values()).sort((a, b) => a.localeCompare(b));
}

function harvestDraftReferences(draft: PackDraft, buckets: Record<string, Set<string>>) {
  const data = draft.data;

  const tags = data['tags.json'];
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (!tag || typeof tag !== 'object') continue;
      addReference(buckets.tagIds!, (tag as any).id);
    }
  }

  for (const cat of Object.keys(data)) {
    const items = data[cat];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as any;
      addReference(buckets.sources!, entry.source);
      addReference(buckets.licenses!, entry.license);
      if (cat === 'weapons.json') {
        addReference(buckets.mounts!, entry.mount);
        addReference(buckets.weaponTypes!, entry.type);
      }
      if (cat === 'systems.json') addReference(buckets.systemTypes!, entry.type);
      if (cat === 'npc_features.json') addReference(buckets.featureTypes!, entry.type);
      if (cat === 'actions.json') {
        addReference(buckets.activations!, entry.activation);
        addReference(buckets.activations!, entry.action_type);
      }
      if (cat === 'statuses.json') {
        addReference(buckets.statusTypes!, entry.type);
        addReference(buckets.statusIds!, entry.id);
      }
      if (cat === 'reserves.json') addReference(buckets.reserveTypes!, entry.type);
      if (cat === 'pilot_gear.json') addReference(buckets.gearTypes!, entry.type);
      if (cat === 'npc_classes.json') addReference(buckets.npcRoles!, entry.role);
      if (cat === EIDOLON_LAYERS) {
        const shardFeatures = entry.shards !== null && typeof entry.shards === 'object' ? (entry.shards as any).features : undefined;
        for (const list of [entry.features, shardFeatures]) {
          if (!Array.isArray(list)) continue;
          for (const feature of list) {
            if (!feature || typeof feature !== 'object') continue;
            addReference(buckets.memeticTypes!, (feature as any).weapon_type);
            addReference(buckets.featureTypes!, (feature as any).type);
            if (Array.isArray((feature as any).damage)) {
              for (const part of (feature as any).damage) {
                if (part && typeof part === 'object') addReference(buckets.damageTypes!, (part as any).type);
              }
            }
            if (Array.isArray((feature as any).range)) {
              for (const part of (feature as any).range) {
                if (part && typeof part === 'object') addReference(buckets.rangeTypes!, (part as any).type);
              }
            }
            if (Array.isArray((feature as any).actions)) {
              for (const action of (feature as any).actions) {
                if (action && typeof action === 'object') addReference(buckets.activations!, (action as any).activation);
              }
            }
          }
        }
      }
      if (cat === 'frames.json') {
        if (Array.isArray(entry.mounts)) for (const mount of entry.mounts) addReference(buckets.mounts!, mount);
        if (Array.isArray(entry.mechtype)) for (const kind of entry.mechtype) addReference(buckets.mechTypes!, kind);
      }
      if (Array.isArray(entry.damage)) {
        for (const part of entry.damage) {
          if (part && typeof part === 'object') addReference(buckets.damageTypes!, (part as any).type);
        }
      }
      if (Array.isArray(entry.range)) {
        for (const part of entry.range) {
          if (part && typeof part === 'object') addReference(buckets.rangeTypes!, (part as any).type);
        }
      }
      if (Array.isArray(entry.tags)) {
        for (const tag of entry.tags) {
          if (tag && typeof tag === 'object') addReference(buckets.tagIds!, (tag as any).id);
        }
      }
      if (Array.isArray(entry.actions)) {
        for (const action of entry.actions) {
          if (action && typeof action === 'object') addReference(buckets.activations!, (action as any).activation);
        }
      }
      if (Array.isArray(entry.profiles)) {
        for (const profile of entry.profiles) {
          if (!profile || typeof profile !== 'object') continue;
          if (Array.isArray((profile as any).damage)) {
            for (const part of (profile as any).damage) {
              if (part && typeof part === 'object') addReference(buckets.damageTypes!, (part as any).type);
            }
          }
          if (Array.isArray((profile as any).range)) {
            for (const part of (profile as any).range) {
              if (part && typeof part === 'object') addReference(buckets.rangeTypes!, (part as any).type);
            }
          }
          if (Array.isArray((profile as any).tags)) {
            for (const tag of (profile as any).tags) {
              if (tag && typeof tag === 'object') addReference(buckets.tagIds!, (tag as any).id);
            }
          }
        }
      }
      if (Array.isArray(entry.synergies)) {
        for (const synergy of entry.synergies) {
          if (!synergy || typeof synergy !== 'object' || !Array.isArray((synergy as any).locations)) continue;
          for (const location of (synergy as any).locations) addReference(buckets.synergyLocations!, location);
        }
      }
      const bonusSources = [entry, entry.core_system, ...(Array.isArray(entry.traits) ? entry.traits : [])];
      for (const source of bonusSources) {
        if (!source || typeof source !== 'object' || !Array.isArray((source as any).bonuses)) continue;
        for (const bonus of (source as any).bonuses) {
          if (bonus && typeof bonus === 'object') addReference(buckets.bonusIds!, (bonus as any).id);
        }
      }
    }
  }
}

export async function buildReferenceIndex() {
  const buckets: Record<string, Set<string>> = {};
  for (const key of Object.keys(REFERENCE_DEFAULTS)) {
    buckets[key] = new Set(REFERENCE_DEFAULTS[key]);
  }

  let drafts: PackDraft[] = [];
  try {
    drafts = await getDrafts();
  } catch (e) {
    drafts = [];
  }
  const catalog = new Map<string, Map<string, PartInfo>>();
  const defs = new Map<string, TagDef>();
  const refs = new Map<string, Map<string, ItemRef>>();
  const keyStore = new Map<string, Map<string, Map<string, number>>>();
  const harvested = new Set<string>();
  const harvest = (draft: PackDraft) => {
    try {
      harvestDraftReferences(draft, buckets);
      harvestDraftParts(draft, catalog);
      harvestTagDefs(draft, defs);
      harvestDraftItemRefs(draft, refs);
      harvestDraftObjectKeys(draft, keyStore);
      harvested.add(draft.id);
    } catch (e) {
      console.error(`Skipped unreadable draft while indexing: ${draft?.id ?? 'unknown'}`);
    }
  };

  setLibraryDrafts(drafts);
  const eidolonInstalled = [currentPack, ...drafts].some((draft) => {
    if (draft === null) return false;
    const layers = draft.data[EIDOLON_LAYERS];
    return Array.isArray(layers) && layers.some((entry) => entry !== null && typeof entry === 'object');
  });
  if (eidolonInstalled) {
    try {
      await ensureEidolonData();
    } catch {}
  }
  for (const draft of drafts) {
    harvest(currentPack && draft.id === currentPack.id ? currentPack : draft);
  }
  if (currentPack && !harvested.has(currentPack.id)) harvest(currentPack);
  setPartsCatalog(catalog);
  setTagDefs(defs);
  setItemRefs(refs);
  setObjectKeys(keyStore);

  const next: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(buckets)) {
    next[key] = dedupeVocab(values);
  }
  referenceIndex = next;
  renderReferenceDatalists();
  renderPartsStrip();
  refreshTagLabels();
  refreshEidolonVisibility();
}

export async function freshReferenceIndex() {
  if (packSaveTimer === undefined && referenceRefreshTimer === undefined) return;
  if (referenceRefreshTimer !== undefined) {
    clearTimeout(referenceRefreshTimer);
    referenceRefreshTimer = undefined;
  }
  await buildReferenceIndex();
}

function scheduleReferenceIndexRefresh() {
  if (referenceRefreshTimer !== undefined) clearTimeout(referenceRefreshTimer);
  referenceRefreshTimer = setTimeout(() => {
    referenceRefreshTimer = undefined;
    void buildReferenceIndex();
  }, 600) as unknown as number;
}

interface OptionSpec {
  value: string;
  label?: string;
  selected?: boolean;
}

export function fillOptions(host: HTMLElement, options: OptionSpec[]) {
  for (const entry of options) {
    const option = document.createElement('option');
    option.value = entry.value;
    if (entry.label !== undefined) option.innerText = entry.label;
    if (entry.selected === true) option.selected = true;
    host.appendChild(option);
  }
}

function renderReferenceDatalists() {
  const host = document.getElementById('reference-datalists')!;
  host.innerHTML = '';
  for (const [key, listId] of Object.entries(REFERENCE_DATALIST_IDS)) {
    const list = document.createElement('datalist');
    list.id = listId;
    fillOptions(list, (referenceIndex[key] ?? []).map((value) => ({ value })));
    host.appendChild(list);
  }
}

export function suggestionListFor(path: (string | number)[], key: string): string | null {
  const parent = path.length >= 2 ? path[path.length - 2] : undefined;
  const container = typeof parent === 'string' ? parent : undefined;
  if (key === 'id' && container === 'tags') return REFERENCE_DATALIST_IDS.tagIds!;
  if (key === 'source') return REFERENCE_DATALIST_IDS.sources!;
  if (key === 'mount') return REFERENCE_DATALIST_IDS.mounts!;
  if (key === 'type') {
    if (container === 'damage') return REFERENCE_DATALIST_IDS.damageTypes!;
    if (container === 'range') return REFERENCE_DATALIST_IDS.rangeTypes!;
    if (currentCategory === 'weapons.json') return REFERENCE_DATALIST_IDS.weaponTypes!;
  }
  return null;
}

export const V2_CLASS_POWER = 100;
export const V2_TEMPLATE_POWER = 20;

function newV2ItemFor(cat: string, id: string): any {
  const tierTriple = (value: number) => [value, value, value];
  switch (cat) {
    case 'npc_classes.json':
      return {
        id,
        name: 'New NPC Class',
        role: 'striker',
        info: { flavor: '', tactics: '' },
        stats: {
          armor: tierTriple(0),
          hp: [8, 10, 12],
          evade: [8, 9, 10],
          edef: tierTriple(8),
          heatcap: tierTriple(5),
          speed: tierTriple(4),
          sensor: tierTriple(10),
          save: [10, 11, 12],
          hull: tierTriple(0),
          agility: tierTriple(0),
          systems: tierTriple(0),
          engineering: tierTriple(0),
          size: [[1], [1], [1]],
          activations: tierTriple(1),
        },
        base_features: [],
        optional_features: [],
        power: V2_CLASS_POWER,
      };
    case 'npc_templates.json':
      return {
        id,
        name: 'New NPC Template',
        description: '',
        base_features: [],
        optional_features: [],
        power: V2_TEMPLATE_POWER,
      };
    case 'npc_features.json':
      return {
        id,
        name: 'New NPC Feature',
        origin: { type: 'Class', name: '', base: true },
        locked: false,
        type: 'Trait',
        effect: '',
        tags: [],
      };
    default:
      return null;
  }
}

export function newItemFor(cat: string, format: PackFormat = currentFormat()): any {
  const id = `new_${Date.now()}`;
  const tierTriple = (value: number) => [value, value, value];
  if (format === 'v2') {
    const v2 = newV2ItemFor(cat, id);
    if (v2 !== null) return v2;
  }
  switch (cat) {
    case 'frames.json':
      return { id, name: 'New Frame', source: '', description: '', mechtype: ['Balanced'], stats: { size: 1, ...(format === 'v2' ? {} : { structure: 4, stress: 4 }), armor: 0, hp: 8, evasion: 8, edef: 8, heatcap: 5, repcap: 5, sensor_range: 10, tech_attack: 0, save: 10, speed: 4, sp: 6 }, traits: [], mounts: ['Main'], core_system: { name: 'New Core System', description: '', active_name: '', active_effect: '' } };
    case 'weapons.json':
      return { id, name: 'New Weapon', source: '', license: '', license_level: 1, mount: 'Main', type: 'Rifle', damage: [{ type: 'Kinetic', val: '1d6' }], range: [{ type: 'Range', val: 10 }], effect: '' };
    case 'systems.json':
      return { id, name: 'New System', source: '', license: '', license_level: 1, sp: 1, effect: '' };
    case 'mods.json':
      return { id, name: 'New Mod', source: '', license: '', license_level: 1, sp: 1, effect: '', allowed_types: ['Rifle'] };
    case 'core_bonuses.json':
      return { id, name: 'New Core Bonus', source: '', description: '', effect: '' };
    case 'talents.json':
      return { id, name: 'New Talent', icon: '', terse: '', description: '', ranks: [{ name: 'Rank I', description: '' }, { name: 'Rank II', description: '' }, { name: 'Rank III', description: '' }] };
    case 'actions.json':
      return { id, name: 'New Action', activation: 'Quick', terse: '', detail: '' };
    case 'statuses.json':
      return { id, name: 'NEW STATUS', type: 'Status', terse: '', effects: '' };
    case 'tags.json':
      return { id: `tg_new_${Date.now()}`, name: 'New Tag', description: '' };
    case 'reserves.json':
      return { id, name: 'New Reserve', type: 'Tactical', label: '', description: '', resource_name: '', resource_note: '', resource_cost: '', consumable: false };
    case 'pilot_gear.json':
      return { id, name: 'New Pilot Gear', type: 'Gear', description: '' };
    case 'npc_classes.json':
      return {
        id,
        name: 'New NPC Class',
        role: 'striker',
        info: { flavor: '', tactics: '' },
        stats: {
          hp: [8, 10, 12],
          heatcap: tierTriple(5),
          structure: tierTriple(1),
          stress: tierTriple(1),
          armor: tierTriple(0),
          evade: [8, 9, 10],
          edef: tierTriple(8),
          speed: tierTriple(4),
          sensor: tierTriple(10),
          save: [10, 11, 12],
          hull: tierTriple(0),
          agility: tierTriple(0),
          systems: tierTriple(0),
          engineering: tierTriple(0),
          size: 1,
          activations: tierTriple(1),
        },
        base_features: [],
        optional_features: [],
      };
    case 'npc_templates.json':
      return { id, name: 'New NPC Template', template: true, description: '', base_features: [], optional_features: [] };
    case 'npc_features.json':
      return { id, name: 'New NPC Feature', origin: '', base: true, type: 'Trait', effect: '' };
    case EIDOLON_LAYERS:
      return {
        id,
        name: 'New Eidolon Layer',
        appearance: '',
        hints: '',
        rules: '',
        features: [],
        shards: { count: 4, detail: '' },
      };
    case 'environments.json':
      return { id, name: 'New Environment', description: '' };
    case 'glossary.json':
      return { name: 'New Entry', description: '' };
    case 'manufacturers.json':
      return format === 'v2'
        ? { id, name: 'New Manufacturer', logo: '', color: '', quote: '', description: '' }
        : { id, name: 'New Manufacturer', logo: '', light: '', dark: '', quote: '', description: '' };
    case 'sitreps.json':
      return { id, name: 'New Sitrep', description: '', pcVictory: '', enemyVictory: '' };
    case 'skills.json':
      return { id, name: 'New Skill', description: '', detail: '', family: '' };
    case 'backgrounds.json':
      return { id, name: 'New Background', description: '' };
    case 'bonds.json':
      return { id, name: 'New Bond', major_ideals: [], minor_ideals: [], questions: [], powers: [] };
    case 'tables.json':
      return { id, title: 'New Table', description: '', die: 6, results: [] };
    case 'downtime_actions.json':
      return { id, name: 'New Downtime Action', terse: '', detail: '' };
    default:
      return { id, name: 'New Item' };
  }
}

export type PackData = Record<string, any>;

export interface PackDraft {
  id: string;
  name: string;
  version: string;
  author: string;
  format?: PackFormat;
  data: PackData;
}

export interface DiscoveredPack {
  dir: string;
  data: PackData;
}

export interface PackSearchHit {
  cat: string;
  idx: number;
  label: string;
  key: string;
  field: string;
  snippet: string;
}

export const EIDOLON_LAYERS = 'eidolon_layers.json';

const ID_REQUIRED_CATEGORIES = new Set([
  'weapons.json',
  'systems.json',
  'mods.json',
  'core_bonuses.json',
  'frames.json',
  'talents.json',
  'npc_classes.json',
  'npc_templates.json',
  'npc_features.json',
  EIDOLON_LAYERS,
]);

// only checks ids now. old normalizer did more, nothing read it
export type ItemProblem = 'missing-id';

export function validateItem(cat: string, item: any): ItemProblem | null {
  if (!ID_REQUIRED_CATEGORIES.has(cat)) return null;
  const id = item?.id;
  return typeof id === 'string' && id !== '' ? null : 'missing-id';
}

export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const OPEN_DRAFT_KEY = 'lcp-editor:open-draft';

export function setPackTabsEnabled(enabled: boolean) {
  for (const id of ['tab-editor', 'tab-export']) {
    (document.getElementById(id) as HTMLButtonElement).disabled = !enabled;
  }
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

function readOpenDraftId(): string | null {
  return readStored(OPEN_DRAFT_KEY);
}

function rememberOpenDraft(id: string) {
  writeStored(OPEN_DRAFT_KEY, id);
}

export function forgetOpenDraft() {
  writeStored(OPEN_DRAFT_KEY, null);
}

function forgetOpenDraftIf(id: string) {
  if (readOpenDraftId() === id) forgetOpenDraft();
}

const RAIL_COLLAPSED_KEY = 'lcp-editor:rail-collapsed';
const MASTER_COLLAPSED_KEY = 'lcp-editor:master-collapsed';

function readPanelCollapsed(key: string): boolean {
  return readStored(key) === '1';
}

function writePanelCollapsed(key: string, collapsed: boolean) {
  writeStored(key, collapsed ? '1' : null);
}

export function categoryTitle(cat: string): string {
  return cat.replace('.json', '').replace(/_/g, ' ').toUpperCase();
}

export type PackFormat = 'v2' | 'v3';

export const PACK_MANIFEST = 'lcp_manifest.json';

export function formatOfManifest(manifest: unknown): PackFormat {
  if (!isPlainObject(manifest)) return 'v3';
  return (manifest as { v3?: unknown }).v3 === true ? 'v3' : 'v2';
}

export function manifestIsDecisive(manifest: unknown): boolean {
  if (manifest === undefined) return false;
  if (!isPlainObject(manifest)) return true;
  return 'v3' in (manifest as object);
}

export function packFormatOf(pack: PackDraft | null): PackFormat {
  if (pack === null) return 'v3';
  const manifest = pack.data[PACK_MANIFEST];
  const explicit = pack.format === 'v2' || pack.format === 'v3' ? pack.format : undefined;
  if (manifest !== undefined && manifest !== null) {
    if (manifestIsDecisive(manifest)) return formatOfManifest(manifest);
    if (explicit !== undefined) return explicit;
    return formatOfManifest(manifest);
  }
  return explicit ?? 'v3';
}

export function currentFormat(): PackFormat {
  return packFormatOf(currentPack);
}

function formatTag(format: PackFormat): string {
  return `<span class="tag-format tag-${format}">${format}</span>`;
}

export function stampFormat(manifest: PackData, format: PackFormat): PackData {
  if (format === 'v3') manifest['v3'] = true;
  return manifest;
}

let db: IDBDatabase;
export let currentPack: PackDraft | null = null;
export let currentCategory: string | null = null;
export let currentItemIndex: number | null = null;

export function setCurrentPack(value: PackDraft | null) {
  currentPack = value;
}

export function setCurrentCategory(value: string | null) {
  currentCategory = value;
}

export function setCurrentItemIndex(value: number | null) {
  currentItemIndex = value;
}

export const CATEGORIES = [
  'lcp_manifest.json',
  'actions.json',
  'core_bonuses.json',
  'frames.json',
  'mods.json',
  'npc_classes.json',
  'npc_features.json',
  'npc_templates.json',
  'pilot_gear.json',
  'reserves.json',
  'statuses.json',
  'systems.json',
  'tags.json',
  'talents.json',
  'weapons.json',
  'eidolon_layers.json',
];

export const MAX_ARCHIVE_DEPTH = 4; // nested .lcp inside .lcp inside...

export const PACK_ARRAY_FILES = new Set<string>([
  ...CATEGORIES.filter((cat) => cat !== 'lcp_manifest.json'),
  'backgrounds.json',
  'bonds.json',
  'environments.json',
  'glossary.json',
  'manufacturers.json',
  'quirks.json',
  'rules.json',
  'sitreps.json',
  'skills.json',
  'tables.json',
  // nothing ships this, but homebrew mod splitters need it read as a list, not an npc file
  'weapon_mods.json',
]);

export async function initDB() {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('LcpEditorDB', 1);
    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains('drafts')) {
        database.createObjectStore('drafts', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      db = req.result;
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getDrafts(): Promise<PackDraft[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readonly');
    const req = tx.objectStore('drafts').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDraft(draft: PackDraft): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    tx.objectStore('drafts').put(draft);
    tx.oncomplete = () => {
      scheduleReferenceIndexRefresh();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteDraft(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    tx.objectStore('drafts').delete(id);
    tx.oncomplete = () => {
      scheduleReferenceIndexRefresh();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export function persistDraft(draft: PackDraft) {
  void saveDraft(draft).catch(() => {
    showToast('Save failed');
  });
}

export async function saveDraftOrToast(draft: PackDraft): Promise<boolean> {
  try {
    await saveDraft(draft);
    return true;
  } catch (e) {
    showToast('Save failed');
    return false;
  }
}

async function deleteDraftOrToast(id: string): Promise<boolean> {
  try {
    await deleteDraft(id);
    return true;
  } catch (e) {
    showToast('Delete failed');
    return false;
  }
}

interface PanelToggle {
  panelId: string;
  toggleId: string;
  key: string;
  expandLabel: string;
  collapseLabel: string;
}

const PANEL_TOGGLES: PanelToggle[] = [
  {
    panelId: 'editor-sidebar',
    toggleId: 'btn-toggle-rail',
    key: RAIL_COLLAPSED_KEY,
    expandLabel: 'Expand category list',
    collapseLabel: 'Collapse category list',
  },
  {
    panelId: 'master-list-pane',
    toggleId: 'btn-toggle-master',
    key: MASTER_COLLAPSED_KEY,
    expandLabel: 'Expand item list',
    collapseLabel: 'Collapse item list',
  },
];

function applyPanelCollapsed(toggle: PanelToggle, collapsed: boolean) {
  const panel = document.getElementById(toggle.panelId)!;
  const btn = document.getElementById(toggle.toggleId)!;
  panel.classList.toggle('collapsed', collapsed);
  btn.setAttribute('aria-expanded', String(!collapsed));
  btn.setAttribute('aria-label', collapsed ? toggle.expandLabel : toggle.collapseLabel);
}

export function wirePanelToggles() {
  for (const toggle of PANEL_TOGGLES) {
    const btn = document.getElementById(toggle.toggleId)!;
    let collapsed = readPanelCollapsed(toggle.key);
    applyPanelCollapsed(toggle, collapsed);
    btn.addEventListener('click', () => {
      collapsed = !collapsed;
      writePanelCollapsed(toggle.key, collapsed);
      applyPanelCollapsed(toggle, collapsed);
    });
  }
}

export let isJsonMode = false;
export let jsonDirty = false;

export function setJsonDirty(value: boolean) {
  jsonDirty = value;
}

export async function confirmDiscardJsonEdits(): Promise<boolean> {
  if (!isJsonMode || !jsonDirty) return true;
  const ok = await customConfirm('Discard JSON edits?');
  if (ok) jsonDirty = false;
  return ok;
}

function jsonTarget(): { data: any; path: (string | number)[] } | null {
  if (!currentPack || !currentCategory) return null;
  if (!isListCategory(currentCategory)) {
    const data = currentPack.data[currentCategory];
    return data === undefined ? null : { data, path: [] };
  }
  if (currentItemIndex === null) return null;
  const data = itemAt(currentCategory, currentItemIndex);
  return data === undefined ? null : { data, path: [currentItemIndex] };
}

export function syncJsonTextarea() {
  const area = document.getElementById('json-textarea') as HTMLTextAreaElement;
  const target = jsonTarget();
  area.value = target === null ? '' : JSON.stringify(target.data, null, 2);
}

export function applyJsonEdit(): boolean {
  const target = jsonTarget();
  if (target === null || !currentPack) {
    showToast('Select an item first');
    return false;
  }
  try {
    const val = (document.getElementById('json-textarea') as HTMLTextAreaElement).value;
    const parsed = JSON.parse(val);
    jsonDirty = false;
    updateDataAt(target.path, parsed);
    regenerateNpcFeatureArrays(currentPack);
    persistDraft(currentPack);
    validateCurrentPack();
    showToast('JSON saved');
    return true;
  } catch (e: any) {
    showToast('JSON Parse Error: ' + e.message);
    return false;
  }
}

export let itemValidationErrors = new Map<string, string>();
export let masterSearchQuery = '';
export let packSearchQuery = '';

export function setMasterSearchQuery(value: string) {
  masterSearchQuery = value;
}

export function setPackSearchQuery(value: string) {
  packSearchQuery = value;
}

export const SEARCH_RESULT_CAP = 50; // the panel scrolls forever past this
export const SEARCH_MIN_QUERY = 2; // 1 char matches half the pack

export const REF_WALK_DEPTH = 9; // has to reach the bottom or refs rot quietly
export const DISPLAY_WALK_DEPTH = 6; // preview/search/parts, just a budget
// export const SEARCH_MAX_DEPTH = 4;

export function renderLibrary() {
  refreshEidolonCreatorButton();

  getDrafts().then((drafts) => {
    const localDraftsEl = document.getElementById('local-drafts')!;
    localDraftsEl.innerHTML = drafts.length ? '' : 'No drafts found.';
    drafts.forEach((draft) => {
      const div = document.createElement('div');
      div.className = 'library-list-row';
      div.innerHTML = `
        <div class="row-info">
          <h3>${esc(draft.name)}</h3>
          <div class="row-meta">
            <span class="version">${esc(draft.version)}</span>
            <span class="author">${esc(draft.author)}</span>
            ${formatTag(packFormatOf(draft))}
          </div>
        </div>
        <div class="row-actions">
          <button class="btn-open">Open</button>
          <button class="danger btn-delete">Delete</button>
        </div>
      `;
      const closeIfOpen = () => {
        forgetOpenDraftIf(draft.id);
        if (currentPack && currentPack.id === draft.id) {
          setCurrentPack(null);
          setCurrentCategory(null);
          setCurrentItemIndex(null);
          setPackTabsEnabled(false);
          switchTab('library');
        }
      };
      div.querySelector('.btn-open')!.addEventListener('click', () => openDraft(draft));
      div.querySelector('.btn-delete')!.addEventListener('click', async () => {
        if (!(await customConfirm('Delete this draft?'))) return;
        if (!(await deleteDraftOrToast(draft.id))) return;
        closeIfOpen();
        renderLibrary();
      });
      localDraftsEl.appendChild(div);
    });
  });
}

export function wireWorkspaceControls() {
  document.getElementById('master-search-input')!.addEventListener('input', (e) => {
    masterSearchQuery = (e.target as HTMLInputElement).value;
    renderMasterList();
  });

  const packSearchInput = document.getElementById('pack-search-input') as HTMLInputElement;
  packSearchInput.addEventListener('input', (e) => {
    packSearchQuery = (e.target as HTMLInputElement).value;
    renderPackSearch();
  });
  packSearchInput.addEventListener('focus', () => {
    if (packSearchQuery.trim().length >= SEARCH_MIN_QUERY) renderPackSearch();
  });
  packSearchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    hidePackSearch();
    packSearchInput.blur();
  });
  packSearchInput.addEventListener('blur', () => {
    setTimeout(hidePackSearch, 150);
  });
  document.getElementById('pack-search-results')!.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  document.getElementById('btn-toggle-json')!.addEventListener('click', async () => {
    if (!(await confirmDiscardJsonEdits())) return;
    isJsonMode = !isJsonMode;
    document.getElementById('form-container')!.classList.toggle('hidden', isJsonMode);
    document.getElementById('json-container')!.classList.toggle('hidden', !isJsonMode);
    renderPartsStrip();
    if (isJsonMode) syncJsonTextarea();
  });

  document.getElementById('btn-save-json')!.addEventListener('click', applyJsonEdit);
  
  document.getElementById('json-textarea')!.addEventListener('input', () => {
    jsonDirty = true;
  });

  document.getElementById('json-textarea')!.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      (document.getElementById('btn-save-json') as HTMLButtonElement).click();
    }
  });

}

function newPackDraft(format: PackFormat): PackDraft {
  return {
    id: `draft:new:${Date.now()}`,
    name: 'New Pack',
    version: '0.1.0',
    author: '',
    data: {
      [PACK_MANIFEST]: stampFormat(
        { name: 'New Pack', version: '0.1.0', author: '', description: '', item_prefix: 'NP' },
        format,
      ),
    },
  };
}

let newPackBusy = false;

export async function createNewPack(format: PackFormat): Promise<PackDraft | null> {
  if (newPackBusy) return null;
  newPackBusy = true;
  try {
    const draft = newPackDraft(format);
    const ok = await saveDraftOrToast(draft);
    if (!ok) return null;
    openDraft(draft);
    renderLibrary();
    return draft;
  } finally {
    newPackBusy = false;
  }
}

export function openDraft(draft: PackDraft, options: { restore?: boolean } = {}) {
  setCurrentPack(draft);
  setConvertPlan(null);
  isJsonMode = false;
  jsonDirty = false;
  document.getElementById('form-container')!.classList.remove('hidden');
  document.getElementById('json-container')!.classList.add('hidden');
  validateCurrentPack();

  setPackTabsEnabled(true);
  if (!options.restore) rememberOpenDraft(draft.id);

  renderEditorRail();
  if (!options.restore) switchTab('editor');
}

export async function restoreOpenDraft() {
  const id = readOpenDraftId();
  if (!id) return;
  const draft = await new Promise<PackDraft | undefined>((resolve) => {
    const req = db.transaction('drafts').objectStore('drafts').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
  if (!draft) {
    forgetOpenDraft();
    return;
  }
  openDraft(draft, { restore: true });
}

function acceptsEnter(target: EventTarget | null): boolean {
  return !(target instanceof HTMLTextAreaElement);
}

function modalKeys(onOk: () => void, onCancel: () => void): { attach: () => void; detach: () => void } {
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Enter' || !acceptsEnter(event.target)) return;
    event.preventDefault();
    onOk();
  };
  return {
    attach: () => document.addEventListener('keydown', onKey),
    detach: () => document.removeEventListener('keydown', onKey),
  };
}

export function showModal(id: string) {
  document.getElementById(id)!.classList.remove('hidden');
}

export function closeModal(id: string) {
  document.getElementById(id)!.classList.add('hidden');
}

interface ModalChoice<T> {
  button: string;
  value: () => T;
}

const modalBusy = new Set<string>();

function askModal<T>(
  id: string,
  choices: ModalChoice<T>[],
  options: { enter: string; focus: string; prepare?: () => void },
): Promise<T> {
  const cancel = choices[choices.length - 1];
  if (modalBusy.has(id)) return Promise.resolve(cancel.value());
  modalBusy.add(id);
  return new Promise<T>((resolve) => {
    const wired = choices.map((choice) => {
      const button = document.getElementById(choice.button)!;
      const run = () => {
        cleanup();
        resolve(choice.value());
      };
      return { button, run };
    });
    const cancel = wired[wired.length - 1];
    const enter = wired[choices.findIndex((choice) => choice.button === options.enter)] ?? cancel;
    const keys = modalKeys(enter.run, cancel.run);

    const cleanup = () => {
      modalBusy.delete(id);
      closeModal(id);
      keys.detach();
      for (const entry of wired) entry.button.removeEventListener('click', entry.run);
    };

    options.prepare?.();
    showModal(id);
    for (const entry of wired) entry.button.addEventListener('click', entry.run);
    keys.attach();
    (document.getElementById(options.focus) as HTMLElement).focus();
  });
}

export function customConfirm(message: string): Promise<boolean> {
  return askModal(
    'confirm-modal',
    [
      { button: 'btn-confirm-ok', value: () => true },
      { button: 'btn-confirm-cancel', value: () => false },
    ],
    {
      enter: 'btn-confirm-ok',
      focus: 'btn-confirm-ok',
      prepare: () => {
        document.getElementById('confirm-message')!.innerText = message;
      },
    },
  );
}

export function customPrompt(message: string, showTypeSelect = false, suggestions: string[] = []): Promise<{ value: string, type: string } | null> {
  const input = () => document.getElementById('prompt-input') as HTMLInputElement;
  const typeSelect = () => document.getElementById('prompt-type-select') as HTMLSelectElement;
  return askModal<{ value: string, type: string } | null>(
    'prompt-modal',
    [
      { button: 'btn-prompt-ok', value: () => ({ value: input().value, type: typeSelect().value }) },
      { button: 'btn-prompt-cancel', value: () => null },
    ],
    {
      enter: 'btn-prompt-ok',
      focus: 'prompt-input',
      prepare: () => {
        document.getElementById('prompt-message')!.innerText = message;
        const keyList = document.getElementById('dl-prompt-keys')!;
        keyList.innerHTML = '';
        fillOptions(keyList, suggestions.map((key) => ({ value: key })));
        input().value = '';
        document.getElementById('prompt-type-group')!.style.display = showTypeSelect ? 'block' : 'none';
        typeSelect().value = 'string';
      },
    },
  );
}

export function chooseFormat(): Promise<'v2' | 'v3' | null> {
  return askModal<'v2' | 'v3' | null>(
    'format-modal',
    [
      { button: 'btn-format-v2', value: () => 'v2' },
      { button: 'btn-format-v3', value: () => 'v3' },
      { button: 'btn-format-cancel', value: () => null },
    ],
    { enter: 'btn-format-v3', focus: 'btn-format-v3' },
  );
}

let toastTimer: number | undefined;

export function showToast(msg: string) {
  const toast = document.getElementById('error-toast')!;
  toast.innerText = msg;
  toast.classList.remove('hidden');
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastTimer = undefined;
    toast.classList.add('hidden');
  }, 3000) as unknown as number;
}
