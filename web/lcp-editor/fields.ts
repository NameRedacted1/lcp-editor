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
  | 'bonusgrid'
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

export const NPC_BONUS_CELLS = [
  { key: 'hp', label: 'HP' },
  { key: 'armor', label: 'Armor' },
  { key: 'structure', label: 'Structure' },
  { key: 'stress', label: 'Stress' },
  { key: 'heatcap', label: 'Heat Cap' },
  { key: 'evasion', label: 'Evasion' },
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
  { key: 'attack', label: 'Attack Bonus' },
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
  { key: 'target', label: 'Target', kind: 'text', optional: true },
  { key: 'aoe', label: 'AoE', kind: 'checkbox', optional: true },
];

export const ADD_RESIST_COLUMNS: FieldSpec[] = [
  { key: 'immunity', label: 'Immunity', kind: 'text', optional: true },
  { key: 'resist', label: 'Resist', kind: 'text', optional: true },
  { key: 'resistance', label: 'Resistance', kind: 'text', optional: true },
  { key: 'vulnerable', label: 'Vulnerable', kind: 'text', optional: true },
  { key: 'target', label: 'Target', kind: 'text', optional: true },
  { key: 'duration', label: 'Duration', kind: 'text', optional: true },
  { key: 'aoe', label: 'AoE', kind: 'checkbox', optional: true },
];

export const ADD_SPECIAL_COLUMNS: FieldSpec[] = [
  { key: 'attribute', label: 'Attribute', kind: 'text', wide: true },
  { key: 'detail', label: 'Detail', kind: 'textarea', wide: true, optional: true },
  { key: 'target', label: 'Target', kind: 'text', optional: true },
  { key: 'duration', label: 'Duration', kind: 'text', optional: true },
  { key: 'aoe', label: 'AoE', kind: 'checkbox', optional: true },
];

export const ADD_OTHER_COLUMNS: FieldSpec[] = [
  { key: 'type', label: 'Type', kind: 'text' },
  { key: 'val', label: 'Value', kind: 'text' },
  { key: 'target', label: 'Target', kind: 'text', optional: true },
  { key: 'duration', label: 'Duration', kind: 'text', optional: true },
  { key: 'aoe', label: 'AoE', kind: 'checkbox', optional: true },
];

export const ADD_EFFECT_ROW_COLUMNS: FieldSpec[] = [
  { key: 'add_resist', label: 'Add Resist', kind: 'rows', wide: true, optional: true, addLabel: '+ Add Resist', columns: ADD_RESIST_COLUMNS },
  { key: 'add_special', label: 'Add Special', kind: 'rows', wide: true, optional: true, addLabel: '+ Add Special', columns: ADD_SPECIAL_COLUMNS },
  { key: 'add_other', label: 'Add Other', kind: 'rows', wide: true, optional: true, addLabel: '+ Add Other', columns: ADD_OTHER_COLUMNS },
];

export const ACTIVE_EFFECT_COLUMNS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'detail', label: 'Detail', kind: 'textarea', wide: true },
  { key: 'condition', label: 'Condition', kind: 'text', optional: true },
  { key: 'frequency', label: 'Frequency', kind: 'text', optional: true },
  { key: 'duration', label: 'Duration', kind: 'text', optional: true },
  { key: 'save', label: 'Save', kind: 'text', optional: true },
  { key: 'attack', label: 'Attack', kind: 'text', optional: true },
  { key: 'bonus_damage', label: 'Bonus Damage', kind: 'text', optional: true },
  { key: 'trigger', label: 'Trigger', kind: 'textarea', wide: true, optional: true },
  { key: 'damage', label: 'Damage', kind: 'damage', wide: true, addLabel: '+ Damage', optional: true },
  { key: 'range', label: 'Range', kind: 'range', wide: true, addLabel: '+ Range', optional: true },
  { key: 'add_status', label: 'Add Status', kind: 'rows', wide: true, optional: true, addLabel: '+ Add Status', columns: ADD_STATUS_COLUMNS },
  { key: 'remove_special', label: 'Remove Special', kind: 'stringlist', wide: true, optional: true, addLabel: '+ Remove Special' },
  ...ADD_EFFECT_ROW_COLUMNS,
];

export const ACTION_COLUMNS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'activation', label: 'Activation', kind: 'select', vocab: 'activations' },
  { key: 'trigger', label: 'Trigger', kind: 'textarea', wide: true, optional: true },
  { key: 'frequency', label: 'Frequency', kind: 'text', optional: true },
  { key: 'save', label: 'Save', kind: 'text', optional: true },
  { key: 'attack', label: 'Attack', kind: 'text', optional: true },
  { key: 'pilot', label: 'Pilot', kind: 'checkbox', optional: true },
  { key: 'mech', label: 'Mech', kind: 'checkbox', optional: true },
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
  { key: 'remove_special', label: 'Remove Special', kind: 'stringlist', wide: true, optional: true, addLabel: '+ Remove Special' },
  { key: 'active_effects', label: 'Active Effect', kind: 'rows', wide: true, optional: true, addLabel: '+ Active Effect', columns: ACTIVE_EFFECT_COLUMNS },
  ...ADD_EFFECT_ROW_COLUMNS,
];

