// Helper-panel content for attributes (formulas.md §2.6, §4.3): example snippets per attribute type, single-value
// and multi-value. `_{attr}` stands for the focused attribute's chip and is replaced on click.
import type { Kind } from './types.ts';

export const ATTRIBUTE_PLACEHOLDER = '_{attr}';

export interface AttributeExamples {
  examples: string[];
  arrayExamples: string[];
}

const ARRAY_BASE = ['count(_{attr})', '_{attr}[0]'];

export const ATTRIBUTE_EXAMPLES: Record<Kind, AttributeExamples> = {
  text: { examples: ['length(_{attr})', 'contains(_{attr}, "Inc")', 'upper(_{attr})'], arrayExamples: ARRAY_BASE },
  number: { examples: ['round(_{attr}, 0)', '_{attr} * 12'], arrayExamples: ['sum(_{attr})', ...ARRAY_BASE] },
  checkbox: { examples: ['if(_{attr}, "Yes", "No")', '!_{attr}'], arrayExamples: ARRAY_BASE },
  currency: { examples: ['_{attr} * 1.1', 'round(_{attr}, 2)'], arrayExamples: ['sum(_{attr})', ...ARRAY_BASE] },
  date: {
    examples: ['dateDiff(_{attr}, today(), "days")', 'formatDate(_{attr}, "MMM yyyy")'],
    arrayExamples: ['max(_{attr})', ...ARRAY_BASE],
  },
  timestamp: {
    examples: ['dateDiff(_{attr}, now(), "hours")', 'formatDate(_{attr}, "yyyy-MM-dd HH:mm")'],
    arrayExamples: ['max(_{attr})', ...ARRAY_BASE],
  },
  rating: { examples: ['_{attr} >= 4', '_{attr} * 20'], arrayExamples: ARRAY_BASE },
  pipeline: { examples: ['_{attr} == "Won"', 'previousValue(_{attr})'], arrayExamples: ARRAY_BASE },
  select: { examples: ['contains(text(_{attr}), "Won")', 'previousValue(_{attr})'], arrayExamples: ARRAY_BASE },
  'entity-reference': { examples: ['text(_{attr})', '_{attr} != null'], arrayExamples: ARRAY_BASE },
  'actor-reference': { examples: ['_{attr}.text', '_{attr}.email_address'], arrayExamples: ARRAY_BASE },
  location: { examples: ['_{attr}.locality', '_{attr}.country_code'], arrayExamples: ARRAY_BASE },
  domain: { examples: ['upper(_{attr})', 'endsWith(_{attr}, ".com")'], arrayExamples: ARRAY_BASE },
  'email-address': { examples: ['_{attr}.email_domain', 'lower(_{attr})'], arrayExamples: ARRAY_BASE },
  'phone-number': { examples: ['_{attr}.normalized_phone_number'], arrayExamples: ARRAY_BASE },
  interaction: { examples: ['_{attr} != null'], arrayExamples: ARRAY_BASE },
  'personal-name': { examples: ['_{attr}.first_name', 'upper(_{attr}.last_name)'], arrayExamples: ARRAY_BASE },
};
