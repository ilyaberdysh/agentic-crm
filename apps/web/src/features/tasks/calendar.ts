// The viewer's calendar (decisions X-09 / X-10; CROSS-DOMAIN B.24): time zone and week start from the member's
// preferences, falling back to the browser (zone) and the locale (week start: ru / most of Europe Monday, en-US
// Sunday). One hook for task buckets, notes date buckets and the deadline pickers.
import { localDateOf, type WeekDay, weekStartForLocale } from '@agentic-crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { keys } from '../../data/keys';
import { api, inWorkspace, type RouterOutputs, type WorkspaceRef } from '../../data/trpc';
import { useWorkspace } from '../shell/workspaceContext';
import { numericOrderForLocale } from './naturalDate';

export type MemberPreferences = RouterOutputs['preferences']['get'];

export interface Calendar {
  timeZone: string;
  weekStart: WeekDay;
  /** Locale for formatting dates: the fixed English patterns (the UI language is English; locale.ts X-11). */
  locale: string;
  numericOrder: 'mdy' | 'dmy';
  /** Local today 'YYYY-MM-DD' (evaluated on call). */
  today: () => string;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function browserLocale(): string {
  return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
}

export const preferencesQuery = (workspace: WorkspaceRef) => ({
  queryKey: keys.resource(workspace.id, 'member-preferences'),
  queryFn: () => api.preferences.get.query({}, inWorkspace(workspace)),
  staleTime: 10 * 60_000,
});

/** Resolves the effective calendar from stored preferences (null fields fall back to the browser). */
export function resolveCalendar(
  prefs: Pick<MemberPreferences, 'timeZone' | 'locale' | 'weekStartDay'> | undefined,
): Calendar {
  const userLocale = prefs?.locale ?? browserLocale();
  const timeZone = prefs?.timeZone ?? browserTimeZone();
  const weekStart = (prefs?.weekStartDay ?? weekStartForLocale(userLocale)) as WeekDay;
  return {
    timeZone,
    weekStart,
    locale: 'en-US',
    numericOrder: numericOrderForLocale(userLocale),
    today: () => localDateOf(Date.now(), timeZone),
  };
}

export function useCalendar(): Calendar {
  const { workspace } = useWorkspace();
  const prefs = useQuery(preferencesQuery(workspace)).data;
  return useMemo(() => resolveCalendar(prefs), [prefs]);
}
