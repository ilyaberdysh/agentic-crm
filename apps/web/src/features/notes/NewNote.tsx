// New note flow (E README §3.1 "Create"): with a record (record page "New note", Notes tab "Create note") the note is
// created on it at once; without one (Notes page "+ New note", `n`, a favourite template) "Choose record" asks
// first. The note then opens in the modal at `?modal=note&id=…`.
import { toast } from '@agentic-crm/ui';
import { useSyncExternalStore } from 'react';
import { queryClient } from '../../data/queryClient';
import { errorEnvelopeOf, getCurrentWorkspace } from '../../data/trpc';
import type { RecordRef } from '../overlays/model';
import { openNote } from '../overlays/store';
import { ChooseRecordDialog } from './ChooseRecordDialog';
import { createNote } from './data';

export interface NewNoteOptions {
  record?: RecordRef;
  templateId?: string;
}

let pending: { options: NewNoteOptions; nonce: number } | null = null;
let nonce = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

async function createAndOpen(record: RecordRef, templateId: string | undefined): Promise<void> {
  const ws = getCurrentWorkspace();
  if (!ws) return;
  try {
    const note = await createNote(queryClient, ws, {
      parentRecords: [{ entityDefinitionId: record.entityDefinitionId, entityInstanceId: record.entityInstanceId }],
      ...(templateId ? { templateId } : {}),
    });
    openNote(note.id);
  } catch (error) {
    toast.error({ title: 'Failed to create the note', description: errorEnvelopeOf(error).message });
  }
}

/** Starts a new note (on `record` directly, else after "Choose record"). */
export function openNewNote(options: NewNoteOptions = {}): void {
  if (options.record) {
    void createAndOpen(options.record, options.templateId);
    return;
  }
  nonce += 1;
  pending = { options, nonce };
  emit();
}

function useNewNoteState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
    () => pending,
  );
}

/** Mounted once by the overlay host. */
export function NewNoteHost() {
  const state = useNewNoteState();
  if (!state) return null;
  const close = () => {
    pending = null;
    emit();
  };
  return (
    <ChooseRecordDialog
      key={state.nonce}
      onClose={close}
      onPick={(record) => {
        close();
        void createAndOpen(record, state.options.templateId);
      }}
    />
  );
}
