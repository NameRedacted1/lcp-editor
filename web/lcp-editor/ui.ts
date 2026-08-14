import { currentPack, currentCategory, EIDOLON_LAYERS, PACK_ARRAY_FILES, CATEGORIES, PACK_MANIFEST, PackDraft, PackFormat, PackSearchHit, SEARCH_MIN_QUERY, SEARCH_RESULT_CAP, categoryTitle, closeModal, confirmDiscardJsonEdits, currentItemIndex, customConfirm, customPrompt, esc, freshReferenceIndex, isJsonMode, itemValidationErrors, jsonDirty, masterSearchQuery, packFormatOf, packSearchQuery, referenceIndex, renderLibrary, setCurrentCategory, setCurrentItemIndex, setJsonDirty, setMasterSearchQuery, setPackSearchQuery, setPackTabsEnabled, showModal, showToast, stampFormat, DISPLAY_WALK_DEPTH, suggestionListFor, syncJsonTextarea } from './state.js';
import { asText, flushPackSave, cloneOwnerFeatures, countText, isPlainObject, NPC_FEATURE_OWNER_FILES, currentTarget, derivedFeaturesFor, identityFieldFor, itemProblemSummary, layoutFor, ownerKeySnapshot, refreshFieldProblems, rehomeDependentFeatures, renderDesignedForm, resetPendingSlots, rowValueKey, slugifyName, tagDefFor, tagIdOf, uniqueAutoId, withValidationPass } from './forms.js';
import { renderConvertReport, renderExportPanels } from './io.js';
import { humanizeKey, FieldSpec, FRAME_STAT_CELLS } from './fields.js';
import { isFeatureType } from './v2.js';

export function moveArrayItem<T>(list: T[], fromIndex: number, toIndex: number): boolean {
  if (!Array.isArray(list) || list.length === 0) return false;
  if (fromIndex < 0 || fromIndex >= list.length) return false;
  const clampedTo = Math.max(0, Math.min(toIndex, list.length - 1));
  if (clampedTo === fromIndex) return false;
  const [item] = list.splice(fromIndex, 1);
  list.splice(clampedTo, 0, item as T);
  return true;
}

export function dropTargetIndex(fromIndex: number, hoverIndex: number, insertAfter: boolean): number {
  const desired = insertAfter ? hoverIndex + 1 : hoverIndex;
  return desired > fromIndex ? desired - 1 : desired;
}

export function dragInsertAfter(e: DragEvent, el: HTMLElement, horizontal = false): boolean {
  const rect = el.getBoundingClientRect();
  return horizontal ? e.clientX > rect.left + rect.width / 2 : e.clientY > rect.top + rect.height / 2;
}

const DRAG_SURFACE_SEPARATOR = '|';

function dragPayload(surface: string, index: number): string {
  return `${surface}${DRAG_SURFACE_SEPARATOR}${index}`;
}

export function dragSourceIndex(e: DragEvent, surface: string): number | null {
  const raw = e.dataTransfer?.getData('text/plain') ?? '';
  const cut = raw.lastIndexOf(DRAG_SURFACE_SEPARATOR);
  if (cut === -1) return null;
  if (raw.slice(0, cut) !== surface) return null;
  const parsed = Number(raw.slice(cut + 1));
  return Number.isInteger(parsed) ? parsed : null;
}

function armDragSource(e: DragEvent, index: number, el: HTMLElement, surface: string) {
  e.dataTransfer?.setData('text/plain', dragPayload(surface, index));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  el.classList.add('dragging');
}

export function paintDragOver(e: DragEvent, el: HTMLElement, horizontal = false) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const after = dragInsertAfter(e, el, horizontal);
  el.classList.toggle('drag-over-before', !after);
  el.classList.toggle('drag-over-after', after);
}

export function clearDragOver(el: HTMLElement) {
  el.classList.remove('drag-over-before', 'drag-over-after');
}

export interface DragReorderSpec {
  index: number;
  surface: string;
  horizontal?: boolean;
  source?: HTMLElement;
  stopOnSource?: boolean;
  stopOnTarget?: boolean;
  onDrop: (from: number, after: boolean) => void;
}

export function wireDragReorder(target: HTMLElement, spec: DragReorderSpec) {
  const source = spec.source ?? target;
  const horizontal = spec.horizontal === true;
  source.draggable = true;
  source.addEventListener('dragstart', (e) => {
    if (spec.stopOnSource === true) e.stopPropagation();
    armDragSource(e, spec.index, target, spec.surface);
  });
  source.addEventListener('dragend', (e) => {
    if (spec.stopOnSource === true) e.stopPropagation();
    target.classList.remove('dragging');
    clearDragOver(target);
  });
  target.addEventListener('dragover', (e) => {
    if (spec.stopOnTarget === true) e.stopPropagation();
    paintDragOver(e, target, horizontal);
  });
  target.addEventListener('dragleave', (e) => {
    if (spec.stopOnTarget === true) e.stopPropagation();
    clearDragOver(target);
  });
  target.addEventListener('drop', (e) => {
    e.preventDefault();
    if (spec.stopOnTarget === true) e.stopPropagation();
    const after = dragInsertAfter(e, target, horizontal);
    clearDragOver(target);
    const from = dragSourceIndex(e, spec.surface);
    if (from === null) return;
    spec.onDrop(from, after);
  });
}

function tagPreviewLabel(entry: any): string {
  const id = tagIdOf(entry);
  const def = tagDefFor(id);
  const name = def?.name !== undefined && def.name !== '' ? def.name : id;
  const val = entry !== null && typeof entry === 'object' ? entry.val : undefined;
  if (val === undefined || val === null || val === '') return name.replace('{VAL}', '1');
  if (name.includes('{VAL}')) return name.replace('{VAL}', String(val));
  return `${name} ${val}`;
}

function tierText(raw: unknown): string {
  if (!Array.isArray(raw)) return asText(raw);
  return raw
    .map((cell) => asText(Array.isArray(cell) ? cell[0] : cell))
    .filter((text) => text !== '')
    .join('/');
}

function entryPreview(value: unknown, lowercaseKind: boolean): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((entry) => {
      if (entry === null || typeof entry !== 'object') return asText(entry);
      const amount = tierText((entry as any)[rowValueKey(entry)]);
      const raw = asText((entry as any).type);
      const kind = lowercaseKind ? raw.toLowerCase() : raw;
      return [amount, kind].filter((part) => part !== '').join(' ');
    })
    .filter((text) => text !== '')
    .join(', ');
}

const damagePreview = (value: unknown) => entryPreview(value, true);
const rangePreview = (value: unknown) => entryPreview(value, false);

function tagsPreview(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((entry) => tagPreviewLabel(entry))
    .filter((text) => text !== '')
    .join(' | ');
}

export function joinParts(parts: (string | undefined)[], separator: string): string {
  return parts.map((part) => (part ?? '').trim()).filter((part) => part !== '').join(separator);
}

function plainText(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim();
}

function rowPreviewLabel(row: unknown): string {
  if (!isPlainObject(row)) return asText(row);
  const entry = row as Record<string, unknown>;
  for (const key of ['name', 'title', 'id', 'text', 'detail', 'result', 'description']) {
    const text = asText(entry[key]);
    if (text !== '') return text;
  }
  return '';
}

interface FieldPreview {
  kind: 'effect' | 'note';
  text: string;
}

function fieldPreviewValue(spec: FieldSpec, value: unknown): FieldPreview | null {
  switch (spec.kind) {
    case 'text':
    case 'select':
    case 'id':
    case 'number': {
      const text = asText(value);
      return text === '' ? null : { kind: 'note', text };
    }
    case 'textarea': {
      const text = plainText(asText(value));
      return text === '' ? null : { kind: 'effect', text };
    }
    case 'checkbox':
      return value === true ? { kind: 'note', text: 'Yes' } : null;
    case 'stringlist': {
      const text = Array.isArray(value) ? value.map((entry) => asText(entry)).filter((t) => t !== '').join(' | ') : '';
      return text === '' ? null : { kind: 'note', text };
    }
    case 'chips': {
      const text = Array.isArray(value) ? value.map((entry) => asText(entry)).filter((t) => t !== '').join(' | ') : '';
      return text === '' ? null : { kind: 'note', text };
    }
    case 'tags': {
      const text = tagsPreview(value);
      return text === '' ? null : { kind: 'note', text };
    }
    case 'damage': {
      const text = damagePreview(value);
      return text === '' ? null : { kind: 'note', text };
    }
    case 'range': {
      const text = rangePreview(value);
      return text === '' ? null : { kind: 'note', text };
    }
    case 'rows': {
      if (!Array.isArray(value) || value.length === 0) return null;
      const text = value.map(rowPreviewLabel).filter((t) => t !== '').join(' | ');
      return text === '' ? null : { kind: 'note', text };
    }
    default:
      return null;
  }
}

const GENERIC_PREVIEW_FIELD_EXCLUSIONS: Partial<Record<string, string[]>> = {
  'downtime_actions.json': ['results'],
};

function genericPreviewHtml(cat: string, item: any): string {
  const layout = layoutFor(cat);
  if (layout === null) return '';
  const identityKey = identityFieldFor(cat);
  const skip = new Set<string>([identityKey, 'id', ...(GENERIC_PREVIEW_FIELD_EXCLUSIONS[cat] ?? [])]);
  const metaParts: string[] = [];
  const rows: string[] = [];
  let effectShown = false;

  const walkFields = (fields: FieldSpec[], owner: any, allowMeta: boolean) => {
    for (const field of fields) {
      if (skip.has(field.key)) continue;
      const value = owner[field.key];
      if (value === undefined || value === null || value === '') continue;
      if (field.kind === 'group') {
        if (isPlainObject(value)) {
          walkFields(field.fields ?? [], value, false);
        }
        continue;
      }
      if (allowMeta && (field.kind === 'text' || field.kind === 'select')) {
        const text = asText(value);
        if (text !== '') metaParts.push(text);
        continue;
      }
      const rendered = fieldPreviewValue(field, value);
      if (rendered === null) continue;
      if (rendered.kind === 'effect' && !effectShown) {
        effectShown = true;
        rows.push(`<div class="card-effect">${esc(rendered.text)}</div>`);
      } else {
        rows.push(`<div class="card-note"><span class="card-key">${esc(field.label)}</span>${esc(rendered.text)}</div>`);
      }
    }
  };

  layout.sections.forEach((section, idx) => walkFields(section.fields, item, idx === 0));

  const out: string[] = [];
  if (metaParts.length > 0) out.push(`<div class="card-meta">${esc(metaParts.join(' | '))}</div>`);
  out.push(...rows);
  return out.join('');
}

