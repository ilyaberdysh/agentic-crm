// Object icons (J objects-lists §2): an icon from our set plus one of nine colours, chosen in the create dialog
// (random preselection) and on the Configuration tab. Stored in `entity_definitions.icon` as `icon:<name>:<colour>`
// (Attio stores `{type:"attio", id, color}`; we keep one string). Standard objects keep their fixed tiles.
import type { Hue, IconName } from '@agentic-crm/ui';
import type { ObjectSummary } from '../../../data/objects';
import { objectAppearance } from '../../shell/objectAppearance';

/** Swatch order of the colour menu (J objects-lists §2). */
export const OBJECT_COLORS = ['blue', 'green', 'grey', 'pink', 'orange', 'purple', 'red', 'cyan', 'yellow'] as const;
export type ObjectColor = (typeof OBJECT_COLORS)[number];

/** Icons offered by the picker, with search keywords (our own glyph set; Attio's icons are never copied). */
export const OBJECT_ICONS: ReadonlyArray<{ name: IconName; keywords: string }> = [
  { name: 'object', keywords: 'box cube package product' },
  { name: 'objects', keywords: 'boxes inventory stock' },
  { name: 'company', keywords: 'building office organisation' },
  { name: 'person', keywords: 'person contact human' },
  { name: 'people', keywords: 'people team group' },
  { name: 'deal', keywords: 'deal handshake agreement' },
  { name: 'user', keywords: 'user account' },
  { name: 'workspace', keywords: 'briefcase work job' },
  { name: 'member', keywords: 'member avatar' },
  { name: 'list', keywords: 'list layout' },
  { name: 'record', keywords: 'file record' },
  { name: 'document', keywords: 'document page text' },
  { name: 'template', keywords: 'notebook template' },
  { name: 'notes', keywords: 'note sticky' },
  { name: 'tasks', keywords: 'task todo check' },
  { name: 'todo', keywords: 'todo checklist' },
  { name: 'meeting', keywords: 'video meeting call' },
  { name: 'recording', keywords: 'mic audio podcast' },
  { name: 'calls', keywords: 'phone call' },
  { name: 'emails', keywords: 'mail email letter' },
  { name: 'send', keywords: 'send paper plane' },
  { name: 'chat', keywords: 'chat message' },
  { name: 'comment', keywords: 'comment bubble' },
  { name: 'notifications', keywords: 'bell alert' },
  { name: 'inbox', keywords: 'inbox tray' },
  { name: 'calendarAdd', keywords: 'calendar event schedule' },
  { name: 'attrDate', keywords: 'calendar date' },
  { name: 'clock', keywords: 'time clock' },
  { name: 'history', keywords: 'history time' },
  { name: 'target', keywords: 'target goal objective' },
  { name: 'rocket', keywords: 'rocket launch ship' },
  { name: 'favorite', keywords: 'star favourite' },
  { name: 'like', keywords: 'heart like love' },
  { name: 'plans', keywords: 'gift present' },
  { name: 'billing', keywords: 'credit card payment' },
  { name: 'attrCurrency', keywords: 'dollar money price' },
  { name: 'reports', keywords: 'chart bar report' },
  { name: 'dashboards', keywords: 'pie chart' },
  { name: 'calculation', keywords: 'calculator math' },
  { name: 'workflows', keywords: 'workflow flow' },
  { name: 'automations', keywords: 'zap lightning' },
  { name: 'askAi', keywords: 'sparkles ai magic' },
  { name: 'bot', keywords: 'bot robot' },
  { name: 'developers', keywords: 'code developer' },
  { name: 'database', keywords: 'database data' },
  { name: 'cloud', keywords: 'cloud storage' },
  { name: 'integrations', keywords: 'plug integration' },
  { name: 'puzzle', keywords: 'puzzle piece' },
  { name: 'apps', keywords: 'grid apps' },
  { name: 'security', keywords: 'shield security' },
  { name: 'lock', keywords: 'lock private' },
  { name: 'key', keywords: 'key access' },
  { name: 'support', keywords: 'headset support' },
  { name: 'home', keywords: 'house home' },
  { name: 'attrLocation', keywords: 'pin map location' },
  { name: 'attrDomain', keywords: 'globe web world' },
  { name: 'link', keywords: 'link chain' },
  { name: 'folder', keywords: 'folder directory' },
  { name: 'image', keywords: 'image picture photo' },
  { name: 'attach', keywords: 'paperclip attachment' },
  { name: 'attrMultiSelect', keywords: 'tag label' },
  { name: 'table', keywords: 'table grid' },
  { name: 'kanban', keywords: 'kanban board' },
  { name: 'settings', keywords: 'gear settings' },
];

const ICON_NAMES = new Set<string>(OBJECT_ICONS.map((i) => i.name));

export interface ObjectIconValue {
  icon: IconName;
  color: ObjectColor;
}

export function encodeObjectIcon(value: ObjectIconValue): string {
  return `icon:${value.icon}:${value.color}`;
}

export function decodeObjectIcon(raw: string | null | undefined): ObjectIconValue | null {
  if (!raw) return null;
  const m = /^icon:([A-Za-z0-9]+):([a-z]+)$/.exec(raw);
  if (!m) return null;
  const [, icon, color] = m as unknown as [string, string, string];
  if (!ICON_NAMES.has(icon) || !(OBJECT_COLORS as readonly string[]).includes(color)) return null;
  return { icon: icon as IconName, color: color as ObjectColor };
}

/** The dialog opens with a random icon and colour (observed: differs between openings). */
export function randomObjectIcon(random: () => number = Math.random): ObjectIconValue {
  const icon = OBJECT_ICONS[Math.floor(random() * OBJECT_ICONS.length)]?.name ?? 'object';
  const color = OBJECT_COLORS[Math.floor(random() * OBJECT_COLORS.length)] ?? 'blue';
  return { icon, color };
}

export function searchObjectIcons(query: string): IconName[] {
  const q = query.trim().toLowerCase();
  if (!q) return OBJECT_ICONS.map((i) => i.name);
  return OBJECT_ICONS.filter((i) => i.keywords.includes(q) || i.name.toLowerCase().includes(q)).map((i) => i.name);
}

/** Tile of an object anywhere in settings: its chosen icon, else the standard tile (grey box for custom). */
export function objectTile(object: Pick<ObjectSummary, 'entityType' | 'standardObjectType' | 'icon'>): {
  icon: IconName;
  color: Hue;
} {
  const chosen = decodeObjectIcon(object.icon);
  if (chosen && object.entityType === 'custom-record') return chosen;
  return objectAppearance(object);
}
