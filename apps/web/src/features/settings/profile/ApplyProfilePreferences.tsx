// The member's profile preferences apply app-wide (BACKLOG 6.01): locale, time zone and "Start week on" feed the one
// formatting rule of values and dates (attributes/format/locale.ts, X-10, X-11). Fields left at "System default" keep
// following the browser.
import { useEffect } from 'react';
import { type FormatSettings, setFormatSettings } from '../../attributes/format/locale';
import { useWorkspace } from '../../shell/workspaceContext';
import { useProfile } from './data';

const WEEK_DAY = { sunday: 0, monday: 1, saturday: 6 } as const;

export function ApplyProfilePreferences() {
  const { workspace } = useWorkspace();
  const profile = useProfile(workspace).data;
  const locale = profile?.locale ?? null;
  const timeZone = profile?.timeZone ?? null;
  const weekStart = profile?.weekStart ?? null;
  const known = profile !== undefined;
  useEffect(() => {
    if (!known) return;
    const patch: Partial<FormatSettings> = {};
    if (locale) patch.locale = locale;
    if (timeZone) patch.timeZone = timeZone;
    if (weekStart) patch.weekStartsOn = WEEK_DAY[weekStart];
    setFormatSettings(null);
    if (Object.keys(patch).length > 0) setFormatSettings(patch);
  }, [known, locale, timeZone, weekStart]);
  return null;
}