function tierStatLine(stats: any): string {
  if (!isPlainObject(stats)) return '';
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(stats)) {
    const text = tierText(raw);
    if (text !== '') parts.push(`${humanizeKey(key)} ${text}`);
  }
  return parts.join(' | ');
}

function manifestCardHtml(item: any): string {
  const rows: string[] = [];
  rows.push(`<div class="card-name">${esc(asText(item.name) || 'Untitled Pack')}</div>`);
  const sub = joinParts([asText(item.version), asText(item.author)], ' | ');
  if (sub !== '') rows.push(`<div class="card-sub">${esc(sub)}</div>`);
  const prefix = asText(item.item_prefix);
  if (prefix !== '') rows.push(`<div class="card-meta">${esc(prefix)}</div>`);
  const description = plainText(asText(item.description));
  if (description !== '') rows.push(`<div class="card-effect">${esc(description)}</div>`);
  const website = asText(item.website);
  if (website !== '') rows.push(`<div class="card-link">${esc(website)}</div>`);
  return rows.join('');
}

// hand-tuned per category, genericPreviewHtml does the rest
function previewCardHtml(cat: string, item: any): string {
  if (cat === 'lcp_manifest.json') return manifestCardHtml(item);
  const rows: string[] = [];
  const identityKey = identityFieldFor(cat);
  const name = asText(item[identityKey]) || asText(item.id) || 'Unnamed';
  rows.push(`<div class="card-name">${esc(name)}</div>`);

  const license = asText(item.license);
  const level = asText(item.license_level);
  const licenseBit = license !== '' ? joinParts([license, level], ' ') : level === '' ? '' : `LL ${level}`;
  const sub = joinParts([asText(item.source), licenseBit], ' | ');
  if (sub !== '') rows.push(`<div class="card-sub">${esc(sub)}</div>`);

  const line = (cls: string, text: string) => {
    const body = plainText(text);
    if (body === '') return;
    rows.push(`<div class="${cls}">${esc(body)}</div>`);
  };
  const noted = (label: string, text: string) => {
    const body = plainText(text);
    if (body === '') return;
    rows.push(`<div class="card-note"><span class="card-key">${esc(label)}</span>${esc(body)}</div>`);
  };
  const spText = asText(item.sp) === '' ? '' : `${asText(item.sp)} SP`;

  if (cat === 'weapons.json') {
    line('card-meta', joinParts([asText(item.mount), asText(item.type), spText], ' | '));
    line('card-stat', joinParts([damagePreview(item.damage), rangePreview(item.range)], ' | '));
    line('card-tags', tagsPreview(item.tags));
    line('card-effect', asText(item.effect));
    noted('On Attack', asText(item.on_attack));
    noted('On Hit', asText(item.on_hit));
    noted('On Crit', asText(item.on_crit));
  } else if (cat === 'systems.json') {
    line('card-meta', joinParts([asText(item.type), spText], ' | '));
    line('card-tags', tagsPreview(item.tags));
    line('card-effect', asText(item.effect));
    line('card-effect', asText(item.description));
  } else if (cat === 'mods.json') {
    const fits = Array.isArray(item.allowed_types) ? item.allowed_types.map((entry: unknown) => asText(entry)).join(', ') : '';
    line('card-meta', joinParts([spText, fits], ' | '));
    line('card-stat', joinParts([damagePreview(item.added_damage), rangePreview(item.added_range)], ' | '));
    noted('Adds', tagsPreview(item.added_tags));
    line('card-tags', tagsPreview(item.tags));
    line('card-effect', asText(item.effect));
  } else if (cat === 'frames.json') {
    const mechType = Array.isArray(item.mechtype) ? item.mechtype.map((entry: unknown) => asText(entry)).join(' | ') : '';
    line('card-meta', mechType);
    const stats = item.stats;
    if (stats !== null && typeof stats === 'object') {
      const cells = FRAME_STAT_CELLS.map((cell) => {
        const value = asText((stats as any)[cell.key]);
        return value === '' ? '' : `${cell.label} ${value}`;
      });
      line('card-stat', joinParts(cells, ' | '));
    }
    const mounts = Array.isArray(item.mounts) ? item.mounts.map((entry: unknown) => asText(entry)).join(' | ') : '';
    noted('Mounts', mounts);
    const traits = Array.isArray(item.traits)
      ? item.traits.map((entry: any) => (entry !== null && typeof entry === 'object' ? asText(entry.name) : '')).filter((text: string) => text !== '').join(' | ')
      : '';
    noted('Traits', traits);
    const core = item.core_system;
    if (core !== null && typeof core === 'object') noted('Core', asText((core as any).name));
    line('card-effect', asText(item.description));
  } else if (cat === 'talents.json') {
    line('card-meta', asText(item.terse));
    const ranks = Array.isArray(item.ranks)
      ? item.ranks.map((entry: any) => (entry !== null && typeof entry === 'object' ? asText(entry.name) : '')).filter((text: string) => text !== '').join(' | ')
      : '';
    noted('Ranks', ranks);
    line('card-effect', asText(item.description));
  } else if (cat === 'core_bonuses.json') {
    line('card-effect', asText(item.effect));
    line('card-effect', asText(item.description));
    noted('Mounted', asText(item.mounted_effect));
  } else if (cat === 'actions.json') {
    line('card-meta', joinParts([asText(item.activation), asText(item.action_type)], ' | '));
    line('card-stat', asText(item.terse));
    noted('Trigger', asText(item.trigger));
    noted('Frequency', asText(item.frequency));
    line('card-effect', asText(item.detail));
  } else if (cat === 'pilot_gear.json') {
    line('card-meta', asText(item.type));
    line('card-stat', joinParts([damagePreview(item.damage), rangePreview(item.range)], ' | '));
    line('card-tags', tagsPreview(item.tags));
    line('card-effect', asText(item.description));
    line('card-effect', asText(item.effect));
  } else if (cat === 'reserves.json') {
    line('card-meta', joinParts([asText(item.type), asText(item.label)], ' | '));
    noted('Cost', asText(item.resource_cost));
    line('card-effect', asText(item.description));
  } else if (cat === 'statuses.json') {
    line('card-meta', joinParts([asText(item.type), asText(item.exclusive)], ' | '));
    line('card-stat', asText(item.terse));
    line('card-effect', asText(item.effects));
  } else if (cat === 'tags.json') {
    line('card-meta', asText(item.id));
    line('card-effect', asText(item.description));
  } else if (cat === 'npc_classes.json') {
    line('card-meta', asText(item.role));
    line('card-stat', tierStatLine(item.stats));
    const derived = derivedFeaturesFor(item);
    const baseNames = derived
      .filter((row) => row.base)
      .map((row) => asText(row.item.name) || asText(row.item.id))
      .filter((name) => name !== '');
    noted('Base', baseNames.join(' | '));
    const optionalCount = derived.filter((row) => !row.base).length;
    noted('Optional', optionalCount === 0 ? '' : `${optionalCount} feature${optionalCount === 1 ? '' : 's'}`);
    const info = item.info;
    if (info !== null && typeof info === 'object') line('card-effect', asText((info as any).flavor));
  } else if (cat === 'npc_templates.json') {
    line('card-meta', asText(item.power) === '' ? '' : `Power ${asText(item.power)}`);
    const derived = derivedFeaturesFor(item);
    const namesOf = (base: boolean) =>
      derived
        .filter((row) => row.base === base)
        .map((row) => asText(row.item.name) || asText(row.item.id))
        .filter((name) => name !== '')
        .join(' | ');
    noted('Base', namesOf(true));
    noted('Optional', namesOf(false));
    line('card-effect', asText(item.description));
  } else if (cat === 'npc_features.json') {
    const origin = item.origin !== null && typeof item.origin === 'object' ? asText((item.origin as any).name) : asText(item.origin);
    line('card-meta', joinParts([asText(item.type), origin], ' | '));
    line('card-stat', joinParts([damagePreview(item.damage), rangePreview(item.range)], ' | '));
    noted('Attack', tierText(item.attack_bonus));
    noted('Accuracy', tierText(item.accuracy));
    line('card-tags', tagsPreview(item.tags));
    line('card-effect', asText(item.effect));
    noted('Trigger', asText(item.trigger));
  } else if (cat === EIDOLON_LAYERS) {
    const features = Array.isArray(item.features) ? item.features : [];
    const shards = item.shards !== null && typeof item.shards === 'object' ? (item.shards as any) : null;
    const shardCount = shards === null ? '' : countText(shards.count);
    const featureCount = features.length === 0 ? '' : `${features.length} feature${features.length === 1 ? '' : 's'}`;
    line('card-meta', joinParts([shardCount === '' ? '' : `Shards ${shardCount}`, featureCount], ' | '));
    const names = features
      .map((entry: any) => (entry !== null && typeof entry === 'object' ? asText(entry.name) : ''))
      .filter((text: string) => text !== '')
      .join(' | ');
    noted('Features', names);
    line('card-effect', asText(item.rules));
    noted('Hints', asText(item.hints));
    noted('Appearance', asText(item.appearance));
  } else {
    rows.push(genericPreviewHtml(cat, item));
  }

  return rows.join('');
}

export function refreshPreview() {
  const card = document.getElementById('preview-card');
  if (card === null || currentCategory === null) return;
  const item = currentTarget();
  if (item === undefined || item === null || typeof item !== 'object') {
    card.innerHTML = '';
    return;
  }
  card.innerHTML = previewCardHtml(currentCategory, item);
}

