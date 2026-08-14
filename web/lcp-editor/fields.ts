export type VocabKey =
  | 'mounts'
  | 'weaponTypes'
  | 'damageTypes'
  | 'rangeTypes'
  | 'systemTypes'
  | 'mechTypes'
  | 'featureTypes'
  | 'activations'
  | 'statusTypes'
  | 'reserveTypes'
  | 'gearTypes'
  | 'npcRoles'
  | 'memeticTypes'
  | 'sources'
  | 'licenses'
  | 'bonusIds'
  | 'statusIds'
  | 'talentIds'
  | 'synergyLocations';

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'id'
  | 'damage'
  | 'range'
  | 'tags'
  | 'chips'
  | 'rows'
  | 'stringlist'
  | 'stats'
  | 'tiers'
  | 'tierscalar'
  | 'count'
  | 'derived'
  | 'origin'
  | 'group'
  | 'format';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  vocab?: VocabKey;
  list?: VocabKey;
  optional?: boolean;
  tiered?: boolean;
  min?: number;
  max?: number;
  wide?: boolean;
  addLabel?: string;
  columns?: FieldSpec[];
  cells?: { key: string; label: string }[];
  fields?: FieldSpec[];
  rowSeed?: (owner: any) => any;
  rowKey?: string;
  rowIdBase?: (owner: any, name: string) => string;
}

interface SectionSpec {
  title: string;
  fields: FieldSpec[];
}

export interface ReferenceBlock {
  title: string;
  rows: string[];
}

export interface LayoutSpec {
  prefix: string;
  singleton?: boolean;
  sections: SectionSpec[];
  reference?: ReferenceBlock[];
  derivedKeys?: string[];
}

export const NPC_STAT_CELLS = [
  { key: 'hp', label: 'HP' },
  { key: 'armor', label: 'Armor' },
  { key: 'structure', label: 'Structure' },
  { key: 'stress', label: 'Stress' },
  { key: 'heatcap', label: 'Heat Cap' },
  { key: 'evade', label: 'Evade' },
  { key: 'edef', label: 'E-Defense' },
  { key: 'speed', label: 'Speed' },
  { key: 'sensor', label: 'Sensors' },
  { key: 'save', label: 'Save' },
  { key: 'hull', label: 'Hull' },
  { key: 'agility', label: 'Agility' },
  { key: 'systems', label: 'Systems' },
  { key: 'engineering', label: 'Engineering' },
  { key: 'size', label: 'Size' },
  { key: 'activations', label: 'Activations' },
];

const STAT_LABEL_OVERRIDES: Record<string, string> = {
  hp: 'HP',
  sp: 'SP',
  edef: 'E-Defense',
  evade: 'Evade',
  heatcap: 'Heat Cap',
  repcap: 'Repair Cap',
  sensor: 'Sensors',
  sensor_range: 'Sensors',
  tech_attack: 'Tech Attack',
};

export function humanizeKey(key: string): string {
  const override = STAT_LABEL_OVERRIDES[key];
  if (override !== undefined) return override;
  return key
    .split(/[_\s]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export const IDENTITY_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'id', label: 'ID', kind: 'id' },
  { key: 'source', label: 'Source', kind: 'text', list: 'sources' },
  { key: 'license', label: 'License', kind: 'text', list: 'licenses' },
  { key: 'license_id', label: 'License ID', kind: 'text', optional: true },
  { key: 'license_level', label: 'License Level', kind: 'number', min: 0, max: 3 },
];

export const V2_FRAME_STAT_CELLS = [
  { key: 'size', label: 'Size' },
  { key: 'hp', label: 'HP' },
  { key: 'armor', label: 'Armor' },
  { key: 'evasion', label: 'Evasion' },
  { key: 'edef', label: 'E-Defense' },
  { key: 'heatcap', label: 'Heat Cap' },
  { key: 'repcap', label: 'Repair Cap' },
  { key: 'sensor_range', label: 'Sensors' },
  { key: 'tech_attack', label: 'Tech Attack' },
  { key: 'save', label: 'Save' },
  { key: 'speed', label: 'Speed' },
  { key: 'sp', label: 'SP' },
];

export const FRAME_STAT_CELLS = [
  { key: 'size', label: 'Size' },
  { key: 'structure', label: 'Structure' },
  { key: 'stress', label: 'Stress' },
  { key: 'hp', label: 'HP' },
  { key: 'armor', label: 'Armor' },
  { key: 'evasion', label: 'Evasion' },
  { key: 'edef', label: 'E-Defense' },
  { key: 'heatcap', label: 'Heat Cap' },
  { key: 'repcap', label: 'Repair Cap' },
  { key: 'sensor_range', label: 'Sensors' },
  { key: 'tech_attack', label: 'Tech Attack' },
  { key: 'save', label: 'Save' },
  { key: 'speed', label: 'Speed' },
  { key: 'sp', label: 'SP' },
];

export const NAME_DESC_COLUMNS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'description', label: 'Description', kind: 'textarea', wide: true },
];

