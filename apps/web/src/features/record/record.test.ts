import { describe, expect, it } from 'vitest';
import { formatBytes, validateUpload } from './files/upload';
import { DEFAULT_PANEL_PERCENT, panelWidthPx, percentFromPx, readPercent } from './panel/width';
import { isUuid, recordSubPath } from './paths';
import { otherUsers, recordRoom } from './presence';
import { formatCount } from './tabs/TabBar';
import { labelledCount } from './ui/FittedActions';

describe('details panel width (D §2.1, §2.5b)', () => {
  it('30 % of the body, clamped to [320, min(60 %, body − 350)]', () => {
    expect(panelWidthPx(DEFAULT_PANEL_PERCENT, 1512)).toBe(454);
    expect(panelWidthPx(30, 1280)).toBe(384);
    expect(panelWidthPx(30, 1024)).toBe(320);
    expect(panelWidthPx(80, 1512)).toBe(907);
    expect(panelWidthPx(80, 1000)).toBe(600);
    expect(panelWidthPx(10, 1512)).toBe(320);
  });

  it('a drag end persists the clamped percentage; bad stored values fall back to 30', () => {
    expect(percentFromPx(604.8, 1512)).toBeCloseTo(40, 1);
    expect(percentFromPx(2000, 1512)).toBeCloseTo(59.987, 2);
    expect(readPercent('42.5')).toBe(42.5);
    expect(readPercent('nope')).toBe(30);
    expect(readPercent(null)).toBe(30);
  });
});

describe('header actions fit (D §2.2)', () => {
  // Compose email, Add to list, New note, Run workflow, New task (natural widths at 28 px).
  const widths = [140, 104, 101, 120, 98];
  it('keeps labels from the start and collapses the rest to 28 px icons', () => {
    expect(labelledCount(widths, 433)).toBe(3);
    expect(labelledCount(widths, 432)).toBe(2);
    expect(labelledCount(widths, 346)).toBe(1);
    expect(labelledCount(widths, 2000)).toBe(5);
    expect(labelledCount(widths, 100)).toBe(0);
  });
});

describe('record routes, rooms and counters', () => {
  it('record paths per object kind', () => {
    expect(recordSubPath({ entityType: 'company-record', apiSlug: 'companies' }, 'r1')).toBe('company/r1');
    expect(recordSubPath({ entityType: 'person-record', apiSlug: 'people' }, 'r1')).toBe('person/r1');
    expect(recordSubPath({ entityType: 'standard-object', apiSlug: 'deals' }, 'r1')).toBe('deals/record/r1');
    expect(recordSubPath({ entityType: 'custom-record', apiSlug: 'projects' }, 'r1')).toBe('custom/projects/record/r1');
    expect(isUuid('01a131f1-f0f5-75cc-95a4-15575809be27')).toBe(true);
    expect(isUuid('nope')).toBe(false);
  });

  it('presence: other users only, one avatar per user', () => {
    expect(recordRoom('w', 'd', 'r')).toBe('record:w:d:r');
    const members = [
      { userId: 'me', clientId: 'me.1', state: { name: 'Me' } },
      { userId: 'u2', clientId: 'u2.1', state: { name: 'Jane' } },
      { userId: 'u2', clientId: 'u2.2', state: { name: 'Jane' } },
      { userId: 'u3', state: {} },
    ];
    expect(otherUsers(members, 'me')).toEqual([
      { userId: 'u2', name: 'Jane' },
      { userId: 'u3', name: 'Workspace member' },
    ]);
  });

  it('tab counts cap at 99+', () => {
    expect(formatCount(7)).toBe('7');
    expect(formatCount(120)).toBe('99+');
  });
});

describe('file uploads', () => {
  it('sizes and checks', () => {
    expect(formatBytes(28)).toBe('28 bytes');
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(30 * 1024 * 1024)).toBe('30 MB');
    expect(validateUpload({ name: 'a.txt', size: 10 })).toBeNull();
    expect(validateUpload({ name: 'big.bin', size: 60 * 1024 * 1024 })).toContain('larger than');
  });
});
