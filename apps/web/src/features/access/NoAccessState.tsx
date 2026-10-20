// "No access" pages of an object or list URL (BACKLOG 6.04 acceptance 2; J permissions §3, B system-ui §6): the record
// state layout (centred column with the illustration). Members without access cannot tell more than that; admins also
// get "Add yourself" (they can always open the Permissions tab, OQ-067).
import { Button } from '@agentic-crm/ui';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { Illustration } from '../record/states/RecordStatePage';
import * as s from '../record/states/states.css';

export type AccessKind = 'object' | 'list';

export function NoAccessState({
  kind,
  canGrant,
  onAddYourself,
}: {
  kind: AccessKind;
  /** The viewer is a workspace admin: offer "Add yourself". */
  canGrant: boolean;
  onAddYourself?: () => Promise<void>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <div className={s.page} data-testid="no-access" data-kind={kind}>
      <div className={s.column}>
        <Illustration />
        <h1 className={s.title}>{canGrant ? `No access to this ${kind}` : `You don't have access to this ${kind}`}</h1>
        <p className={s.text}>
          {canGrant
            ? `Admins can always give themselves access to a ${kind}.`
            : `Ask a workspace admin to give you access to this ${kind}.`}
        </p>
        {canGrant && onAddYourself && (
          <Button
            variant="primary"
            size={32}
            isPending={pending}
            onPress={() => {
              setPending(true);
              void onAddYourself().finally(() => setPending(false));
            }}
          >
            {kind === 'list' ? 'Add yourself to list' : 'Add yourself to object'}
          </Button>
        )}
        <Button variant={canGrant ? 'ghost' : 'primary'} size={32} onPress={() => router.history.back()}>
          Go back
        </Button>
      </div>
    </div>
  );
}
