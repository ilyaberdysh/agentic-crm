import type { AiToolPart } from '@agentic-crm/contracts';
import { Icon } from '@agentic-crm/ui';
import { useObjects } from '../../../data/objects';
import { RecordAvatar, recordKind } from '../../attributes/ui/primitives';
import { useWorkspace } from '../../shell/workspaceContext';
import * as s from './thread.css';
import { toolRow } from './toolRows';

function RecordStack({ records }: { records: { entityDefinitionId: string; entityInstanceId: string }[] }) {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data ?? [];
  if (records.length === 0) return null;
  const shown = records.slice(0, 3);
  const more = records.length - shown.length;
  return (
    <span className={s.avatarStack} aria-hidden="true">
      {shown.map((r) => (
        <span key={r.entityInstanceId} className={s.avatarStackItem}>
          <RecordAvatar kind={recordKind(objects.find((o) => o.id === r.entityDefinitionId))} size={14} />
        </span>
      ))}
      {more > 0 && <span className={s.toolResult} style={{ marginLeft: 4 }}>{`+${Math.min(more, 99)}`}</span>}
    </span>
  );
}

/** One tool call of the transcript: icon, verb phrase (shimmering while it runs), muted argument, result count. */
export function ToolRowView({ part }: { part: AiToolPart }) {
  const row = toolRow(part);
  return (
    <span
      className={s.toolRow}
      data-tone={row.tone}
      data-testid="ask-tool-row"
      data-tool={part.tool}
      data-status={part.toolStatus ?? 'generating'}
    >
      <span className={s.toolIcon}>
        <Icon icon={row.icon} size={12} />
      </span>
      <span className={s.toolLabel} data-active={row.active || undefined}>
        {row.label}
        {(row.detail || row.result) && ':'}
      </span>
      {row.detail && <span className={s.toolDetail}>{row.detail}</span>}
      {row.result && <span className={s.toolResult}>{row.result}</span>}
      <RecordStack records={row.records} />
    </span>
  );
}
