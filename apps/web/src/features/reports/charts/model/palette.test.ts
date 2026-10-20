import { describe, expect, it } from 'vitest';
import { assignGroupColors, CATEGORICAL_PALETTE, categoricalColor } from './palette';

describe('categorical palette', () => {
  it('has 33 colours: base hues, then Subtle, then Bold', () => {
    expect(CATEGORICAL_PALETTE).toHaveLength(33);
    expect(CATEGORICAL_PALETTE.slice(0, 4)).toEqual(['blue', 'cyan', 'green', 'purple']);
    expect(CATEGORICAL_PALETTE[10]).toBe('lime');
    expect(CATEGORICAL_PALETTE[11]).toBe('blueSubtle');
    expect(CATEGORICAL_PALETTE[22]).toBe('blueBold');
    expect(CATEGORICAL_PALETTE[32]).toBe('limeBold');
  });

  it('cycles by index', () => {
    expect(categoricalColor(0)).toBe('blue');
    expect(categoricalColor(33)).toBe('blue');
    expect(categoricalColor(34)).toBe('cyan');
    expect(categoricalColor(-1)).toBe('limeBold');
  });
});

describe('assignGroupColors', () => {
  it('maps stage colours to hues (block_*)', () => {
    const colors = assignGroupColors([
      { key: 'a', color: 'block_light-green' },
      { key: 'b', color: 'block_blue' },
      { key: 'c', color: 'block_magenta' },
      { key: 'd', color: 'block_grey' },
    ]);
    expect([...colors.values()]).toEqual(['lime', 'blue', 'pink', 'grey']);
  });

  it('maps select option colours (pastel_*) and rotates base / Subtle / Bold for one hue', () => {
    const colors = assignGroupColors([
      { key: 'low', color: 'pastel_grey' },
      { key: 'medium', color: 'pastel_grey' },
      { key: 'high', color: 'pastel_grey' },
      { key: 'critical', color: 'pastel_grey' },
      { key: 'teal', color: 'pastel_teal' },
    ]);
    expect([...colors.values()]).toEqual(['grey', 'greySubtle', 'greyBold', 'grey', 'cyan']);
  });

  it('cycles the categorical palette for groups without colours and skips the null group in the index', () => {
    const colors = assignGroupColors([
      { key: 'x', color: null },
      { key: 'y', color: null },
      { key: null, color: null },
      { key: 'z', color: null },
    ]);
    expect(colors.get('x')).toBe('blue');
    expect(colors.get('y')).toBe('cyan');
    expect(colors.get('z')).toBe('green');
    expect(colors.get(null)).toBe('nullGrey');
  });

  it('colours checkbox groups: true accent, false grey', () => {
    const colors = assignGroupColors(
      [
        { key: 'false', color: null },
        { key: 'true', color: null },
      ],
      { checkbox: true },
    );
    expect(colors.get('true')).toBe('accent');
    expect(colors.get('false')).toBe('nullGrey');
  });

  it('gives a deleted option (no colour among coloured ones) the grey bucket colour', () => {
    const colors = assignGroupColors([
      { key: 'a', color: 'pastel_red' },
      { key: 'gone', color: null },
    ]);
    expect(colors.get('a')).toBe('red');
    expect(colors.get('gone')).toBe('nullGrey');
  });
});