const KNOWN_TABS = ['library', 'editor', 'export'];

export function switchTab(tabId: string) {
  flushPackSave();
  if (!KNOWN_TABS.includes(tabId)) tabId = 'library';
  if ((tabId === 'editor' || tabId === 'export') && !currentPack) {
    setPackTabsEnabled(false);
    tabId = 'library';
  }

  document.querySelectorAll('.tabs .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tabs .tab-btn[data-tab="${tabId}"]`)?.classList.add('active');

  document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
  document.getElementById(`view-${tabId}`)!.classList.add('active');

  if (tabId === 'library') {

    renderLibrary();
  } else if (tabId === 'export' && currentPack) {
    document.getElementById('export-name')!.innerText = currentPack.name;
    document.getElementById('export-version')!.innerText = currentPack.version;
    validateCurrentPack();
    renderExportPanels();
    renderConvertReport();
  }
}

const MASTER_LIST_SURFACE = 'master';

function arraySurfaceFor(path: (string | number)[]): string {
  return `array:${path.map((step) => String(step)).join('.')}`;
}

type NpcKind = 'class' | 'feature' | 'template';

interface ItemSlot {
  file: string;
  index: number;
}

export const NPC_CATEGORY_BY_KIND: Record<NpcKind, string> = {
  class: 'npc_classes.json',
  feature: 'npc_features.json',
  template: 'npc_templates.json',
};

function npcKindForCategory(cat: string): NpcKind | null {
  for (const [kind, file] of Object.entries(NPC_CATEGORY_BY_KIND)) {
    if (file === cat) return kind as NpcKind;
  }
  return null;
}

// sniffing, not schema. packs disagree on how a feature points at its owner
function originIsNpc(origin: unknown): boolean {
  if (typeof origin === 'string') return /(?:^|[_-])npc[ct]_/.test(origin);
  if (!isPlainObject(origin)) return false;
  const kind = asText(origin.type).toLowerCase();
  return kind === 'class' || kind === 'template';
}

export function npcKindOf(item: any): NpcKind | null {
  if (!isPlainObject(item)) return null;
  const entry = item as any;
  const id = typeof entry.id === 'string' ? entry.id : '';
  const hasStats = isPlainObject(entry.stats);
  if (hasStats && (typeof entry.role === 'string' || id.startsWith('npcc_'))) return 'class';
  if (entry.template === true || id.startsWith('npct_')) return 'template';
  if (id.startsWith('npcf_')) return 'feature';
  if (isFeatureType(entry.type) && (entry.origin !== undefined || Array.isArray(entry.tags))) return 'feature';
  if (originIsNpc(entry.origin)) return 'feature';
  if (Array.isArray(entry.base_features) || Array.isArray(entry.optional_features)) {
    return hasStats ? 'class' : 'template';
  }
  return hasStats ? 'class' : null;
}

function isAggregateCandidate(file: string): boolean {
  return (
    file.endsWith('.json') &&
    file !== 'lcp_manifest.json' &&
    file !== 'info.json' &&
    !PACK_ARRAY_FILES.has(file)
  );
}

export function npcAggregateFiles(pack: PackDraft | null = currentPack): string[] {
  if (!pack) return [];
  const out: string[] = [];
  for (const file of Object.keys(pack.data)) {
    if (!isAggregateCandidate(file)) continue;
    const items = pack.data[file];
    if (!Array.isArray(items) || items.length === 0) continue;
    let anchored = false;
    let uniform = true;
    for (const item of items) {
      const kind = npcKindOf(item);
      if (kind === null) {
        uniform = false;
        break;
      }
      if (kind !== 'feature' || (item as any).origin !== undefined) anchored = true;
    }
    if (uniform && anchored) out.push(file);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function slotsFor(cat: string, pack: PackDraft | null = currentPack): ItemSlot[] {
  const slots: ItemSlot[] = [];
  if (!pack) return slots;
  const own = pack.data[cat];
  if (Array.isArray(own)) own.forEach((_item, index) => slots.push({ file: cat, index }));
  const kind = npcKindForCategory(cat);
  if (kind === null) return slots;
  for (const file of npcAggregateFiles(pack)) {
    const items = pack.data[file];
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      if (npcKindOf(item) === kind) slots.push({ file, index });
    });
  }
  return slots;
}

export function containerFor(
  cat: string,
  idx: number,
  pack: PackDraft | null = currentPack,
): { list: any[]; index: number; file: string } | null {
  if (!pack || idx < 0) return null;
  if (npcKindForCategory(cat) === null) {
    const list = pack.data[cat];
    return Array.isArray(list) && idx < list.length ? { list, index: idx, file: cat } : null;
  }
  const slot = slotsFor(cat, pack)[idx];
  if (slot === undefined) return null;
  const list = pack.data[slot.file];
  return Array.isArray(list) ? { list, index: slot.index, file: slot.file } : null;
}

export function itemAt(cat: string, idx: number, pack: PackDraft | null = currentPack): any {
  const found = containerFor(cat, idx, pack);
  return found === null ? undefined : found.list[found.index];
}

export function catItems(cat: string, pack: PackDraft | null = currentPack): any[] {
  if (!pack) return [];
  if (npcKindForCategory(cat) === null) {
    const list = pack.data[cat];
    return Array.isArray(list) ? list : [];
  }
  return slotsFor(cat, pack).map((slot) => {
    const list = pack.data[slot.file];
    return Array.isArray(list) ? list[slot.index] : undefined;
  });
}

// massif ships one of these per file as a fallback. comp/con hides them too, but they stay in the data
function isReservedStub(item: any): boolean {
  return isPlainObject(item) && typeof item.id === 'string' && item.id.startsWith('missing_');
}

export function visibleCatCount(cat: string, pack: PackDraft | null = currentPack): number {
  return catItems(cat, pack).reduce((total, item) => total + (isReservedStub(item) ? 0 : 1), 0);
}

function firstVisibleIndex(cat: string): number {
  return catItems(cat).findIndex((item) => item !== undefined && item !== null && !isReservedStub(item));
}

export function catCount(cat: string, pack: PackDraft | null = currentPack): number {
  if (!pack) return 0;
  if (npcKindForCategory(cat) === null) {
    const list = pack.data[cat];
    return Array.isArray(list) ? list.length : 0;
  }
  return slotsFor(cat, pack).length;
}

export function isListCategory(cat: string, pack: PackDraft | null = currentPack): boolean {
  if (cat === 'lcp_manifest.json' || !pack) return false;
  const value = pack.data[cat];
  if (Array.isArray(value)) return true;
  if (value !== undefined) return false;
  return npcKindForCategory(cat) !== null || railCategories(pack).includes(cat);
}

function packHasEidolonLayers(pack: PackDraft | null): boolean {
  if (pack === null) return false;
  const list = pack.data[EIDOLON_LAYERS];
  if (!Array.isArray(list)) return false;
  return list.some((item) => isPlainObject(item));
}

function eidolonUnlockedFor(packs: (PackDraft | null)[]): boolean {
  return packs.some(packHasEidolonLayers);
}

export function eidolonUnlocked(): boolean {
  return eidolonUnlockedFor(currentPack === null ? libraryDrafts : [currentPack, ...libraryDrafts]);
}

export function railCategories(pack: PackDraft | null = currentPack): string[] {
  if (pack === null) return [PACK_MANIFEST];
  const own = packCategoryNames(pack);
  const format = packFormatOf(pack);
  const union = sameFormatCategoryUnion(format, libraryDrafts);
  const all = new Set<string>([PACK_MANIFEST, ...own, ...union]);
  return categoryOrder(Array.from(all));
}

function categoryOrder(categories: string[]): string[] {
  const ordered = categories.filter((cat) => cat !== EIDOLON_LAYERS);
  if (ordered.length !== categories.length) ordered.push(EIDOLON_LAYERS);
  return ordered;
}

function packCategoryNames(pack: PackDraft): string[] {
  const aggregates = new Set(npcAggregateFiles(pack));
  const names = new Set<string>();
  for (const [cat, value] of Object.entries(pack.data)) {
    if (cat === PACK_MANIFEST || !cat.endsWith('.json') || !Array.isArray(value)) continue;
    if (aggregates.has(cat)) {
      for (const item of value) {
        const kind = npcKindOf(item);
        if (kind !== null) names.add(NPC_CATEGORY_BY_KIND[kind]);
      }
      continue;
    }
    names.add(cat);
  }
  return Array.from(names);
}

function sameFormatCategoryUnion(format: PackFormat, drafts: PackDraft[]): Set<string> {
  const union = new Set<string>();
  for (const draft of drafts) {
    if (packFormatOf(draft) !== format) continue;
    for (const cat of packCategoryNames(draft)) {
      if (cat === EIDOLON_LAYERS && format !== 'v3') continue;
      union.add(cat);
    }
  }
  return union;
}

function sortCategories(categories: Iterable<string>): string[] {
  return Array.from(categories).sort((a, b) => categoryTitle(a).localeCompare(categoryTitle(b)));
}

function creatableCategories(pack: PackDraft, drafts: PackDraft[]): string[] {
  const format = packFormatOf(pack);
  const present = new Set(packCategoryNames(pack));
  const union = sameFormatCategoryUnion(format, drafts);
  return sortCategories(Array.from(union).filter((cat) => !present.has(cat)));
}

export function importableCategoryOptions(pack: PackDraft, drafts: PackDraft[]): string[] {
  const format = packFormatOf(pack);
  const union = sameFormatCategoryUnion(format, drafts.filter((draft) => draft.id !== pack.id));
  for (const cat of packCategoryNames(pack)) union.add(cat);
  return sortCategories(union);
}

export async function promptCreateCategory() {
  if (currentPack === null) return;
  const suggestions = creatableCategories(currentPack, libraryDrafts).map(categoryTitle);
  const res = await customPrompt('New category:', false, suggestions);
  if (res === null) return;
  const slug = slugifyName(res.value);
  if (slug === '') {
    showToast('Invalid category name');
    return;
  }
  const cat = `${slug}.json`;
  if (currentPack.data[cat] !== undefined) {
    showToast('Category already exists');
    return;
  }
  standardListFor(cat);
  flushPackSave();
  renderEditorRail();
  selectCategory(cat);
}

export function categoryDeletable(cat: string): boolean {
  return cat !== PACK_MANIFEST;
}

function deleteCategoryData(pack: PackDraft, cat: string): number {
  let removed = 0;
  const kind = npcKindForCategory(cat);
  const aggregateFiles = kind !== null ? npcAggregateFiles(pack) : [];

  if (Array.isArray(pack.data[cat])) removed += pack.data[cat].length;
  delete pack.data[cat];

  for (const file of aggregateFiles) {
    const list = pack.data[file];
    if (!Array.isArray(list)) continue;
    const kept = list.filter((item) => npcKindOf(item) !== kind);
    removed += list.length - kept.length;
    if (kept.length === 0) delete pack.data[file];
    else pack.data[file] = kept;
  }

  return removed;
}

export async function confirmDeleteCategory(cat: string) {
  if (currentPack === null || !categoryDeletable(cat)) return;
  const count = catCount(cat);
  const message = count > 0 ? `Delete this category and its ${count} item(s)?` : 'Delete this category?';
  if (!(await customConfirm(message))) return;
  deleteCategoryData(currentPack, cat);
  if (currentCategory === cat) setCurrentItemIndex(null);
  flushPackSave();
  renderEditorRail();
}

export function slotIndexOf(cat: string, file: string, index: number): number {
  return slotsFor(cat).findIndex((slot) => slot.file === file && slot.index === index);
}

export function standardListFor(cat: string): any[] {
  const target = currentPack!.data[cat];
  if (Array.isArray(target)) return target;
  const created: any[] = [];
  currentPack!.data[cat] = created;
  return created;
}

export function reorderCategoryItem(
  cat: string,
  fromIndex: number,
  toIndex: number,
  pack: PackDraft | null = currentPack,
): boolean {
  if (pack === null || fromIndex === toIndex) return false;
  const from = containerFor(cat, fromIndex, pack);
  const to = containerFor(cat, toIndex, pack);
  if (from === null || to === null || from.file !== to.file) return false;
  return moveArrayItem(from.list, from.index, to.index);
}

function relocateAcrossFiles(
  cat: string,
  fromIndex: number,
  toIndex: number,
  pack: PackDraft | null = currentPack,
): boolean {
  if (pack === null || fromIndex === toIndex) return false;
  const from = containerFor(cat, fromIndex, pack);
  const to = containerFor(cat, toIndex, pack);
  if (from === null || to === null || from.file === to.file) return false;
  const [item] = from.list.splice(from.index, 1);
  const postSlots = slotsFor(cat, pack);
  if (toIndex < postSlots.length) {
    const target = postSlots[toIndex];
    const targetList = pack.data[target.file];
    if (!Array.isArray(targetList)) {
      from.list.splice(from.index, 0, item);
      return false;
    }
    targetList.splice(target.index, 0, item);
    return true;
  }
  const targetList = pack.data[to.file];
  if (!Array.isArray(targetList)) {
    from.list.splice(from.index, 0, item);
    return false;
  }
  targetList.splice(to.index + 1, 0, item);
  return true;
}

function reorderMasterListItem(cat: string, fromIndex: number, toIndex: number) {
  if (!currentPack) return;
  const selected = currentItemIndex === null ? undefined : itemAt(cat, currentItemIndex, currentPack);
  const moved =
    reorderCategoryItem(cat, fromIndex, toIndex, currentPack) ||
    relocateAcrossFiles(cat, fromIndex, toIndex, currentPack);
  if (!moved) return;
  flushPackSave();
  validateCurrentPack();
  if (selected === undefined) return;
  const landed = catItems(cat, currentPack).indexOf(selected);
  if (landed !== -1) selectItem(landed);
}

let eidolonVisible = false;

export function refreshEidolonCreatorButton() {
  document.getElementById('btn-create-eidolon')!.classList.toggle('hidden', !eidolonUnlockedFor(libraryDrafts));
}

export function refreshEidolonVisibility() {
  const unlocked = eidolonUnlocked();
  refreshEidolonCreatorButton();
  if (unlocked === eidolonVisible || currentPack === null) return;
  renderEditorRail({ keepSelection: true });
}

export function renderEditorRail(options: { keepSelection?: boolean } = {}) {
  resetPackSearch();
  const activeCategories = railCategories();
  eidolonVisible = eidolonUnlocked();
  const rail = document.getElementById('category-rail')!;
  rail.innerHTML = '';

  activeCategories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'cat-row';

    const btn = document.createElement('button');
    btn.className = 'cat-btn';
    btn.onclick = async () => {
      if (!(await confirmDiscardJsonEdits())) return;
      selectCategory(cat);
    };

    btn.id = `rail-${cat}`;
    row.appendChild(btn);

    if (categoryDeletable(cat)) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-delete-item cat-btn-delete';
      del.setAttribute('aria-label', 'Delete category');
      del.innerText = '✕';
      del.onclick = (e) => {
        e.stopPropagation();
        void confirmDeleteCategory(cat);
      };
      row.appendChild(del);
    }

    rail.appendChild(row);
    updateCategoryBadge(cat);
  });

  if (currentPack !== null) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn-add-field rail-add-category';
    addBtn.id = 'btn-add-category';
    addBtn.innerText = '+ Category';
    addBtn.onclick = () => {
      void promptCreateCategory();
    };
    rail.appendChild(addBtn);
  }

  if (options.keepSelection === true && currentCategory !== null && activeCategories.includes(currentCategory)) {
    document.getElementById(`rail-${currentCategory}`)?.classList.add('active');
    return;
  }
  selectCategory('lcp_manifest.json');
}

