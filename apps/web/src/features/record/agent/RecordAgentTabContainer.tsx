import { useRecordPage } from '../context';
import { useAgentTab } from './data';
import { RecordAgentTab } from './RecordAgentTab';

export function RecordAgentTabContainer() {
  const { recordRef } = useRecordPage();
  const tab = useAgentTab(recordRef);
  return <RecordAgentTab {...tab} />;
}
