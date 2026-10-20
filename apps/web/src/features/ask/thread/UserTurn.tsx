import type { AiTurn } from '@agentic-crm/contracts';
import { IconButton, toast } from '@agentic-crm/ui';
import { fromAnnotations, segments } from '../composer/model';
import { RecordPill } from '../markdown/RecordPill';
import * as s from './thread.css';

/** The user's message: a grey bubble, record mentions as chips, prompts and members in the accent colour. */
export function UserTurn({ turn }: { turn: AiTurn }) {
  const part = turn.parts.find((p) => p.type === 'text');
  if (!part || part.type !== 'text') return null;
  const value = fromAnnotations(part.content, part.annotations);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(part.content);
      toast({ title: 'Copied to clipboard!', icon: 'copy' });
    } catch {
      toast.error({ title: 'Failed to copy' });
    }
  };
  return (
    <div className={s.userRow} data-testid="ask-user-turn">
      <div className={s.userBubble}>
        {segments(value).map((seg, i) => {
          const t = seg.token;
          if (!t) return <span key={i}>{seg.text}</span>;
          if (t.kind === 'record') {
            return (
              <RecordPill
                key={i}
                entityDefinitionId={t.entityDefinitionId}
                entityInstanceId={t.entityInstanceId}
                label={seg.text.replace(/^@/, '')}
              />
            );
          }
          return (
            <span key={i} className={t.kind === 'prompt' ? s.promptToken : s.mentionToken}>
              {seg.text}
            </span>
          );
        })}
      </div>
      <div className={s.userActions}>
        <IconButton icon="copy" size={20} aria-label="Copy" tooltip="Copy" onPress={() => void copy()} />
      </div>
    </div>
  );
}
