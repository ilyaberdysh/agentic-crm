// What an assistant turn shows (ask-agentic §4): while it runs, the text and tool rows of every step in order under a
// shimmering "Thinking" label; once it ends, the activity collapses into one "N tools used ›" disclosure above the
// final answer (the text of the last step that has text). Approval cards come from the tool parts waiting for it.
import type { AiAssistantPart, AiToolPart, AiTurn } from '@agentic-crm/contracts';

export type TextPart = Extract<AiAssistantPart, { type: 'text' }>;

export type ActivityItem = { kind: 'text'; part: TextPart } | { kind: 'tool'; part: AiToolPart };

export interface TurnDisplay {
  /** Intermediate text and tool rows, in order. */
  activity: ActivityItem[];
  /** The final answer (empty while the turn runs). */
  answer: TextPart[];
  /** Tool calls of the whole turn ("7 tools used"). */
  toolCount: number;
  /** The shimmering "Thinking" label. */
  thinking: boolean;
  /** Write / web-search calls waiting for the approval card, oldest first. */
  pending: AiToolPart[];
  running: boolean;
}

const isTool = (p: AiAssistantPart): p is AiToolPart => p.type === 'tool';
const isText = (p: AiAssistantPart): p is TextPart => p.type === 'text';

export function displayTurn(turn: AiTurn): TurnDisplay {
  const running = turn.status === 'executing';
  const steps = turn.steps;
  const allTools = steps.flatMap((s) => s.parts.filter(isTool));
  const pending = allTools.filter(
    (t) => t.toolStatus === 'awaiting-approval' && turn.pendingApprovals.includes(t.toolCallId),
  );

  if (running) {
    const activity: ActivityItem[] = [];
    for (const step of steps) {
      for (const part of step.parts) {
        if (isText(part)) {
          if (part.content.trim() !== '') activity.push({ kind: 'text', part });
        } else if (isTool(part)) activity.push({ kind: 'tool', part });
      }
    }
    return { activity, answer: [], toolCount: allTools.length, thinking: true, pending, running };
  }

  let answerStep = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if ((steps[i]?.parts ?? []).some((p) => isText(p) && p.content.trim() !== '')) {
      answerStep = i;
      break;
    }
  }
  const activity: ActivityItem[] = [];
  const answer: TextPart[] = [];
  steps.forEach((step, i) => {
    for (const part of step.parts) {
      if (isText(part)) {
        if (part.content.trim() === '') continue;
        if (i === answerStep) answer.push(part);
        else activity.push({ kind: 'text', part });
      } else if (isTool(part)) activity.push({ kind: 'tool', part });
    }
  });
  return { activity, answer, toolCount: allTools.length, thinking: false, pending, running };
}

/** Plain text of the final answer (copy button). */
export function answerText(display: TurnDisplay): string {
  return display.answer.map((p) => p.content).join('\n\n');
}
