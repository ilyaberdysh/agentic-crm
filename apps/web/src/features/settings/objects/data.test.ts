import { describe, expect, it } from 'vitest';
import { limitMessage } from './data';

describe('limit errors (C.4 #7)', () => {
  it('describes the select option limit', () => {
    expect(
      limitMessage({ status: 409, code: 'ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED', details: { limit: 500 } }),
    ).toBe('Reached the limit of 500 options. New options will not be created.');
  });

  it('describes the attributes / views per object limit', () => {
    expect(
      limitMessage({
        status: 409,
        code: 'OVER_USAGE_LIMIT',
        details: { quota: 'attributes_per_object_hard', limit: 500 },
      }),
    ).toBe('This object has reached the limit of 500 attributes (archived attributes count towards it).');
    expect(
      limitMessage({ status: 409, code: 'OVER_USAGE_LIMIT', details: { quota: 'views_per_object_hard', limit: 500 } }),
    ).toBe('This object has reached the limit of 500 views (archived views count towards it).');
  });

  it('ignores other errors', () => {
    expect(limitMessage({ status: 409, code: 'SLUG_IN_USE' })).toBeNull();
  });
});
