// Body of the record overlay (BACKLOG 3.09; D README §2.7): features/overlays (E4) owns the full-viewport dialog,
// the URL (`?modal=record&id=…&object=…`) and J / K through the view's records; the record page registers what is
// inside — the record view with the overlay's ×, ↑ / ↓ and "n of N in {view}" in place of the breadcrumb. Tabs switch
// in component state (the URL belongs to the originating page); "Go to record" of a merged record opens its page.
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useObjects } from '../../../data/objects';
import { useWorkspace } from '../../shell/workspaceContext';
import { type RecordOverlayContentProps, registerRecordOverlay } from '../adapters';
import { recordUrl } from '../paths';
import { RecordBody } from '../RecordPage';
import { RecordStatePage } from '../states/RecordStatePage';

export function RecordOverlayPage({ record, navigation, close }: RecordOverlayContentProps) {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const objects = useObjects(workspace);
  const object = objects.data?.find((o) => o.id === record.entityDefinitionId);
  // The tab stays while J / K step through the view (as Attio's replace-navigation keeps `$activeTab`).
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);
  if (objects.isPending) return null;
  if (!object) return <RecordStatePage kind="not-found" onGoBack={close} />;
  return (
    <RecordBody
      object={object as Parameters<typeof RecordBody>[0]['object']}
      recordRef={record}
      activeTab={activeTab}
      onTab={setActiveTab}
      overlay={{ navigation, close }}
      onGoToRecord={(id) => {
        close();
        void navigate({ href: recordUrl(href, object, id, 'overview') });
      }}
    />
  );
}

registerRecordOverlay(RecordOverlayPage);
