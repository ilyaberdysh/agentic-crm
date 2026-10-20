import { useNavigate } from '@tanstack/react-router';
import { useRecordTitle } from '../../attributes/data/queries';
import { RecordAvatar, recordKind, recordPath } from '../../attributes/ui/primitives';
import { useWorkspace } from '../../shell/workspaceContext';
import * as s from './markdown.css';

/** A record named in an answer or a card: object icon + name (the label the model wrote, else the record's name). */
export function RecordPill({
  entityDefinitionId,
  entityInstanceId,
  label,
}: {
  entityDefinitionId: string;
  entityInstanceId: string;
  label?: string;
}) {
  const { workspace } = useWorkspace();
  // The record's own name is only fetched when the answer did not carry one.
  const { definition, title } = useRecordTitle(entityDefinitionId, label ? '' : entityInstanceId);
  const navigate = useNavigate();
  const href = recordPath(workspace.slug, definition, entityInstanceId);
  const inner = (
    <>
      <span className={s.recordChipIcon}>
        <RecordAvatar kind={recordKind(definition)} size={14} />
      </span>
      <span className={s.recordChipLabel}>{label || title}</span>
    </>
  );
  if (!href) {
    return (
      <span className={s.recordChip} data-record-id={entityInstanceId}>
        {inner}
      </span>
    );
  }
  return (
    <a
      className={s.recordChip}
      href={href}
      data-record-id={entityInstanceId}
      data-testid="ask-record-chip"
      onClick={(e) => {
        e.stopPropagation();
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        void navigate({ href });
      }}
    >
      {inner}
    </a>
  );
}
