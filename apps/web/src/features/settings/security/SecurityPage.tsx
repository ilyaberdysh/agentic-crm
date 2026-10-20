// Settings → Security (J workspace-admin §5; admin only; raw s75): "Export security" — the switch "Protect CSV exports
// against formula injection" (BACKLOG 6.09). Domain verification, SSO and SCIM are Enterprise / deferred.
import { Button, ErrorState, Switch, toast } from '@agentic-crm/ui';
import { useState } from 'react';
import { ContentSpinner } from '../../shell/AppShell';
import { useWorkspace } from '../../shell/workspaceContext';
import * as a from '../admin/admin.css';
import { InfoTip } from '../objects/parts';
import { SettingsPage, SettingsSection } from '../SettingsPage';
import { findSettingsEntry } from '../settingsNav';
import { updateWorkspaceSettings, useWorkspaceDetail } from '../workspace/data';

export function SecurityPage() {
  const entry = findSettingsEntry('security');
  const { workspace } = useWorkspace();
  const query = useWorkspaceDetail(workspace);
  const [pending, setPending] = useState(false);
  if (!entry) return null;
  const detail = query.data;

  async function toggle(on: boolean) {
    setPending(true);
    try {
      await updateWorkspaceSettings(workspace, { exportFormulaInjectionPrefix: on });
    } catch {
      toast.error({ title: 'Failed to update export security' });
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsPage entry={entry}>
      {query.isPending ? (
        <ContentSpinner />
      ) : !detail ? (
        <ErrorState
          message="Failed to load security settings"
          style={{ padding: 48 }}
          actions={
            <Button variant="secondary" size={28} onPress={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <SettingsSection id="export-security" title="Export security">
          <div className={a.settingCard}>
            <div className={a.settingText}>
              <h3 className={a.settingTitle}>Protect CSV exports against formula injection</h3>
              <p className={a.settingDescription}>
                Adds a prefix to all cell values containing user input to prevent spreadsheet formulas from executing
                when opened in a spreadsheet application{' '}
                <InfoTip content="Values that start with =, +, - or @ are prefixed with an apostrophe in the downloaded CSV" />
              </p>
            </div>
            <Switch
              aria-label="Protect CSV exports against formula injection"
              isSelected={detail.exportFormulaInjectionPrefix}
              isDisabled={pending}
              onChange={(on) => void toggle(on)}
            />
          </div>
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
