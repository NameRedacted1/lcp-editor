import { asText, isPlainObject } from './forms.js';

export const V2_FEATURE_TYPES = ['Trait', 'System', 'Reaction', 'Weapon', 'Tech'];

const V2_FEATURE_TYPES_LOWER = new Set(V2_FEATURE_TYPES.map((type) => type.toLowerCase()));

export function isFeatureType(value: unknown): boolean {
  return V2_FEATURE_TYPES_LOWER.has(asText(value).trim().toLowerCase());
}

const V2_FEATURE_TYPE_SET = new Set(V2_FEATURE_TYPES);

export const V2_FOLDED_FEATURE_KEYS = ['on_crit', 'add_status', 'attacks', 'detail', 'on_attack'];

export const V2_TIER_CELLS = 3;

const V2_STAT_KEYS = new Set([
  'activations',
  'agility',
  'armor',
  'edef',
  'engineering',
  'evade',
  'heatcap',
  'hp',
  'hull',
  'save',
  'sensor',
  'size',
  'sizes',
  'speed',
  'stress',
  'structure',
  'systems',
]);

function v2StatId(id: string): string {
  if (V2_STAT_KEYS.has(id)) return id;
  const squashed = id.replace(/_/g, '');
  return V2_STAT_KEYS.has(squashed) ? squashed : id;
}

export function v2TierValue(value: unknown): unknown {
  if (typeof value === 'number' || typeof value === 'string') {
    return Array.from({ length: V2_TIER_CELLS }, () => value);
  }
  if (!Array.isArray(value) || value.length === 0 || value.length >= V2_TIER_CELLS) return value;
  const filled = [...value];
  while (filled.length < V2_TIER_CELLS) filled.push(filled[filled.length - 1]);
  return filled;
}

export function v2FeatureType(value: unknown): string {
  const text = asText(value).trim();
  return V2_FEATURE_TYPE_SET.has(text) ? text : 'Trait';
}

export function v2TierCells(value: unknown): unknown {
  const filled = v2TierValue(value);
  if (!Array.isArray(filled)) return filled;
  if (filled.length === 0) return Array.from({ length: V2_TIER_CELLS }, () => 0);
  return filled.length > V2_TIER_CELLS ? filled.slice(0, V2_TIER_CELLS) : filled;
}

function v2Tags(value: unknown): any[] {
  if (!Array.isArray(value)) return [];
  const out: any[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    const id = asText((entry as any).id).trim();
    if (id === '') continue;
    const tag: any = { id };
    const val = (entry as any).val;
    if (val !== undefined) tag.val = val;
    out.push(tag);
  }
  return out;
}

function v2ValueRows(value: unknown, key: string): any[] {
  if (!Array.isArray(value)) return [];
  const out: any[] = [];
  for (const row of value) {
    if (!isPlainObject(row)) continue;
    const amount = (row as any)[key] ?? (row as any).val ?? (row as any).damage;
    if (amount === undefined) continue;
    out.push({ type: asText((row as any).type), [key]: JSON.parse(JSON.stringify(amount)) });
  }
  return out;
}

export function v2StatusText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  const names = value
    .map((entry) => (entry !== null && typeof entry === 'object' ? asText((entry as any).id) : asText(entry)))
    .filter((id) => id !== '');
  return names.length === 0 ? '' : `Status: ${names.join(', ')}.`;
}

export function v2OnHit(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!isPlainObject(value)) return '';
  return [asText((value as any).detail), v2StatusText((value as any).add_status)]
    .filter((part) => part.trim() !== '')
    .join(' ');
}

export function v2DamageText(value: unknown): string {
  const parts: string[] = [];
  for (const row of Array.isArray(value) ? value : []) {
    if (!isPlainObject(row)) continue;
    const cell = (row as any).damage ?? (row as any).val;
    if (cell === undefined || cell === null) continue;
    const amount = Array.isArray(cell) ? cell.join('/') : asText(cell);
    const label = [amount, asText((row as any).type)].filter((part) => part !== '').join(' ');
    const area = asText((row as any).aoe).trim();
    parts.push(area === '' ? label : `${label} (${area})`);
  }
  return parts.length === 0 ? '' : `Damage: ${parts.join(', ')}.`;
}

