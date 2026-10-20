// Profile data (BACKLOG 6.01; J workspace-admin §1): `profile.get` / `profile.update` for the signed-in member. Names
// and time preferences apply to every workspace of the user; the avatar is an image uploaded to the member's own record.
import type { Profile, UpdateProfileInput } from '@agentic-crm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from '../../../data/keys';
import { queryClient } from '../../../data/queryClient';
import { api, inWorkspace, type WorkspaceRef } from '../../../data/trpc';
import { written } from '../admin/parts';

export const profileQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: [...keys.members(ws.id), 'profile'] as const,
    queryFn: () => api.profile.get.query(undefined, inWorkspace(ws)) as Promise<Profile>,
  });

export function useProfile(ws: WorkspaceRef) {
  return useQuery(profileQuery(ws));
}

export async function updateProfile(ws: WorkspaceRef, input: UpdateProfileInput): Promise<Profile> {
  const { profile } = await written(ws, api.profile.update.mutate(input, inWorkspace(ws)));
  queryClient.setQueryData(profileQuery(ws).queryKey, profile);
  // The auth user's name follows (sidebar, mentions) and the member lists show the new names and avatar.
  void queryClient.invalidateQueries({ queryKey: keys.me() });
  void queryClient.invalidateQueries({ queryKey: keys.members(ws.id) });
  return profile;
}

// ---- time zones -------------------------------------------------------------------------------------------------

export interface ZoneItem {
  id: string;
  label: string;
}

function abbreviation(timeZone: string): string {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    );
  } catch {
    return '';
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

let zones: ZoneItem[] | null = null;

/** "Area/City (ABBR)" for every IANA zone the browser knows (the "Preferred Timezone" list). */
export function timeZoneItems(): ZoneItem[] {
  if (zones) return zones;
  let ids: string[] = [];
  try {
    ids = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    ids = [];
  }
  if (ids.length === 0) ids = ['UTC'];
  if (!ids.includes('UTC')) ids = [...ids, 'UTC'];
  zones = ids.map((id) => ({ id, label: `${id.replace(/_/g, ' ')} (${abbreviation(id)})` }));
  return zones;
}

export function timeZoneLabel(id: string): string {
  return timeZoneItems().find((z) => z.id === id)?.label ?? id;
}

// ---- week start / language ------------------------------------------------------------------------------------

export const WEEK_START_OPTIONS = [
  { id: 'monday', label: 'Monday' },
  { id: 'saturday', label: 'Saturday' },
  { id: 'sunday', label: 'Sunday' },
] as const;

/** "Choose the language the app is shown in": the UI is English; the language also drives number formats. */
export const LOCALE_OPTIONS: ZoneItem[] = [
  { id: 'system', label: 'System default' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'de-DE', label: 'Deutsch' },
  { id: 'fr-FR', label: 'Français' },
  { id: 'es-ES', label: 'Español' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'it-IT', label: 'Italiano' },
  { id: 'nl-NL', label: 'Nederlands' },
  { id: 'ru-RU', label: 'Русский' },
  { id: 'ja-JP', label: '日本語' },
];
