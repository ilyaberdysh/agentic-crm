import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatKey, Icon, iconMap, iconNames, Kbd, opticalSize } from '../src';

describe('Icon', () => {
  it('maps every semantic name to a renderable Lucide glyph', () => {
    expect(iconNames.length).toBeGreaterThan(100);
    for (const name of iconNames) {
      expect(iconMap[name], name).toBeTruthy();
      const { container, unmount } = render(<Icon icon={name} />);
      expect(container.querySelector('svg'), name).not.toBeNull();
      unmount();
    }
  });

  it('picks the stroke per optical size so the rendered weight stays ~1 px', () => {
    expect(opticalSize(12)).toBe('small');
    expect(opticalSize(16)).toBe('standard');
    expect(opticalSize(18)).toBe('large');
    const { container } = render(
      <>
        <Icon icon="search" size={12} />
        <Icon icon="search" size={16} />
        <Icon icon="search" size={18} />
      </>,
    );
    const widths = [...container.querySelectorAll('svg')].map((s) => Number(s.getAttribute('stroke-width')));
    expect(widths[0]).toBe(2);
    expect(widths[1]).toBe(1.5);
    expect(widths[2]).toBeCloseTo(1.333, 2);
  });

  it('is decorative unless labelled', () => {
    const { container, getByRole } = render(
      <>
        <Icon icon="info" />
        <Icon icon="warning" label="Warning" />
      </>,
    );
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(getByRole('img', { name: 'Warning' })).toBeTruthy();
  });
});

describe('Kbd', () => {
  it('formats named keys per platform', () => {
    expect(formatKey('mod', true)).toBe('⌘');
    expect(formatKey('mod', false)).toBe('Ctrl');
    expect(formatKey('k')).toBe('K');
    expect(formatKey('tab')).toBe('Tab');
  });

  it('renders one cap per key and an icon for Enter', () => {
    const { container } = render(<Kbd keys={['mod', 'enter']} size={18} />);
    const caps = container.querySelectorAll('kbd > span');
    expect(caps).toHaveLength(2);
    expect(caps[1]?.querySelector('svg')).not.toBeNull();
  });
});