export const DEPLOYABLE_COLUMNS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'type', label: 'Type', kind: 'text', optional: true },
  { key: 'activation', label: 'Activation', kind: 'select', vocab: 'activations', optional: true },
  { key: 'detail', label: 'Detail', kind: 'textarea', wide: true, optional: true },
  ...ADD_EFFECT_ROW_COLUMNS,
];

export const SYNERGY_COLUMNS: FieldSpec[] = [
  { key: 'locations', label: 'Locations', kind: 'chips', vocab: 'synergyLocations', wide: true, optional: true },
  { key: 'detail', label: 'Detail', kind: 'textarea', wide: true },
  { key: 'weapon_types', label: 'Weapon Types', kind: 'chips', vocab: 'weaponTypes', wide: true, optional: true },
  { key: 'weapon_sizes', label: 'Weapon Sizes', kind: 'chips', vocab: 'mounts', wide: true, optional: true },
  { key: 'system_types', label: 'System Types', kind: 'chips', vocab: 'systemTypes', wide: true, optional: true },
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
  { key: 'accuracy', label: 'Accuracy', kind: 'number', optional: true },
  { key: 'replace', label: 'Replace', kind: 'checkbox', optional: true },
  { key: 'overwrite', label: 'Overwrite', kind: 'checkbox', optional: true },
  { key: 'damage_types', label: 'Damage Types', kind: 'chips', vocab: 'damageTypes', wide: true, optional: true },
  { key: 'range_types', label: 'Range Types', kind: 'chips', vocab: 'rangeTypes', wide: true, optional: true },
  { key: 'weapon_types', label: 'Weapon Types', kind: 'chips', vocab: 'weaponTypes', wide: true, optional: true },
  { key: 'weapon_sizes', label: 'Weapon Sizes', kind: 'chips', vocab: 'mounts', wide: true, optional: true },
];

export const NAME_DESC_EXTRA_COLUMNS: FieldSpec[] = [
  ...NAME_DESC_COLUMNS,
  { key: 'actions', label: 'Action', kind: 'rows', wide: true, optional: true, addLabel: '+ Action', columns: ACTION_COLUMNS },
  { key: 'bonuses', label: 'Bonus', kind: 'rows', wide: true, optional: true, addLabel: '+ Bonus', columns: SYSTEM_BONUS_COLUMNS },
  { key: 'synergies', label: 'Synergy', kind: 'rows', wide: true, optional: true, addLabel: '+ Synergy', columns: SYNERGY_COLUMNS },
  { key: 'active_effects', label: 'Active Effect', kind: 'rows', wide: true, optional: true, addLabel: '+ Active Effect', columns: ACTIVE_EFFECT_COLUMNS },
  { key: 'deployables', label: 'Deployable', kind: 'rows', wide: true, optional: true, addLabel: '+ Deployable', columns: DEPLOYABLE_COLUMNS },
  { key: 'counters', label: 'Counter', kind: 'rows', wide: true, optional: true, addLabel: '+ Counter', columns: COUNTER_COLUMNS },
  { key: 'integrated', label: 'Integrated', kind: 'stringlist', wide: true, optional: true, addLabel: '+ Integrated' },
  { key: 'special_equipment', label: 'Special Equipment', kind: 'stringlist', wide: true, optional: true, addLabel: '+ Special Equipment' },
];

export const TALENT_RANK_COLUMNS: FieldSpec[] = [
  ...NAME_DESC_EXTRA_COLUMNS,
  { key: 'exclusive', label: 'Exclusive', kind: 'checkbox', optional: true },
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

export const BOND_QUESTION_COLUMNS: FieldSpec[] = [
  { key: 'question', label: 'Question', kind: 'textarea', wide: true },
  { key: 'options', label: 'Option', kind: 'stringlist', wide: true, optional: true, addLabel: '+ Option' },
];

export const BOND_POWER_COLUMNS: FieldSpec[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'description', label: 'Description', kind: 'textarea', wide: true },
  { key: 'frequency', label: 'Frequency', kind: 'text', optional: true },
  { key: 'prerequisite', label: 'Prerequisite', kind: 'textarea', wide: true, optional: true },
  { key: 'master', label: 'Master Power', kind: 'checkbox', optional: true },
  { key: 'veteran', label: 'Veteran Power', kind: 'checkbox', optional: true },
];
