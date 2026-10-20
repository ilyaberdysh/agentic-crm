// Prompt icons (ask-agentic §2.3, §11.2): a prompt has an icon id and a colour; its tile is the icon on a pastel square.
// Curated prompts use the ids below; the icon picker of "Create prompt" offers the same set.
import type { IconName } from '@agentic-crm/ui';

export const PROMPT_ICONS: Record<string, IconName> = {
  search: 'search',
  'student-hat': 'graduationCap',
  'dollar-circle': 'circleDollar',
  suitcase: 'suitcase',
  checkbox: 'tasks',
  mic: 'recording',
  'sign-left-right': 'signpost',
  bubble: 'bubbleDots',
  handshake: 'deal',
  lightning: 'automations',
  rocket: 'rocket',
  calendar: 'calendar',
  'chart-arrow-up': 'trendingUp',
  sun: 'themeLight',
  email: 'emails',
  wand: 'wand',
  brain: 'brain',
  flame: 'flame',
  megaphone: 'megaphone',
  newspaper: 'newspaper',
  book: 'bookOpen',
  package: 'package',
  palette: 'palette',
  compass: 'compass',
  crown: 'crown',
  gem: 'gem',
  coffee: 'coffee',
  clipboard: 'clipboardList',
  cart: 'shoppingCart',
  truck: 'truck',
  people: 'people',
  company: 'company',
  chart: 'dashboards',
  globe: 'attrDomain',
  idea: 'teamIdea',
  target: 'target',
};

export const PROMPT_COLORS = ['blue', 'green', 'purple', 'orange', 'yellow', 'pink', 'cyan', 'red', 'grey'] as const;
export type PromptColor = (typeof PROMPT_COLORS)[number];

export const DEFAULT_PROMPT_ICON = 'bubble';

/** The glyph of a prompt icon id (unknown or missing ids fall back to the chat bubble). */
export function promptIcon(iconId: string | null | undefined): IconName {
  return PROMPT_ICONS[iconId ?? DEFAULT_PROMPT_ICON] ?? 'bubbleDots';
}

export function promptColor(color: string | null | undefined): PromptColor {
  return (PROMPT_COLORS as readonly string[]).includes(color ?? '') ? (color as PromptColor) : 'blue';
}
