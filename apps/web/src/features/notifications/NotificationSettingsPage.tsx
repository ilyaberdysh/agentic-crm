// Settings → Notifications (BACKLOG 5.06): "Daily digest"
// with one switch, and "Collaboration notifications" as a table of preference groups × channels (Email, App). Every
// change saves at once; a failure reverts and toasts. "App" is the in-app channel: the rows of the inbox.
import { Checkbox, Icon, Spinner, Switch } from '@agentic-crm/ui';
import { SettingsPage, SettingsSection } from '../settings/SettingsPage';
import { findSettingsEntry } from '../settings/settingsNav';
import { useNotificationPreferences, useUpdatePreference } from './data';
import * as s from './settingsPage.css';

export function NotificationSettingsPage() {
  const entry = findSettingsEntry('notifications');
  const prefs = useNotificationPreferences();
  const update = useUpdatePreference();
  if (!entry) return null;
  const groups = prefs.data?.groups ?? [];
  const digest = groups.find((g) => g.group === 'daily-digest');
  const digestEmail = digest?.channels.find((c) => c.channel === 'email');
  const rows = groups.filter((g) => g.visible && g.group !== 'daily-digest');

  return (
    <SettingsPage entry={entry}>
      {prefs.isPending ? (
        <div className={s.loading}>
          <Spinner size={16} />
        </div>
      ) : (
        <>
          <SettingsSection id="daily-digest" title="Daily digest">
            {digest && (
              <div className={s.card} data-testid="daily-digest">
                <div className={s.cardText}>
                  <div className={s.rowTitle}>Enable daily digest</div>
                  <div className={s.rowDescription}>{digest.description}</div>
                </div>
                <Switch
                  aria-label="Enable daily digest"
                  isSelected={digestEmail?.enabled ?? false}
                  onChange={(enabled) => update.mutate({ group: 'daily-digest', channel: 'email', enabled })}
                />
              </div>
            )}
          </SettingsSection>
          <SettingsSection id="collaboration" title="Collaboration notifications">
            <div className={s.table} role="table" aria-label="Collaboration notifications">
              <div className={`${s.tableRow} ${s.tableHead}`} role="row">
                <div className={s.headLabel} role="columnheader">
                  <Icon icon="notifications" size={16} />
                  Notify me about
                </div>
                <div className={s.headChannel} role="columnheader">
                  <Icon icon="emails" size={16} />
                  Email
                </div>
                <div className={s.headChannel} role="columnheader">
                  <Icon icon="attrPhone" size={16} />
                  App
                </div>
              </div>
              {rows.map((group) => (
                <div key={group.group} className={s.tableRow} role="row" data-testid={`pref-row-${group.group}`}>
                  <div className={s.rowText} role="cell">
                    <div className={s.rowTitle}>{group.title}</div>
                    <div className={s.rowDescription}>{group.description}</div>
                  </div>
                  {(['email', 'in-app'] as const).map((channel) => {
                    const state = group.channels.find((c) => c.channel === channel);
                    return (
                      <div key={channel} className={s.channelCell} role="cell">
                        {state?.available ? (
                          <Checkbox
                            aria-label={`${group.title}: ${channel === 'email' ? 'Email' : 'App'}`}
                            isSelected={state.enabled}
                            onChange={(enabled) => update.mutate({ group: group.group, channel, enabled })}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </SettingsSection>
        </>
      )}
    </SettingsPage>
  );
}
