// Settings → Profile (J workspace-admin §1): the info banner, profile picture (upload / remove), first and last name
// (saved on blur), the primary email (read-only: changing it is deferred) and the time preferences (time zone, start
// of the week, language). Changes apply to every workspace of the user.

import type { WeekStart } from '@agentic-crm/contracts';
import { Avatar, Banner, Button, ErrorState, Select, SelectItem, TextInput, toast } from '@agentic-crm/ui';
import { useMemo, useRef, useState } from 'react';
import { weekStartForLocale } from '../../attributes/format/locale';
import { ContentSpinner } from '../../shell/AppShell';
import { useWorkspace } from '../../shell/workspaceContext';
import { AutosaveInput, memberName, useFileUrl } from '../admin/parts';
import { IMAGE_ERROR, IMAGE_HINT, uploadMemberImage } from '../admin/uploadImage';
import { SettingsPage, SettingsSection } from '../SettingsPage';
import { findSettingsEntry } from '../settingsNav';
import { browserTimeZone, LOCALE_OPTIONS, timeZoneItems, updateProfile, useProfile, WEEK_START_OPTIONS } from './data';
import * as s from './profile.css';

const WEEK_FROM_DAY: Record<number, WeekStart> = { 0: 'sunday', 1: 'monday', 6: 'saturday' };

export function ProfilePage() {
  const entry = findSettingsEntry('account');
  const { workspace } = useWorkspace();
  const query = useProfile(workspace);
  if (!entry) return null;
  const profile = query.data;
  return (
    <SettingsPage entry={entry}>
      {query.isPending ? (
        <ContentSpinner />
      ) : !profile ? (
        <ErrorState
          message="Failed to load your profile"
          style={{ padding: 48 }}
          actions={
            <Button variant="secondary" size={28} onPress={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <Banner variant="neutral" size="small">
            Changes to your profile will apply to all of your workspaces.
          </Banner>
          <PersonalDetails profile={profile} />
          <SettingsSection id="email" title="Primary email address">
            <TextInput
              aria-label="Primary email address"
              size={32}
              isReadOnly
              value={profile.emailAddress}
              style={{ maxWidth: 380 }}
            />
          </SettingsSection>
          <TimePreferences profile={profile} />
        </>
      )}
    </SettingsPage>
  );
}

type ProfileData = NonNullable<ReturnType<typeof useProfile>['data']>;

function PersonalDetails({ profile }: { profile: ProfileData }) {
  const { workspace } = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const src = useFileUrl(profile.avatarFileId);
  const name = memberName(profile);

  async function saveName(next: { firstName: string; lastName: string }) {
    try {
      await updateProfile(workspace, { name: next });
    } catch {
      toast.error({ title: 'Failed to update user profile' });
    }
  }

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const fileId = await uploadMemberImage(workspace, profile.memberId, file);
      await updateProfile(workspace, { avatarFileId: fileId });
    } catch (e) {
      setError(e instanceof Error && e.message === IMAGE_HINT ? IMAGE_HINT : IMAGE_ERROR);
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    setError(null);
    try {
      await updateProfile(workspace, { avatarFileId: null });
    } catch {
      setError(IMAGE_ERROR);
    }
  }

  return (
    <SettingsSection id="personal-details" title="Personal details">
      <div className={s.stack}>
        <div>
          <p className={s.fieldLabel}>Profile Picture</p>
          <div className={s.imageRow}>
            <Avatar name={name} src={src} kind="member" size={64} seed={profile.memberId} />
            <div className={s.imageText}>
              <p className={s.imageHint}>{IMAGE_HINT}</p>
              <div className={s.imageButtons}>
                <Button
                  variant="secondary"
                  size={28}
                  icon="image"
                  isPending={uploading}
                  onPress={() => fileRef.current?.click()}
                >
                  {uploading ? 'Uploading...' : 'Upload new image'}
                </Button>
                {profile.avatarFileId && (
                  <Button
                    variant="secondary-destructive"
                    size={28}
                    icon="delete"
                    aria-label="Remove avatar"
                    isDisabled={uploading}
                    onPress={() => void remove()}
                  />
                )}
              </div>
              {error && <p className={s.imageError}>{error}</p>}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif"
              aria-label="Choose File"
              className={s.hiddenInput}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void upload(file);
              }}
            />
          </div>
        </div>
        <div className={s.grid}>
          <AutosaveInput
            label="First Name"
            value={profile.firstName}
            onSave={(firstName) => saveName({ firstName, lastName: profile.lastName })}
          />
          <AutosaveInput
            label="Last Name"
            value={profile.lastName}
            allowEmpty
            onSave={(lastName) => saveName({ firstName: profile.firstName, lastName })}
          />
        </div>
      </div>
    </SettingsSection>
  );
}

function TimePreferences({ profile }: { profile: ProfileData }) {
  const { workspace } = useWorkspace();
  const zones = useMemo(() => timeZoneItems(), []);
  const systemZone = browserTimeZone();
  const zoneItems = useMemo(
    () => [{ id: 'system', label: `System default (${systemZone})` }, ...zones],
    [zones, systemZone],
  );
  const week: WeekStart =
    profile.weekStart ?? WEEK_FROM_DAY[weekStartForLocale(profile.locale ?? navigator.language)] ?? 'monday';

  const save = async (patch: Parameters<typeof updateProfile>[1]) => {
    try {
      await updateProfile(workspace, patch);
    } catch {
      toast.error({ title: 'Failed to update user profile' });
    }
  };

  return (
    <SettingsSection id="time-preferences" title="Time preferences" description="Manage your time preferences">
      <div className={s.grid}>
        <Select<{ id: string; label: string }>
          label="Preferred Timezone"
          aria-label="Preferred Timezone"
          searchable
          searchPlaceholder="Search timezones..."
          items={zoneItems}
          selectedKey={profile.timeZone ?? 'system'}
          onSelectionChange={(k) => void save({ timeZone: k === 'system' ? null : String(k) })}
        >
          {(item) => (
            <SelectItem id={item.id} textValue={item.label}>
              {item.label}
            </SelectItem>
          )}
        </Select>
        <Select<(typeof WEEK_START_OPTIONS)[number]>
          label="Start week on"
          aria-label="Start week on"
          items={WEEK_START_OPTIONS}
          selectedKey={week}
          onSelectionChange={(k) => void save({ weekStart: String(k) as WeekStart })}
        >
          {(item) => <SelectItem id={item.id}>{item.label}</SelectItem>}
        </Select>
        <Select<{ id: string; label: string }>
          label="Language"
          aria-label="Language"
          items={LOCALE_OPTIONS}
          selectedKey={profile.locale ?? 'system'}
          onSelectionChange={(k) => void save({ locale: k === 'system' ? null : String(k) })}
        >
          {(item) => <SelectItem id={item.id}>{item.label}</SelectItem>}
        </Select>
      </div>
    </SettingsSection>
  );
}
