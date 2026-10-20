// Call actions shared by the list row, the cards and the call page header (I calls §2.5, §3.11): Copy link, Transcript ›
// Copy, the favourite toggle and Delete recording (confirm dialog). Video-only items (Download video, Stop recording,
// Pin to screen, Regenerate transcript) do not exist for transcript-only calls.
import { AlertDialog, IconButton, Menu, MenuItem, MenuSeparator, MenuTrigger, Submenu, toast } from '@agentic-crm/ui';
import { useState } from 'react';
import { api, errorEnvelopeOf, inWorkspace } from '../../data/trpc';
import { useFavoriteToggle } from '../favorites';
import { useWorkspace } from '../shell/workspaceContext';
import { useDeleteCall, useWsRef } from './data';
import * as s from './list.css';

export type CallTab = 'transcript' | 'speakers' | 'meeting' | 'summary';

/** `/<ws>/calls/<meetingId>/<recordingId>/<tab>` */
export function callPath(workspaceSlug: string, meetingId: string, recordingId: string, tab: CallTab = 'transcript') {
  return `/${workspaceSlug}/calls/${meetingId}/${recordingId}/${tab}`;
}

export async function copyText(text: string, message = 'Copied to clipboard'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: message, icon: 'copy' });
    return true;
  } catch {
    toast.error({ title: 'Failed to copy to the clipboard' });
    return false;
  }
}

export interface CallRef {
  id: string;
  meetingId: string;
  title: string | null;
}

/** The star of a call (favourite type `call-recording`). */
export function CallFavoriteStar({ recordingId, size = 28 }: { recordingId: string; size?: 20 | 28 }) {
  const { isFavorite, toggle } = useFavoriteToggle({ favoriteType: 'call-recording', targetId: recordingId });
  const label = isFavorite ? 'Remove from favorites' : 'Add to favorites';
  return (
    <IconButton
      icon="favorite"
      aria-label={label}
      aria-pressed={isFavorite}
      tooltip={label}
      size={size}
      className={isFavorite ? s.starOn : undefined}
      data-favorite={isFavorite || undefined}
      data-testid="call-favorite"
      onPress={toggle}
    />
  );
}

/** The ⋮ "Call recording menu". `variant="row"`: Copy link and Delete only (the Calls list); `page`: the full menu. */
export function CallMenu({
  call,
  variant = 'row',
  onDeleted,
  className,
  size = 28,
  disabled,
}: {
  call: CallRef;
  variant?: 'row' | 'page';
  onDeleted?: () => void;
  className?: string;
  size?: 20 | 28;
  disabled?: boolean;
}) {
  const { workspace } = useWorkspace();
  const ws = useWsRef();
  const remove = useDeleteCall();
  const [confirming, setConfirming] = useState(false);
  const { isFavorite, toggle } = useFavoriteToggle({ favoriteType: 'call-recording', targetId: call.id });

  const link = () =>
    copyText(`${window.location.origin}${callPath(workspace.slug, call.meetingId, call.id)}`, 'Copied to clipboard');
  const transcript = async () => {
    try {
      const out = await api.calls.transcript.query({ recordingId: call.id }, inWorkspace(ws));
      await copyText(out.text, 'Copied to clipboard');
    } catch (e) {
      toast.error({ title: 'Failed to copy the transcript', description: errorEnvelopeOf(e).message });
    }
  };

  return (
    <>
      <MenuTrigger>
        <IconButton
          icon="moreVertical"
          size={size}
          aria-label="Call recording menu"
          tooltip="Call recording menu"
          className={className}
          isDisabled={disabled}
          data-testid="call-menu"
        />
        <Menu
          aria-label="Call recording menu"
          placement="bottom end"
          width={variant === 'page' ? 220 : 192}
          onAction={(key) => {
            if (key === 'copy-link') void link();
            else if (key === 'favorite') toggle();
            else if (key === 'delete') setConfirming(true);
          }}
        >
          <MenuItem id="copy-link" icon="link">
            Copy link
          </MenuItem>
          {variant === 'page' && (
            <Submenu label="Transcript" icon="transcript">
              <MenuItem id="copy-transcript" icon="copy" onAction={() => void transcript()}>
                Copy
              </MenuItem>
            </Submenu>
          )}
          {variant === 'page' && (
            <MenuItem id="favorite" icon={isFavorite ? 'favoriteRemove' : 'favorite'}>
              {isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem id="delete" icon="delete" variant="danger">
            Delete recording
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Delete call recording"
        description="Are you sure you want to delete this call recording? This cannot be undone."
        confirmLabel="Delete recording"
        onConfirm={() =>
          remove.mutate(call.id, {
            onSuccess: () => {
              toast({ title: 'Call recording deleted' });
              onDeleted?.();
            },
            onError: (e) =>
              toast.error({ title: 'Failed to delete call recording', description: errorEnvelopeOf(e).message }),
          })
        }
      />
    </>
  );
}