export function selectCategory(cat: string) {
  if (currentCategory) {
    const prev = document.getElementById(`rail-${currentCategory}`);
    if (prev) prev.classList.remove('active');
  }
  
  setCurrentCategory(cat);
  const next = document.getElementById(`rail-${cat}`);
  if (next) next.classList.add('active');
  refreshEidolonVisibility();

  document.getElementById('workspace-title')!.innerText = categoryTitle(cat);
  
  const pane = document.getElementById('master-list-pane')!;
  if (cat === PACK_MANIFEST && currentPack && !currentPack.data[cat]) {
    currentPack.data[cat] = stampFormat(
      {
        name: currentPack.name || 'New Pack',
        version: currentPack.version || '1.0',
        author: currentPack.author,
      },
      packFormatOf(currentPack),
    );
    flushPackSave();
  }

  if (isListCategory(cat)) {
    pane.classList.remove('hidden');
    document.getElementById('master-title')!.innerText = categoryTitle(cat);
    renderMasterList();
    const landing = firstVisibleIndex(cat);
    if (landing !== -1) {
      selectItem(landing);
    } else {
      setCurrentItemIndex(null);
      document.getElementById('form-container')!.innerHTML = '<p style="color:var(--muted)">No items</p>';
      hideValidationBadge();
      renderPartsStrip();
    }
  } else {
    pane.classList.add('hidden');
    setCurrentItemIndex(null);
    renderDetailForm(currentPack!.data[cat], []);
    hideValidationBadge();
    renderPartsStrip();
  }
}

function hideValidationBadge() {
  const badge = document.getElementById('validation-badge')!;
  badge.className = 'validation-badge hidden';
  badge.innerText = '';
}

function validationCategories(pack: PackDraft | null = currentPack): string[] {
  if (pack === null) return [];
  const covered = new Set(npcAggregateFiles(pack));
  const all = new Set([...CATEGORIES, ...Object.keys(pack.data)]);
  return Array.from(all).filter(
    (cat) => cat.endsWith('.json') && cat !== PACK_MANIFEST && !covered.has(cat),
  );
}

export function validateCurrentPack() {
  itemValidationErrors.clear();
  if (!currentPack) return;
  withValidationPass(() => {
    for (const cat of validationCategories()) {
      if (isListCategory(cat)) {
        const dt = catItems(cat);
        dt.forEach((item, idx) => {
           const combined = itemProblemSummary(cat, item);
           if (combined) itemValidationErrors.set(cat + ':' + idx, combined);
        });
        const ids = new Map<string, number[]>();
        dt.forEach((item, idx) => {
          if (item && typeof item.id === 'string' && item.id) {
            const list = ids.get(item.id) ?? [];
            list.push(idx);
            ids.set(item.id, list);
          }
        });
        for (const [id, idxs] of ids) {
          if (idxs.length < 2) continue;
          for (const idx of idxs) {
            const key = cat + ':' + idx;
            const msg = `duplicate id "${id}" (${idxs.length} items share it)`;
            const prev = itemValidationErrors.get(key);
            itemValidationErrors.set(key, prev ? `${prev}; ${msg}` : msg);
          }
        }
      }
    }
  });
  
  for (const cat of railCategories()) updateCategoryBadge(cat);
  renderMasterList();
  
  const badge = document.getElementById('validation-badge')!;
  if (currentCategory && currentItemIndex !== null) {
    paintValidationBadge(badge, itemKey(currentCategory, currentItemIndex));
  } else {
    badge.className = 'validation-badge hidden';
  }
}

export let libraryDrafts: PackDraft[] = [];

export function setLibraryDrafts(value: PackDraft[]) {
  libraryDrafts = value;
}

