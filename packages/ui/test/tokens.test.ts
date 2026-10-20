/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import {
  accentColors,
  accentOverrides,
  colorTokens,
  controlRadius,
  density,
  duration,
  elevatedOverrides,
  elevation,
  identities,
  space,
  textStyles,
  zIndex,
} from '../src/tokens';

function keysDeep(o: object, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keysDeep(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('generated tokens', () => {
  it('expose the expected semantic values', () => {
    expect(colorTokens.light.interactive.primary).toBe('#266df0');
    expect(colorTokens.light.content.secondary).toBe('#000000a1');
    expect(colorTokens.dark.surface.primary).toBe('#101112');
    expect(colorTokens.light.surface.floating).toBe('#101112');
  });

  it('have the same shape in every identity', () => {
    const shape = keysDeep(colorTokens.light).sort();
    for (const id of identities) expect(keysDeep(colorTokens[id]).sort()).toEqual(shape);
  });

  it('define overrides for the six non-blue accents and the elevated mode', () => {
    expect(accentColors).toEqual(['blue', 'cyan', 'yellow', 'orange', 'pink', 'purple', 'green']);
    expect(Object.keys(accentOverrides).sort()).toEqual(['cyan', 'green', 'orange', 'pink', 'purple', 'yellow']);
    expect(accentOverrides.purple.light.interactive.primary).toBe('#9b69ff');
    expect(elevatedOverrides.dark.surface.primary).toBe('#17181a');
    expect(elevatedOverrides.light.surface.primaryHover).toBe('#f6f7f7');
    expect(elevation.dark.e1.startsWith('inset 0px 0px 0px 1px #212224')).toBe(true);
  });

  it('expose scales and density metrics', () => {
    expect(space[12]).toBe(12);
    expect(controlRadius[32]).toBe(9);
    expect(textStyles.body.standard).toMatchObject({ fontSize: 14, lineHeight: 20, fontWeight: 500 });
    expect(duration).toMatchObject({ fast: 80, comfortable: 140, breezy: 200, sluggish: 300, sloth: 400 });
    expect(density.table).toMatchObject({ headerRow: 40, bodyRow: 36 });
    expect(density.sidebar).toMatchObject({ width: 275, minWidth: 200, maxWidth: 350, itemHeight: 28 });
    expect(zIndex.toast).toBe(2147483647);
  });
});
