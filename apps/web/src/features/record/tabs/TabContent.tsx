// Tab bodies by kind: Overview, Activity, Files and relationship tabs are the record page's own;
// Notes and Tasks come from the notes/tasks features (contract E3, through adapters.tsx), Emails from the email feature
//; Calls comes from the calls feature (through adapters.tsx).
import { ActivityTab } from '../activity/ActivityTab';
import { RecordCallsTab, RecordEmailsTab, RecordNotesTab, RecordTasksTab } from '../adapters';
import type { RecordAgentTabProps } from '../agent/agentState';
import { RecordAgentTab } from '../agent/RecordAgentTab';
import { RecordAgentTabContainer } from '../agent/RecordAgentTabContainer';
import { useRecordPage } from '../context';
import { FilesTab } from '../files/FilesTab';
import type { ResolvedTab } from '../layout/model';
import { OverviewTab } from '../overview/OverviewTab';
import * as r from '../record.css';
import { RelationshipTab } from '../relationship/RelationshipTab';
import { EmptyIllustration } from '../ui/EmptyIllustration';

export function TabContent({ tab, agentTab }: { tab: ResolvedTab; agentTab?: RecordAgentTabProps }) {
  const { recordRef, object } = useRecordPage();
  switch (tab.kind) {
    case 'overview':
      return <OverviewTab />;
    case 'activity':
      return <ActivityTab />;
    case 'agent':
      return agentTab ? <RecordAgentTab {...agentTab} /> : <RecordAgentTabContainer />;
    case 'notes':
      return <RecordNotesTab recordRef={recordRef} />;
    case 'tasks':
      return <RecordTasksTab recordRef={recordRef} />;
    case 'files':
      return <FilesTab />;
    case 'relationship':
      return <RelationshipTab tab={tab} />;
    case 'emails':
      return (
        <RecordEmailsTab
          recordRef={recordRef}
          title={tab.title}
          hasSources={tab.children.length > 0}
          accessTitle={`${object.singularNoun} email access`}
          illustration={<EmptyIllustration icon="emails" />}
        />
      );
    case 'calls':
      return (
        <RecordCallsTab
          recordRef={recordRef}
          empty={
            <div className={r.tabEmpty} data-testid="calls-tab-empty">
              <EmptyIllustration icon="meeting" />
              <div className={r.emptyTitle}>No call recordings</div>
              <div className={r.emptyText}>Your recorded calls will appear here when available.</div>
            </div>
          }
        />
      );
    default:
      return null;
  }
}