export function renderMasterList() {
  const container = document.getElementById('master-list')!;
  container.innerHTML = '';

  if (!currentCategory || !currentPack) return;
  if (!isListCategory(currentCategory)) return;
  const cat = currentCategory;

  catItems(cat).forEach((item, idx) => {
    if (item === undefined || item === null) return;
    if (isReservedStub(item)) return;
    const name = item.name || item.id || `Item ${idx}`;
    const haystack = `${name} ${item.id ?? ''}`.toLowerCase();
    if (masterSearchQuery && !haystack.includes(masterSearchQuery.toLowerCase())) return;
    const div = document.createElement('div');
    div.className = 'master-list-item' + (idx === currentItemIndex ? ' active' : '');
    div.dataset.idx = String(idx);
    wireDragReorder(div, {
      index: idx,
      surface: MASTER_LIST_SURFACE,
      onDrop: (from, after) => reorderMasterListItem(cat, from, dropTargetIndex(from, idx, after)),
    });
    div.innerHTML = `
      <div class="item-name">${esc(name)}</div>
      ${itemValidationErrors.has(itemKey(currentCategory, idx)) ? '<span class="validation-badge error">!</span>' : ''}
      <div class="item-actions">
        <button class="btn-duplicate-item" aria-label="Duplicate">⎘</button>
        <button class="btn-delete-item" aria-label="Delete">✕</button>
      </div>
    `;
    div.onclick = async (e) => {
      const tgt = e.target as HTMLElement;
      if (tgt.classList.contains('btn-duplicate-item')) {
        e.stopPropagation();
        if (!(await confirmDiscardJsonEdits())) return;
        const home = containerFor(cat, idx);
        if (home === null) return;
        const cloned = JSON.parse(JSON.stringify(item));
        if (cloned.id) cloned.id = uniqueAutoId(cat, `${cloned.id}_copy`, cloned);
        if (cloned.name) cloned.name += ' (Copy)';
        home.list.push(cloned);
        if (NPC_FEATURE_OWNER_FILES.includes(cat)) {
          cloneOwnerFeatures(item, cloned, home.file !== cat ? home.file : 'npc_features.json');
        }
        flushPackSave();
        validateCurrentPack();
        const landed = slotIndexOf(cat, home.file, home.list.length - 1);
        selectItem(landed === -1 ? idx : landed);
        return;
      }
      if (tgt.classList.contains('btn-delete-item')) {
        e.stopPropagation();
        if (await customConfirm('Delete this item?')) {
          const home = containerFor(cat, idx);
          if (home === null) return;
          home.list.splice(home.index, 1);
          flushPackSave();
          setCurrentItemIndex(null);
          validateCurrentPack();
          const left = catCount(cat);
          if (left > 0) selectItem(Math.min(idx, left - 1));
          else selectCategory(cat);
        }
        return;
      }
      if (!(await confirmDiscardJsonEdits())) return;
      selectItem(idx);
    };
    container.appendChild(div);
  });
}

export function selectItem(idx: number) {
  setCurrentItemIndex(idx);
  document.querySelectorAll('.master-list-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.master-list-item[data-idx="${idx}"]`)?.classList.add('active');
  
  if (!currentPack || !currentCategory) return;
  const dt = itemAt(currentCategory, idx);
  renderDetailForm(dt, [idx]);

  paintValidationBadge(document.getElementById('validation-badge')!, itemKey(currentCategory, idx));

  renderPartsStrip();
}

function snippetAround(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 24);
  const end = Math.min(text.length, at + length + 36);
  return `${start > 0 ? '...' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '...' : ''}`;
}