function v2AttacksText(value: unknown): string {
  const count = typeof value === 'number' ? value : Number(asText(value));
  return Number.isFinite(count) && count > 1 ? `Attacks: ${count}.` : '';
}

export function v2EffectText(feature: any, type: string): string {
  const effect = asText(feature.effect);
  const parts = [effect, asText(feature.detail)];
  const onAttack = asText(feature.on_attack).trim();
  if (onAttack !== '') parts.push(`On attack: ${onAttack}`);
  for (const action of Array.isArray(feature.actions) ? feature.actions : []) {
    if (action === null || typeof action !== 'object') continue;
    const label = [asText(action.name), asText(action.activation)].filter((part) => part !== '').join(' - ');
    const detail = asText(action.detail);
    const restatesEffect = detail.trim() !== '' && detail.trim() === effect.trim();
    parts.push(restatesEffect ? label : [label, detail].filter((part) => part !== '').join(': '));
  }
  parts.push(asText(feature.on_crit));
  parts.push(v2StatusText(feature.add_status));
  parts.push(type === 'Weapon' ? v2AttacksText(feature.attacks) : v2DamageText(feature.damage));
  return parts.filter((part) => part.trim() !== '').join('<br>');
}

export function v2Bonuses(value: unknown): { bonus?: any; override?: any } {
  const bonus: any = {};
  const overrides: any = {};
  for (const row of Array.isArray(value) ? value : []) {
    if (!isPlainObject(row)) continue;
    const id = asText((row as any).id).trim();
    if (id === '') continue;
    const target = (row as any).override === true ? overrides : bonus;
    target[v2StatId(id)] = (row as any).val;
  }
  const out: { bonus?: any; override?: any } = {};
  if (Object.keys(bonus).length > 0) out.bonus = bonus;
  if (Object.keys(overrides).length > 0) out.override = overrides;
  return out;
}

function v2FeatureFields(feature: any, origin: any): any {
  const type = v2FeatureType(feature.type);
  const out: any = {
    id: asText(feature.id),
    name: asText(feature.name),
    origin,
    locked: false,
    type,
    effect: v2EffectText(feature, type),
    tags: v2Tags(feature.tags),
  };
  if (feature.trigger !== undefined && feature.trigger !== null) out.trigger = asText(feature.trigger);
  if (type === 'Weapon') {
    out.weapon_type = asText(feature.weapon_type);
    out.attack_bonus = v2TierCells(feature.attack_bonus ?? 0);
    if (feature.accuracy !== undefined && feature.accuracy !== null) out.accuracy = v2TierCells(feature.accuracy);
    const damage = v2ValueRows(feature.damage, 'damage');
    for (const row of damage) row.damage = v2TierCells(row.damage);
    out.damage = damage;
    out.range = v2ValueRows(feature.range, 'val');
    out.on_hit = v2OnHit(feature.on_hit);
  }
  if (type === 'Tech') {
    if (feature.tech_type !== undefined && feature.tech_type !== null) out.tech_type = asText(feature.tech_type);
    if (feature.attack_bonus !== undefined && feature.attack_bonus !== null) {
      out.attack_bonus = v2TierCells(feature.attack_bonus);
    }
    if (feature.accuracy !== undefined && feature.accuracy !== null) out.accuracy = v2TierCells(feature.accuracy);
  }
  const bonuses = v2Bonuses(feature.bonuses);
  if (bonuses.bonus !== undefined) out.bonus = bonuses.bonus;
  if (bonuses.override !== undefined) out.override = bonuses.override;
  return out;
}

export function v2Feature(feature: any, owner: { name: string; kind: string } | undefined, base: boolean): any {
  const origin = {
    type: owner === undefined ? 'Class' : owner.kind,
    name: owner === undefined ? '' : owner.name,
    base,
  };
  return v2FeatureFields(feature, origin);
}

export function v2Stats(stats: any): any {
  const out: any = {};
  for (const [key, value] of Object.entries(stats ?? {})) {
    if (key === 'structure' || key === 'stress') continue;
    const cells = Array.isArray(value) ? [...value] : [value, value, value];
    while (cells.length < 3) cells.push(cells[cells.length - 1]);
    out[key] = key === 'size' ? cells.map((cell) => (Array.isArray(cell) ? [...cell] : [cell])) : cells;
  }
  return out;
}
