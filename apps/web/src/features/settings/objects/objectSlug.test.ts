import { describe, expect, it } from 'vitest';
import { decodeObjectIcon, encodeObjectIcon, randomObjectIcon, searchObjectIcons } from './objectIcon';
import { isValidApiSlug, slugConfirmationPhrase, slugFromNoun, validateCreateObject } from './objectSlug';

describe('object slug', () => {
  it('derives the slug from the plural noun (J objects-lists §2)', () => {
    expect(slugFromNoun('[seed] J Widgets')).toBe('seed_j_widgets');
    expect(slugFromNoun('  Products  ')).toBe('products');
    expect(slugFromNoun('Café — Orders!')).toBe('cafe_orders');
    expect(slugFromNoun('')).toBe('');
  });

  it('accepts lower-case letters, digits and underscores with a leading letter', () => {
    expect(isValidApiSlug('seed_j_widgets')).toBe(true);
    expect(isValidApiSlug('Products')).toBe(false);
    expect(isValidApiSlug('1st')).toBe(false);
    expect(isValidApiSlug('a-b')).toBe(false);
  });

  it('validates the create dialog with the observed copy', () => {
    expect(validateCreateObject({ pluralNoun: '', singularNoun: ' ', apiSlug: '' })).toEqual({
      pluralNoun: 'Please provide a plural noun for this object.',
      singularNoun: 'Please provide a singular noun for this object.',
      apiSlug: 'Please provide a unique slug for this object.',
    });
    expect(validateCreateObject({ pluralNoun: 'Products', singularNoun: 'Product', apiSlug: 'Pro ducts' })).toEqual({
      apiSlug: 'Please ensure your slug is lowercase and contains only letters, numbers, and underscores.',
    });
    expect(validateCreateObject({ pluralNoun: 'Products', singularNoun: 'Product', apiSlug: 'products' })).toEqual({});
  });

  it('builds the type-to-confirm phrase', () => {
    expect(slugConfirmationPhrase('seed_j_widgets')).toBe('Integrations using "seed_j_widgets" may be affected');
  });
});

describe('object icon', () => {
  it('round-trips the stored icon string', () => {
    const v = { icon: 'deal' as const, color: 'orange' as const };
    expect(decodeObjectIcon(encodeObjectIcon(v))).toEqual(v);
    expect(decodeObjectIcon('emoji:rocket')).toBeNull();
    expect(decodeObjectIcon('icon:nope:blue')).toBeNull();
    expect(decodeObjectIcon(null)).toBeNull();
  });

  it('picks a random icon and colour', () => {
    expect(randomObjectIcon(() => 0)).toEqual({ icon: 'object', color: 'blue' });
  });

  it('searches icons by keyword', () => {
    expect(searchObjectIcons('money')).toContain('attrCurrency');
    expect(searchObjectIcons('').length).toBeGreaterThan(50);
  });
});