function findStringMatch(value: any, needle: string, path: string, depth: number): { field: string; snippet: string } | null {
  if (typeof value === 'string') {
    const at = value.toLowerCase().indexOf(needle);
    return at === -1 ? null : { field: path || 'text', snippet: snippetAround(value, at, needle.length) };
  }
  if (value === null || typeof value !== 'object' || depth >= DISPLAY_WALK_DEPTH) return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
    const hit = findStringMatch(child, needle, childPath, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function searchPack(query: string): PackSearchHit[] {
  const needle = query.trim().toLowerCase();
  const hits: PackSearchHit[] = [];
  if (!currentPack || needle.length < SEARCH_MIN_QUERY) return hits;

  for (const cat of railCategories()) {
    if (cat === 'lcp_manifest.json' || !isListCategory(cat)) continue;
    catItems(cat).forEach((item: any, idx: number) => {
      if (!item || typeof item !== 'object') return;
      const name = typeof item.name === 'string' ? item.name : '';
      const id = typeof item.id === 'string' ? item.id : '';
      let field: string;
      let snippet: string;
      if (name.toLowerCase().includes(needle)) {
        field = 'name';
        snippet = '';
      } else if (id.toLowerCase().includes(needle)) {
        field = 'id';
        snippet = id;
      } else {
        const deep = findStringMatch(item, needle, '', 0);
        if (!deep) return;
        field = deep.field;
        snippet = deep.snippet;
      }
      hits.push({ cat, idx, label: name || id || `Item ${idx}`, key: id || name, field, snippet });
    });
  }
  return hits;
}

export function hidePackSearch() {
  const panel = document.getElementById('pack-search-results')!;
  panel.innerHTML = '';
  panel.classList.add('hidden');
}

function resetPackSearch() {
  setPackSearchQuery('');
  (document.getElementById('pack-search-input') as HTMLInputElement).value = '';
  hidePackSearch();
}

function resolveHitIndex(hit: PackSearchHit): number | null {
  if (!currentPack || !isListCategory(hit.cat)) return null;
  const dt = catItems(hit.cat);
  const atIndex = dt[hit.idx];
  const identity = (item: any) => (item && typeof item === 'object' ? item.id || item.name || '' : '');
  if (atIndex && identity(atIndex) === hit.key) return hit.idx;
  const moved = dt.findIndex((item: any) => identity(item) === hit.key);
  return moved === -1 ? null : moved;
}

async function gotoPackSearchHit(hit: PackSearchHit) {
  if (!(await confirmDiscardJsonEdits())) return;
  const idx = resolveHitIndex(hit);
  if (idx === null) {
    showToast('That item is gone');
    renderPackSearch();
    return;
  }
  hidePackSearch();
  setMasterSearchQuery('');
  (document.getElementById('master-search-input') as HTMLInputElement).value = '';
  selectCategory(hit.cat);
  selectItem(idx);
}

export function renderPackSearch() {
  const panel = document.getElementById('pack-search-results')!;
  panel.innerHTML = '';

  if (packSearchQuery.trim().length < SEARCH_MIN_QUERY) {
    panel.classList.add('hidden');
    return;
  }

  const hits = searchPack(packSearchQuery);
  panel.classList.remove('hidden');

  if (hits.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pack-search-empty';
    empty.innerText = 'No matches';
    panel.appendChild(empty);
    return;
  }

  hits.slice(0, SEARCH_RESULT_CAP).forEach((hit) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'pack-search-row';
    const catLabel = categoryTitle(hit.cat);
    const snip =
      hit.field === 'name' ? '' : `<span class="hit-snip">${esc(hit.field)}: ${esc(hit.snippet)}</span>`;
    row.innerHTML = `<span class="hit-cat">${esc(catLabel)}</span><span class="hit-name">${esc(hit.label)}</span>${snip}`;
    row.addEventListener('click', () => {
      void gotoPackSearchHit(hit);
    });
    panel.appendChild(row);
  });

  if (hits.length > SEARCH_RESULT_CAP) {
    const more = document.createElement('div');
    more.className = 'pack-search-more';
    more.innerText = `+${hits.length - SEARCH_RESULT_CAP} more`;
    panel.appendChild(more);
  }
}

function updateCategoryBadge(cat: string) {
  const btn = document.getElementById(`rail-${cat}`);
  if (btn === null) return;
  let countText = '';
  if (currentPack) {
    const count = visibleCatCount(cat);
    if (isListCategory(cat) && count > 0) countText = `<span class="badge">${count}</span>`;
    else if (cat === 'lcp_manifest.json' && currentPack.data[cat]) countText = '<span class="badge">1</span>';
  }
  let errCount = 0;
  for (const key of itemValidationErrors.keys()) {
    if (key.startsWith(cat + ':')) errCount += 1;
  }
  const errText = errCount > 0 ? `<span class="badge err">${errCount}!</span>` : '';
  btn.innerHTML = `${esc(categoryTitle(cat))} ${countText}${errText}`;
}

export function updateDataAt(path: (string|number)[], value: any) {
  if (!currentPack || !currentCategory) return;

  const ownerKeyEdit =
    path.length === 2 && typeof path[0] === 'number' && (path[1] === 'name' || path[1] === 'id')
      ? itemAt(currentCategory, path[0])
      : undefined;
  const ownerKeyBefore = ownerKeyEdit === undefined ? null : ownerKeySnapshot(ownerKeyEdit);

  if (path.length === 0) {
    currentPack.data[currentCategory] = value;
  } else {
    const rootIndex = path[0];
    const found = typeof rootIndex === 'number' ? containerFor(currentCategory, rootIndex) : null;
    let target: any = found === null ? currentPack.data[currentCategory] : found.list;
    const walk = found === null ? path : [found.index, ...path.slice(1)];
    for (let i = 0; i < walk.length - 1; i++) {
      target = target[walk[i]];
    }
    target[walk[walk.length - 1]] = value;
  }
  
  if (currentCategory === 'lcp_manifest.json') {
    const manifest = currentPack.data[currentCategory];
    currentPack.name = manifest.name || 'Unnamed';
    currentPack.version = manifest.version || '1.0';
    currentPack.author = manifest.author || '';

  }

  if (ownerKeyBefore !== null && ownerKeyBefore.kind !== null) {
    rehomeDependentFeatures(ownerKeyEdit, ownerKeyBefore);
  }

  flushPackSave();

  if (path.length === 2 && (path[1] === 'name' || path[1] === 'id')) {
    renderMasterList();
  }
  validateCurrentItemScoped();

  const isRootApply = path.length === (isListCategory(currentCategory) ? 1 : 0);
  if (isRootApply) {
    rerenderCurrentDetail();
    return;
  }
  refreshPreview();
  refreshFieldProblems();
}

function itemKey(cat: string | null, idx: number | null): string {
  return `${cat}:${idx}`;
}

function paintValidationBadge(badge: HTMLElement, itemKey: string) {
  const err = itemValidationErrors.get(itemKey);
  badge.className = err ? 'validation-badge error' : 'validation-badge ok';
  badge.innerText = err ? 'Errors' : 'Valid';
}

export function validateCurrentItemScoped() {
  if (!currentPack || !currentCategory || currentItemIndex === null) return;
  if (!isListCategory(currentCategory)) return;
  const key = itemKey(currentCategory, currentItemIndex);
  const had = itemValidationErrors.has(key);
  const err = itemProblemSummary(currentCategory, itemAt(currentCategory, currentItemIndex));
  if (err) itemValidationErrors.set(key, err);
  else itemValidationErrors.delete(key);
  paintValidationBadge(document.getElementById('validation-badge')!, key);
  if (had !== Boolean(err)) {
    renderMasterList();
    updateCategoryBadge(currentCategory);
  }
}

export function renderDetailForm(data: any, rootPath: (string|number)[]) {
  const container = document.getElementById('form-container')!;
  container.innerHTML = '';
  resetPendingSlots();
  const layout = layoutFor(currentCategory);
  const usable = isPlainObject(data);
  if (layout !== null && usable && (currentItemIndex !== null || layout.singleton === true)) {
    renderDesignedForm(layout, data, rootPath, container);
  } else {
    const form = document.createElement('div');
    renderRecursiveForm(data, rootPath, form);
    container.appendChild(form);
  }

  if (isJsonMode) {
    if (jsonDirty) {
      showToast('JSON edits discarded');
      setJsonDirty(false);
    }
    syncJsonTextarea();
  }
}

interface RecursiveFormOptions {
  bare?: boolean;
  hideKeys?: Set<string>;
}

function rerenderCurrentDetail() {
  if (!currentPack || !currentCategory) return;
  if (!isListCategory(currentCategory)) {
    renderDetailForm(currentPack.data[currentCategory], []);
    return;
  }
  if (currentItemIndex === null) return;
  renderDetailForm(itemAt(currentCategory, currentItemIndex), [currentItemIndex]);
}

// fallback renderer. no layout, or json that isn't a plain object, ends up here
export function renderRecursiveForm(data: any, path: (string|number)[], container: HTMLElement, opts?: RecursiveFormOptions) {
  if (data === null || data === undefined) {
    const p = document.createElement('p');
    p.innerText = 'null';
    container.appendChild(p);
    return;
  }
  
  if (Array.isArray(data)) {
    const listWrapper = document.createElement('div');
    listWrapper.className = 'array-list';
    data.forEach((item, idx) => {
      const itemWrapper = document.createElement('details');
      itemWrapper.className = 'array-item';
      
      const summary = document.createElement('summary');
      const named = item !== null && typeof item === 'object' ? asText(item.name) || asText(item.id) : '';
      summary.innerText = named !== '' ? named : `Item ${idx + 1}`;

      const actions = document.createElement('div');
      actions.className = 'array-item-header-actions';

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-delete-item';
      delBtn.innerText = '✕';
      delBtn.setAttribute('aria-label', 'Delete entry');
      delBtn.onclick = (e) => {
        e.preventDefault();
        void customConfirm('Delete this entry?').then((ok) => {
          if (!ok) return;
          data.splice(idx, 1);
          updateDataAt(path, data);
          rerenderCurrentDetail();
        });
      };
      
      actions.appendChild(delBtn);
      summary.appendChild(actions);
      wireDragReorder(itemWrapper, {
        index: idx,
        surface: arraySurfaceFor(path),
        source: summary,
        stopOnSource: true,
        stopOnTarget: true,
        onDrop: (from, after) => {
          if (!moveArrayItem(data, from, dropTargetIndex(from, idx, after))) return;
          updateDataAt(path, data);
          rerenderCurrentDetail();
        },
      });
      itemWrapper.appendChild(summary);

      const content = document.createElement('div');
      content.className = 'array-item-content';
      renderRecursiveForm(item, [...path, idx], content);

      itemWrapper.appendChild(content);
      listWrapper.appendChild(itemWrapper);
    });
    
    const arrayKey = path.length > 0 ? String(path[path.length - 1]) : '';
    const reRender = () => {
      updateDataAt(path, data);
      rerenderCurrentDetail();
    };

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add-field';
    addBtn.dataset.array = arrayKey;
    addBtn.innerText = '+ Add';
    addBtn.onclick = () => {
      if (currentCategory && COMPOSABLE_ARRAYS.has(arrayKey)) {
        void openEntryPicker(currentCategory, arrayKey, (entries) => {
          for (const entry of entries) data.push(entry);
          reRender();
        });
        return;
      }
      const newItem = data.length > 0 ? JSON.parse(JSON.stringify(data[data.length - 1])) : {};
      data.push(newItem);
      reRender();
    };
    
    container.appendChild(listWrapper);
    container.appendChild(addBtn);
  } else if (typeof data === 'object') {
    const bare = opts?.bare === true;
    const fs = document.createElement(path.length > 0 && !bare ? 'details' : 'div');
    fs.className = 'form-fieldset';

    if (path.length <= 1 && fs instanceof HTMLDetailsElement) {
      fs.open = true;
    }

    if (path.length > 0 && !bare) {
      const legend = document.createElement(fs instanceof HTMLDetailsElement ? 'summary' : 'div');
      legend.className = 'form-legend';
      legend.innerText = String(path[path.length - 1]);
      fs.appendChild(legend);
    }
    
    const hidden = opts?.hideKeys;
    const entries = Object.entries(data).filter(([key]) => hidden?.has(key) !== true).sort(([keyA, valA], [keyB, valB]) => {
      const rank = (k: string, v: unknown) => {
        if (k === 'id') return 1;
        if (k === 'name') return 2;
        if (k.includes('desc')) return 3;
        if (typeof v !== 'object') return 4;
        return 5;
      };
      return rank(keyA, valA) - rank(keyB, valB);
    });
    
    entries.forEach(([key, val]) => {
      const group = document.createElement('div');
      group.className = 'form-group';
      
      const label = document.createElement('label');
      label.className = 'form-label';
      label.innerText = key;
      const acts = document.createElement('span');
      acts.style.float = 'right';
      acts.style.opacity = '0.5';
      acts.innerHTML = '<button aria-label="Rename field" class="btn-rename">✎</button><button aria-label="Delete field" class="btn-del">✕</button>';
      acts.querySelector('.btn-rename')!.addEventListener('click', async (e) => {
        e.preventDefault();
        const res = await customPrompt('Rename field:', false);
        if (res?.value && res.value !== key && !(res.value in data)) {
          data[res.value] = data[key];
          delete data[key];
          updateDataAt(path, data);
          rerenderCurrentDetail();
        }
      });
      acts.querySelector('.btn-del')!.addEventListener('click', async (e) => {
        e.preventDefault();
        if (await customConfirm(`Delete field ${key}?`)) {
          delete data[key];
          updateDataAt(path, data);
          rerenderCurrentDetail();
        }
      });
      group.appendChild(label);
      if (path.length > 0) label.appendChild(acts);
      
      if (typeof val === 'object' && val !== null) {
        renderRecursiveForm(val, [...path, key], group);
      } else {
        const isLongText = typeof val === 'string' && (val.length > 50 || key.includes('desc'));
        const input = document.createElement(isLongText ? 'textarea' : 'input');
        if (input instanceof HTMLInputElement) {
          input.type = typeof val === 'number' ? 'number' : typeof val === 'boolean' ? 'checkbox' : 'text';
          if (typeof val === 'boolean') input.checked = val;
          else input.value = String(val);
        } else {
          input.className = 'form-textarea';
          input.value = String(val);
        }
        
        if (input instanceof HTMLInputElement && input.type !== 'checkbox') {
           input.className = 'form-input';
           const listId = suggestionListFor(path, key);
           if (listId) input.setAttribute('list', listId);
        }

        input.onchange = (e) => {
          const target = e.target as HTMLInputElement;
          let newVal: any = target.value;
          if (target.type === 'number') newVal = Number(target.value);
          if (target.type === 'checkbox') newVal = target.checked;
          updateDataAt([...path, key], newVal);
        };
        group.appendChild(input);
      }
      fs.appendChild(group);
    });
    
    const addFieldBtn = document.createElement('button');
    addFieldBtn.className = 'btn-add-field';
    addFieldBtn.innerText = '+ Add Field';
    addFieldBtn.onclick = async () => {
      const res = await customPrompt('New field name:', true, siblingKeySuggestions(path, data));
      const fieldName = res?.value;
      const fieldType = res?.type;
      if (fieldName && !(fieldName in data)) {
        let def: any = '';
        if (fieldType === 'number') def = 0;
        else if (fieldType === 'boolean') def = false;
        else if (fieldType === 'object') def = {};
        else if (fieldType === 'array') def = [];
        data[fieldName] = def;
        updateDataAt(path, data);
        rerenderCurrentDetail();
      }
    };
    fs.appendChild(addFieldBtn);
    container.appendChild(fs);
  } else {
    const group = document.createElement('div');
    group.className = 'form-group';
    if (path.length > 0) {
      const label = document.createElement('label');
      label.className = 'form-label';
      label.innerText = String(path[path.length - 1]);
      group.appendChild(label);
    }
    const input = document.createElement('input');
    input.className = 'form-input';
    input.value = String(data);
    input.onchange = (e) => {
      updateDataAt(path, (e.target as HTMLInputElement).value);
    };
    group.appendChild(input);
    container.appendChild(group);
  }
}

const PART_DEFAULTS: Record<string, any> = {
  effect: '',
  effects: '',
  description: '',
  detail: '',
  terse: '',
  mounted_effect: '',
  trigger: '',
  on_attack: '',
  on_hit: '',
  on_crit: '',
  icon: '',
  label: '',
  role: '',
  source: '',
  type: '',
  action_type: '',
  license: '',
  resource_name: '',
  resource_note: '',
  resource_cost: '',
  sp: 0,
  license_level: 1,
  accuracy: 0,
  attack_bonus: 0,
  consumable: false,
  hidden: false,
  filter_ignore: false,
  tags: [],
  damage: [],
  range: [],
  profiles: [],
  actions: [],
  deployables: [],
  synergies: [],
  traits: [],
  mounts: [],
  ranks: [],
  mechtype: [],
  base_features: [],
  optional_features: [],
  added_tags: [],
  added_damage: [],
  restricted_sizes: [],
  stats: {},
  core_system: {},
  info: {},
  pilot: {},
  mech: {},
};

const PART_SKIP_KEYS = new Set(['id', 'name']);

const COMPOSABLE_ARRAYS = new Set([
  'tags',
  'damage',
  'range',
  'profiles',
  'traits',
  'mounts',
  'actions',
  'ranks',
  'synergies',
  'deployables',
  'counters',
  'bonuses',
  'integrated',
  'base_features',
  'optional_features',
  'added_tags',
  'added_damage',
]);

export interface TagDef {
  id: string;
  name: string;
  description: string;
  hasVal: boolean;
}

export interface ItemRef {
  id: string;
  name: string;
  pack: string;
}

export let tagDefs = new Map<string, TagDef>();
export let itemRefs = new Map<string, Map<string, ItemRef>>();
let objectKeys = new Map<string, Map<string, Map<string, number>>>();

export function setTagDefs(value: Map<string, TagDef>) {
  tagDefs = value;
}

export function setItemRefs(value: Map<string, Map<string, ItemRef>>) {
  itemRefs = value;
}

export function setObjectKeys(value: Map<string, Map<string, Map<string, number>>>) {
  objectKeys = value;
}

export function harvestDraftItemRefs(draft: PackDraft, store: Map<string, Map<string, ItemRef>>) {
  const data = draft.data;
  const aggregated = new Set(npcAggregateFiles(draft));
  const bucket = (key: string) => {
    let byId = store.get(key);
    if (!byId) {
      byId = new Map<string, ItemRef>();
      store.set(key, byId);
    }
    return byId;
  };
  for (const cat of Object.keys(data)) {
    const items = data[cat];
    if (!Array.isArray(items)) continue;
    const byId = bucket(cat);
    for (const item of items) {
      if (!isPlainObject(item)) continue;
      const entry = item as any;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      if (id === '') continue;
      const ref = { id, name: typeof entry.name === 'string' ? entry.name : '', pack: draft.name };
      byId.set(id, ref);
      if (!aggregated.has(cat)) continue;
      const kind = npcKindOf(item);
      if (kind !== null) bucket(NPC_CATEGORY_BY_KIND[kind]).set(id, ref);
    }
  }
}

export function harvestTagDefs(draft: PackDraft, defs: Map<string, TagDef>) {
  const data = draft.data;
  const upsert = (id: string) => {
    let def = defs.get(id);
    if (!def) {
      def = { id, name: '', description: '', hasVal: false };
      defs.set(id, def);
    }
    return def;
  };

  const list = data['tags.json'];
  if (Array.isArray(list)) {
    for (const tag of list) {
      if (!tag || typeof tag !== 'object') continue;
      const entry = tag as any;
      if (typeof entry.id !== 'string' || !entry.id) continue;
      const def = upsert(entry.id);
      if (typeof entry.name === 'string' && entry.name) def.name = entry.name;
      if (typeof entry.description === 'string' && entry.description) def.description = entry.description;
      if (`${def.name}${def.description}`.includes('{VAL}')) def.hasVal = true;
    }
  }

  for (const cat of Object.keys(data)) {
    const items = data[cat];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const tags = (item as any).tags;
      if (!Array.isArray(tags)) continue;
      for (const usage of tags) {
        if (!usage || typeof usage !== 'object') continue;
        const id = (usage as any).id;
        if (typeof id !== 'string' || !id) continue;
        upsert(id);
      }
    }
  }
}

