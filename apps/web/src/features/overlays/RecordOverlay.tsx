// Record overlay: the record page as a full-viewport dialog above the originating page. Top bar:
// close ×, Previous record ↑, Next record ↓, "n of N in ‹view›"; the record page (S3-RECORD, registered via
// registerRecordOverlay) renders the rest. Esc / × close it back to the originating page; K / J replace-navigate
// within the sequence (prev disabled on the first record, next on the last).
import { cx, IconButton, useThemeClassName } from '@agentic-crm/ui';
import { useEffect, useSyncExternalStore } from 'react';
import { Dialog, ModalOverlay, Modal as RACModal } from 'react-aria-components';
import { RecordChip } from '../attributes/ui/primitives';
import { type OverlayEntry, type RecordRef, sequencePosition } from './model';
import * as s from './overlays.css';
import { getRecordOverlayContent, registryVersion, subscribeRegistry } from './registry';
import { closeOverlay, overlayStore } from './store';
import { WindowTopBar } from './WindowShell';

type RecordEntry = Extract<OverlayEntry, { type: 'record' }>;

const TYPING_OR_MENU =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="menu"], [role="listbox"]';

export function RecordOverlayNavigation({ entry }: { entry: RecordEntry }) {
  const position = sequencePosition(entry.sequence, entry.record);
  const go = (to: RecordRef | null) => to && overlayStore.stepRecord(to);
  return (
    <div className={s.recordNav} data-testid="record-overlay-nav">
      <IconButton icon="close" aria-label="Close" size={28} onPress={() => closeOverlay(entry)} />
      <IconButton
        icon="chevronUp"
        aria-label="Previous record"
        tooltip="Previous record"
        tooltipShortcut={['k']}
        variant="secondary"
        size={28}
        isDisabled={!position?.previous}
        onPress={() => go(position?.previous ?? null)}
      />
      <IconButton
        icon="chevronDown"
        aria-label="Next record"
        tooltip="Next record"
        tooltipShortcut={['j']}
        variant="secondary"
        size={28}
        isDisabled={!position?.next}
        onPress={() => go(position?.next ?? null)}
      />
      {position && entry.sequence && (
        <span className={s.recordNavText}>
          {position.index + 1} of {position.total} in {entry.sequence.label}
        </span>
      )}
    </div>
  );
}

function DefaultRecordContent({ record, navigation }: { record: RecordRef; navigation: React.ReactNode }) {
  return (
    <>
      <WindowTopBar mode="modal" start={navigation} controls={null} />
      <div className={s.recordFallbackBody}>
        <RecordChip entityDefinitionId={record.entityDefinitionId} entityInstanceId={record.entityInstanceId} />
      </div>
    </>
  );
}

export function RecordOverlayLayer({ entry, isTop }: { entry: RecordEntry; isTop: boolean }) {
  const themeClass = useThemeClassName();
  useSyncExternalStore(subscribeRegistry, registryVersion, registryVersion);
  const Content = getRecordOverlayContent();
  const position = sequencePosition(entry.sequence, entry.record);

  useEffect(() => {
    if (!isTop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof Element && t.closest(TYPING_OR_MENU)) return;
      if (t instanceof Element && t.closest('[role="dialog"]:not([data-record-overlay]), [role="alertdialog"]')) return;
      const key = e.key.toLowerCase();
      // Esc from outside the dialog (focus left on the page after a note above it closed) still closes it.
      if (key === 'escape' && !(t instanceof Element && t.closest('[data-record-overlay]'))) {
        e.preventDefault();
        closeOverlay(entry);
        return;
      }
      if (key === 'k' && position?.previous) {
        e.preventDefault();
        overlayStore.stepRecord(position.previous);
      } else if (key === 'j' && position?.next) {
        e.preventDefault();
        overlayStore.stepRecord(position.next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTop, position?.previous, position?.next, entry]);

  const navigation = <RecordOverlayNavigation entry={entry} />;
  const close = () => closeOverlay(entry);
  return (
    <ModalOverlay
      isOpen
      isDismissable={false}
      isKeyboardDismissDisabled={!isTop}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      className={cx(themeClass, s.recordOverlay)}
    >
      <RACModal style={{ display: 'contents' }}>
        <Dialog
          aria-label="Record"
          data-record-overlay=""
          data-testid="record-overlay"
          data-record-id={entry.record.entityInstanceId}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, outline: 'none' }}
        >
          {Content ? (
            <Content record={entry.record} navigation={navigation} close={close} />
          ) : (
            <DefaultRecordContent record={entry.record} navigation={navigation} />
          )}
        </Dialog>
      </RACModal>
    </ModalOverlay>
  );
}
