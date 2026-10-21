// Settings tab: a centred ≈720 px column — General:
// "Workflow timezone" with the searchable zone select ("(GMT+0) UTC" while unset); Notifications: "Get notified when
// this workflow fails" (once a day per unique failure reason).
import { Icon, Switch, Tooltip } from '@agentic-crm/ui';
import { updateSettings, useWs } from '../data';
import { TimezoneSelect } from '../editor/panel/inputs/values';
import { useWorkflowPage } from '../editor/WorkflowLayout';
import * as s from './settings.css';

export function SettingsTab() {
  const page = useWorkflowPage();
  const ws = useWs();
  const w = page.detail.workflow;
  return (
    <div className={s.page} data-testid="workflow-settings">
      <div className={s.column}>
        <h2 className={s.heading}>General</h2>
        <div className={s.row}>
          <div className={s.texts}>
            <span className={s.title}>Workflow timezone</span>
            <span className={s.description}>Frame of reference for date and time operations in this workflow.</span>
          </div>
          <TimezoneSelect
            value={w.timezone}
            width={240}
            isDisabled={!page.canEdit}
            onChange={(zone) => void updateSettings(ws, w.id, { timezone: zone })}
          />
        </div>
        <hr className={s.divider} />
        <h2 className={s.heading}>Notifications</h2>
        <div className={s.row}>
          <div className={s.texts}>
            <span className={s.title}>Get notified when this workflow fails</span>
            <span className={s.description}>
              Receive a notification when failures occur in runs of this workflow
              <Tooltip content="Notifications are sent once a day per unique failure reason">
                <span
                  className={s.info}
                  tabIndex={0}
                  aria-label="Notifications are sent once a day per unique failure reason"
                >
                  <Icon icon="info" size={12} />
                </span>
              </Tooltip>
            </span>
          </div>
          <Switch
            size={20}
            isSelected={w.failureNotifications}
            aria-label="Get notified when this workflow fails"
            data-testid="failure-notifications"
            onChange={(on) => void updateSettings(ws, w.id, { failureNotifications: on })}
          />
        </div>
      </div>
    </div>
  );
}