function harvestObjectKeys(value: any, sig: string, depth: number, store: Map<string, Map<string, number>>) {
  if (!isPlainObject(value) || depth >= DISPLAY_WALK_DEPTH) return;
  let byKey = store.get(sig);
  if (!byKey) {
    byKey = new Map<string, number>();
    store.set(sig, byKey);
  }
  for (const [key, child] of Object.entries(value)) {
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
    if (!child || typeof child !== 'object') continue;
    const childSig = sig ? `${sig}.${key}` : key;
    if (Array.isArray(child)) {
      for (const element of child) harvestObjectKeys(element, `${childSig}[]`, depth + 1, store);
    } else {
      harvestObjectKeys(child, childSig, depth + 1, store);
    }
  }
}

export function harvestDraftObjectKeys(draft: PackDraft, store: Map<string, Map<string, Map<string, number>>>) {
  const data = draft.data;
  for (const cat of Object.keys(data)) {
    const items = data[cat];
    if (!Array.isArray(items)) continue;
    let byPath = store.get(cat);
    if (!byPath) {
      byPath = new Map<string, Map<string, number>>();
      store.set(cat, byPath);
    }
    for (const item of items) harvestObjectKeys(item, '', 0, byPath);
  }
}

function pathSignature(path: (string | number)[]): string {
  const parts: string[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const segment = path[i];
    if (typeof segment === 'number') {
      if (parts.length > 0) parts[parts.length - 1] += '[]';
    } else {
      parts.push(String(segment));
    }
  }
  return parts.join('.');
}

function siblingKeySuggestions(path: (string | number)[], data: any): string[] {
  if (!currentCategory || !data || typeof data !== 'object') return [];
  const byPath = objectKeys.get(currentCategory);
  const counts = byPath?.get(pathSignature(path));
  if (!counts) return [];
  return Array.from(counts.entries())
    .filter(([key]) => !(key in data))
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}
const DONOR_CAP = 40; // picker crawls past this
const ENTRY_DONOR_CAP = 60; // entries are cheaper than whole shapes

interface DonorInstance {
  pack: string;
  item: string;
  value: any;
}

export interface PartInfo {
  count: number;
  donors: DonorInstance[];
}

let partsCatalog = new Map<string, Map<string, PartInfo>>();

export function setPartsCatalog(value: Map<string, Map<string, PartInfo>>) {
  partsCatalog = value;
}

export function harvestDraftParts(draft: PackDraft, catalog: Map<string, Map<string, PartInfo>>) {
  const data = draft.data;
  for (const cat of Object.keys(data)) {
    const items = data[cat];
    if (!Array.isArray(items)) continue;
    let byKey = catalog.get(cat);
    if (!byKey) {
      byKey = new Map<string, PartInfo>();
      catalog.set(cat, byKey);
    }
    for (const item of items) {
      if (!isPlainObject(item)) continue;
      const entry = item as any;
      const label =
        (typeof entry.name === 'string' && entry.name) || (typeof entry.id === 'string' && entry.id) || 'item';
      for (const [key, value] of Object.entries(entry)) {
        if (value === undefined || value === null || PART_SKIP_KEYS.has(key)) continue;
        let info = byKey.get(key);
        if (!info) {
          info = { count: 0, donors: [] };
          byKey.set(key, info);
        }
        info.count += 1;
        if (info.donors.length < DONOR_CAP) info.donors.push({ pack: draft.name, item: label, value });
      }
    }
  }
}

function partsFor(cat: string, item: any): { key: string; count: number }[] {
  const byKey = partsCatalog.get(cat);
  const out: { key: string; count: number }[] = [];
  const pushed = new Set<string>();
  const consider = (key: string) => {
    if (pushed.has(key) || PART_SKIP_KEYS.has(key) || key in item) return;
    pushed.add(key);
    out.push({ key, count: byKey?.get(key)?.count ?? 0 });
  };
  if (byKey) {
    const harvested = Array.from(byKey.entries()).sort((a, b) => b[1].count - a[1].count);
    for (const [key] of harvested) consider(key);
  }
  return out;
}

export function renderPartsStrip() {
  const strip = document.getElementById('parts-strip')!;
  strip.innerHTML = '';
  const hide = () => strip.classList.add('hidden');

  if (!currentPack || !currentCategory || currentCategory === 'lcp_manifest.json' || currentItemIndex === null || isJsonMode) {
    hide();
    return;
  }
  if (layoutFor(currentCategory) !== null) {
    hide();
    return;
  }
  if (!isListCategory(currentCategory)) {
    hide();
    return;
  }
  const item = itemAt(currentCategory, currentItemIndex);
  if (!isPlainObject(item)) {
    hide();
    return;
  }

  const parts = partsFor(currentCategory, item);
  if (parts.length === 0) {
    hide();
    return;
  }
  for (const part of parts) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'part-chip';
    chip.dataset.key = part.key;
    chip.innerHTML = `${esc(part.key)}${part.count > 0 ? `<span class="part-count">| ${part.count}</span>` : ''}`;
    chip.addEventListener('click', () => {
      void openPartPicker(part.key);
    });
    strip.appendChild(chip);
  }
  strip.classList.remove('hidden');
}

function zeroOf(value: any, depth = 0): any {
  if (Array.isArray(value)) {
    if (depth >= DISPLAY_WALK_DEPTH) return [];
    const first = value.find((entry) => entry !== undefined && entry !== null);
    return first === undefined ? [] : [zeroOf(first, depth + 1)];
  }
  if (value && typeof value === 'object') {
    if (depth >= DISPLAY_WALK_DEPTH) return {};
    const out: any = {};
    for (const [key, child] of Object.entries(value)) out[key] = zeroOf(child, depth + 1);
    return out;
  }
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  return '';
}

function shapeSignature(value: any, depth = 0): string {
  if (Array.isArray(value)) {
    const first = value.find((entry) => entry !== undefined && entry !== null);
    return `[${first === undefined || depth >= DISPLAY_WALK_DEPTH ? '' : shapeSignature(first, depth + 1)}]`;
  }
  if (value && typeof value === 'object') {
    if (depth >= DISPLAY_WALK_DEPTH) return '{}';
    return `{${Object.keys(value).sort().join(',')}}`;
  }
  return typeof value;
}

function donorsFor(cat: string, key: string): DonorInstance[] {
  return partsCatalog.get(cat)?.get(key)?.donors ?? [];
}

function entryDonorsFor(cat: string, key: string): DonorInstance[] {
  const out: DonorInstance[] = [];
  const seen = new Set<string>();
  for (const donor of donorsFor(cat, key)) {
    if (!Array.isArray(donor.value)) continue;
    for (const entry of donor.value) {
      if (entry === undefined || entry === null) continue;
      const sig = JSON.stringify(entry);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ pack: donor.pack, item: donor.item, value: entry });
      if (out.length >= ENTRY_DONOR_CAP) return out;
    }
  }
  return out;
}