export const ADD_STATUS_COLUMNS: FieldSpec[] = [
  { key: 'id', label: 'Status', kind: 'text', list: 'statusIds' },
  { key: 'duration', label: 'Duration', kind: 'text', optional: true },
  { key: 'save', label: 'Save', kind: 'text', optional: true },
];

export const ACTION_COLUMNS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'activation', label: 'Activation', kind: 'select', vocab: 'activations' },
  { key: 'trigger', label: 'Trigger', kind: 'textarea', wide: true, optional: true },
  { key: 'frequency', label: 'Frequency', kind: 'text', optional: true },
  { key: 'detail', label: 'Detail', kind: 'textarea', wide: true },
  { key: 'damage', label: 'Damage', kind: 'damage', wide: true, addLabel: '+ Damage', optional: true },
  { key: 'range', label: 'Range', kind: 'range', wide: true, addLabel: '+ Range', optional: true },
  {
    key: 'add_status',
    label: 'Add Status',
    kind: 'rows',
    wide: true,
    optional: true,
    addLabel: '+ Add Status',
    columns: ADD_STATUS_COLUMNS,
  },
];

export const DEPLOYABLE_COLUMNS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'type', label: 'Type', kind: 'text', optional: true },
  { key: 'activation', label: 'Activation', kind: 'select', vocab: 'activations', optional: true },
  { key: 'detail', label: 'Detail', kind: 'textarea', wide: true, optional: true },
];

export const SYNERGY_COLUMNS: FieldSpec[] = [
  { key: 'locations', label: 'Locations', kind: 'chips', vocab: 'synergyLocations', wide: true, optional: true },
  { key: 'detail', label: 'Detail', kind: 'textarea', wide: true },
];

export const WEAPON_PROFILE_COLUMNS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'damage', label: 'Damage', kind: 'damage', wide: true, addLabel: '+ Damage', optional: true },
  { key: 'range', label: 'Range', kind: 'range', wide: true, addLabel: '+ Range', optional: true },
  { key: 'effect', label: 'Effect', kind: 'textarea', wide: true, optional: true },
  { key: 'on_attack', label: 'On Attack', kind: 'textarea', wide: true, optional: true },
  { key: 'on_hit', label: 'On Hit', kind: 'textarea', wide: true, optional: true },
  { key: 'on_crit', label: 'On Crit', kind: 'textarea', wide: true, optional: true },
  { key: 'tags', label: 'Tags', kind: 'tags', wide: true, optional: true },
];

export const COUNTER_COLUMNS: FieldSpec[] = [
  { key: 'id', label: 'ID', kind: 'text' },
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'min', label: 'Min', kind: 'number', optional: true },
  { key: 'max', label: 'Max', kind: 'number', optional: true },
  { key: 'default_value', label: 'Default', kind: 'number', optional: true },
];

export const SYSTEM_BONUS_COLUMNS: FieldSpec[] = [
  { key: 'id', label: 'ID', kind: 'text', list: 'bonusIds' },
  { key: 'val', label: 'Value', kind: 'text' },
];

export const ACTIVE_EFFECT_COLUMNS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'detail', label: 'Detail', kind: 'textarea', wide: true },
];

export const NAME_DESC_EXTRA_COLUMNS: FieldSpec[] = [
  ...NAME_DESC_COLUMNS,
  { key: 'actions', label: 'Action', kind: 'rows', wide: true, optional: true, addLabel: '+ Action', columns: ACTION_COLUMNS },
  { key: 'bonuses', label: 'Bonus', kind: 'rows', wide: true, optional: true, addLabel: '+ Bonus', columns: SYSTEM_BONUS_COLUMNS },
  { key: 'synergies', label: 'Synergy', kind: 'rows', wide: true, optional: true, addLabel: '+ Synergy', columns: SYNERGY_COLUMNS },
  { key: 'active_effects', label: 'Active Effect', kind: 'rows', wide: true, optional: true, addLabel: '+ Active Effect', columns: ACTIVE_EFFECT_COLUMNS },
];

export const TABLE_RESULT_COLUMNS: FieldSpec[] = [
  { key: 'min', label: 'Min', kind: 'number' },
  { key: 'max', label: 'Max', kind: 'number' },
  { key: 'title', label: 'Title', kind: 'text', wide: true },
  { key: 'result', label: 'Result', kind: 'textarea', wide: true },
];

export const DOWNTIME_RESULT_COLUMNS: FieldSpec[] = [
  { key: 'min', label: 'Min', kind: 'number' },
  { key: 'max', label: 'Max', kind: 'number' },
  { key: 'text', label: 'Text', kind: 'textarea', wide: true },
];

export const BOND_POWER_COLUMNS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'description', label: 'Description', kind: 'textarea', wide: true },
  { key: 'frequency', label: 'Frequency', kind: 'text', optional: true },
  { key: 'prerequisite', label: 'Prerequisite', kind: 'textarea', wide: true, optional: true },
  { key: 'master', label: 'Master Power', kind: 'checkbox', optional: true },
  { key: 'veteran', label: 'Veteran Power', kind: 'checkbox', optional: true },
];