function mostCommonShape(values: any[]): any {
  const tally = new Map<string, { count: number; value: any }>();
  for (const value of values) {
    const sig = shapeSignature(value);
    const prev = tally.get(sig);
    if (prev) prev.count += 1;
    else tally.set(sig, { count: 1, value });
  }
  let best: { count: number; value: any } | undefined;
  for (const entry of tally.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.value;
}

function zeroFromDonors(donors: { value: any }[]): any {
  if (donors.length === 0) return undefined;
  const common = mostCommonShape(donors.map((donor) => donor.value));
  return common === undefined ? undefined : zeroOf(common);
}

function emptyShapeFor(cat: string, key: string): any {
  const zero = zeroFromDonors(donorsFor(cat, key));
  if (zero !== undefined) return zero;
  const preset = PART_DEFAULTS[key];
  return preset === undefined ? '' : JSON.parse(JSON.stringify(preset));
}

function emptyEntryFor(cat: string, key: string): any {
  return zeroFromDonors(entryDonorsFor(cat, key)) ?? {};
}

function partKind(cat: string, key: string): 'vocab' | 'scalar' | 'structural' {
  if (key === 'tags') return 'vocab';
  const preset = PART_DEFAULTS[key];
  if (preset !== undefined) return preset !== null && typeof preset === 'object' ? 'structural' : 'scalar';
  const sample = donorsFor(cat, key).find((donor) => donor.value !== null && donor.value !== undefined);
  return sample && typeof sample.value === 'object' ? 'structural' : 'scalar';
}

export function clip(text: string, max = 72): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}

function summarize(value: any, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return clip(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (depth >= DISPLAY_WALK_DEPTH) return '';

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const entry of value.slice(0, 3)) {
      const text = summarize(entry, depth + 1);
      if (text) parts.push(text);
    }
    const extra = value.length > 3 ? ` +${value.length - 3}` : '';
    return parts.length > 0 ? clip(`${parts.join(' + ')}${extra}`) : `${value.length} entries`;
  }

  if (typeof value !== 'object') return '';
  const entry = value as Record<string, any>;
  const val = entry.val ?? entry.value;
  if ((typeof val === 'string' || typeof val === 'number') && typeof entry.type === 'string') {
    return clip(`${val} ${entry.type.toLowerCase()}`);
  }
  const name = typeof entry.name === 'string' && entry.name ? entry.name : '';
  if (name) {
    const damage = entry.damage !== undefined ? summarize(entry.damage, depth + 1) : '';
    const ranks = Array.isArray(entry.ranks) ? summarize(entry.ranks, depth + 1) : '';
    const detail = damage || ranks;
    return clip(detail ? `${name} - ${detail}` : name);
  }
  if (typeof entry.id === 'string' && entry.id) return clip(entry.id);
  const keys = Object.keys(entry).slice(0, 3);
  return keys.length > 0 ? clip(keys.join(', ')) : '';
}

async function applyPart(key: string, value: any) {
  if (!currentPack || !currentCategory || currentItemIndex === null) return;
  if (!(await confirmDiscardJsonEdits())) return;
  const item = itemAt(currentCategory, currentItemIndex);
  if (!item || typeof item !== 'object') return;
  item[key] = value;
  flushPackSave();
  validateCurrentPack();
  selectItem(currentItemIndex);
  renderPartsStrip();
}

function closePartPicker() {
  closeModal('part-picker');
}

function filterPartPicker() {
  const body = document.getElementById('part-picker-body')!;
  const input = document.getElementById('part-picker-filter') as HTMLInputElement;
  const needle = input.value.trim().toLowerCase();
  for (const row of Array.from(body.children)) {
    if (!(row instanceof HTMLElement)) continue;
    if (row.classList.contains('part-group')) continue;
    const hay = (row.dataset.search ?? row.textContent ?? '').toLowerCase();
    row.classList.toggle('hidden', needle !== '' && !hay.includes(needle));
  }
  let group: HTMLElement | null = null;
  let groupHasVisible = false;
  const closeGroup = () => {
    if (group) group.classList.toggle('hidden', !groupHasVisible);
  };
  for (const row of Array.from(body.children)) {
    if (!(row instanceof HTMLElement)) continue;
    if (row.classList.contains('part-group')) {
      closeGroup();
      group = row;
      groupHasVisible = false;
      continue;
    }
    if (!row.classList.contains('hidden')) groupHasVisible = true;
  }
  closeGroup();
}

function tagRow(id: string): HTMLElement {
  const def = tagDefFor(id);
  const row = document.createElement('label');
  row.className = 'part-check';
  row.dataset.search = `${id} ${def?.name ?? ''} ${def?.description ?? ''}`;
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.value = id;
  const text = document.createElement('span');
  text.className = 'part-check-text';
  const label = document.createElement('span');
  label.className = 'part-check-name';
  label.innerText = def?.name ? `${def.name} (${id})` : id;
  text.appendChild(label);
  const note = def?.description ? clip(def.description, 64) : '';
  if (note) {
    const sub = document.createElement('span');
    sub.className = 'part-check-note';
    sub.innerText = note;
    text.appendChild(sub);
  }
  row.appendChild(box);
  row.appendChild(text);
  return row;
}

export function tagEntryFor(id: string): any {
  return tagDefs.get(id)?.hasVal ? { id, val: 0 } : { id };
}

function donorOption(label: string, value: any, onPick: () => void, marker: string): HTMLElement {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'part-option';
  option.dataset.donor = marker;
  const title = document.createElement('span');
  title.innerText = label;
  option.appendChild(title);
  const summary = summarize(value);
  option.dataset.search = `${label} ${summary}`;
  if (summary) {
    const note = document.createElement('span');
    note.className = 'part-option-note';
    note.innerText = summary;
    option.appendChild(note);
  }
  option.addEventListener('click', onPick);
  return option;
}

async function openPicker(options: {
  title: string;
  cat: string;
  key: string;
  mode: 'section' | 'entry';
  apply: (value: any) => void;
}) {
  const { title, cat, key, mode, apply } = options;
  const kind = partKind(cat, key);

  const body = document.getElementById('part-picker-body')!;
  const confirm = document.getElementById('btn-part-confirm') as HTMLButtonElement;
  const filter = document.getElementById('part-picker-filter') as HTMLInputElement;
  document.getElementById('part-picker-title')!.innerText = title;
  body.innerHTML = '';
  confirm.classList.add('hidden');
  filter.value = '';

  if (kind === 'vocab') {
    const ids = referenceIndex.tagIds ?? [];
    if (ids.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'part-empty';
      empty.innerText = 'No tags in your library';
      body.appendChild(empty);
    }
    for (const id of ids) body.appendChild(tagRow(id));
    confirm.classList.remove('hidden');
    confirm.onclick = () => {
      const picked = Array.from(body.querySelectorAll('input:checked')).map((el) => (el as HTMLInputElement).value);
      apply(picked.map((id) => tagEntryFor(id)));
      closePartPicker();
    };
  } else {
    const donors = mode === 'entry' ? entryDonorsFor(cat, key) : donorsFor(cat, key);
    const blank = mode === 'entry' ? emptyEntryFor(cat, key) : emptyShapeFor(cat, key);
    body.appendChild(
      donorOption('Empty shape', blank, () => {
        apply(JSON.parse(JSON.stringify(blank)));
        closePartPicker();
      }, 'empty'),
    );

    const byPack = new Map<string, DonorInstance[]>();
    for (const donor of donors) {
      const list = byPack.get(donor.pack) ?? [];
      if (list.some((prev) => JSON.stringify(prev.value) === JSON.stringify(donor.value))) continue;
      list.push(donor);
      byPack.set(donor.pack, list);
    }
    for (const [pack, list] of byPack) {
      const group = document.createElement('div');
      group.className = 'part-group';
      group.innerText = pack;
      body.appendChild(group);
      for (const donor of list) {
        body.appendChild(
          donorOption(donor.item, donor.value, () => {
            apply(JSON.parse(JSON.stringify(donor.value)));
            closePartPicker();
          }, donor.item),
        );
      }
    }
  }

  showModal('part-picker');
  filter.focus();
}

async function openPartPicker(key: string) {
  if (!currentPack || !currentCategory || currentItemIndex === null) return;
  const cat = currentCategory;
  await freshReferenceIndex();
  if (partKind(cat, key) === 'scalar') {
    let value = PART_DEFAULTS[key];
    if (value === undefined) {
      const sample = donorsFor(cat, key).find((donor) => donor.value !== null && donor.value !== undefined);
      value = sample ? zeroOf(sample.value) : '';
    }
    await applyPart(key, value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value);
    return;
  }
  await openPicker({
    title: key,
    cat,
    key,
    mode: 'section',
    apply: (value) => { void applyPart(key, value); },
  });
}

async function openEntryPicker(cat: string, key: string, apply: (entries: any[]) => void) {
  await freshReferenceIndex();
  return openPicker({
    title: key,
    cat,
    key,
    mode: 'entry',
    apply: (value) => apply(Array.isArray(value) ? value : [value]),
  });
}

export function wirePartPicker() {
  document.getElementById('btn-part-cancel')!.addEventListener('click', closePartPicker);
  document.getElementById('part-picker-filter')!.addEventListener('input', filterPartPicker);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('part-picker')!.classList.contains('hidden')) closePartPicker();
  });
}

export async function addItemToCurrentCategory(item: any) {
  if (!currentPack || !currentCategory || !isListCategory(currentCategory)) return;
  if (!(await confirmDiscardJsonEdits())) return;
  const dt = standardListFor(currentCategory);
  dt.push(item);
  flushPackSave();
  validateCurrentPack();
  const landed = slotIndexOf(currentCategory, currentCategory, dt.length - 1);
  renderMasterList();
  updateCategoryBadge(currentCategory);
  selectItem(landed === -1 ? catCount(currentCategory) - 1 : landed);
}
