import { Button, Icon } from '@agentic-crm/ui';
import { memberName } from '../../attributes/format/formatValue';
import type { Member } from '../../attributes/types';
import type { AgentRecordState, RecordAgentTabProps } from './agentState';
import * as s from './agentTab.css';

export function RecordAgentTab({
  state,
  members = [],
  onDecision,
  onExecute,
  isPending,
  mutationError,
}: RecordAgentTabProps) {
  if (state.status === 'loading') {
    return (
      <div className={s.page} aria-label="Loading agent activity" data-testid="agent-state-loading">
        <div className={s.skeleton} />
        <div className={s.skeleton} />
        <div className={s.skeleton} />
      </div>
    );
  }
  if (state.status === 'empty') {
    return (
      <div className={s.empty} data-testid="agent-state-empty">
        <Icon icon="bot" size={22} />
        <div className={s.emptyTitle}>No agent work yet</div>
        <div className={s.muted}>Goals, evidence, decisions, and completed work for this record will appear here.</div>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={s.empty} role="alert" data-testid="agent-state-error">
        <Icon icon="warning" size={20} />
        <div className={s.emptyTitle}>Agent activity unavailable</div>
        <div className={s.muted}>{state.message}</div>
      </div>
    );
  }

  return (
    <div className={s.page} data-testid={`agent-state-${state.status}`}>
      <header className={s.header}>
        <div>
          <div className={s.eyebrow}>Goal</div>
          <h1 className={s.title}>{state.goal}</h1>
        </div>
        <span className={s.status} data-status={state.status}>
          {state.status === 'proposed'
            ? 'Needs review'
            : state.status === 'approved'
              ? 'Approved'
              : state.status === 'queue'
                ? state.queueStatus === 'LEASED'
                  ? 'In progress'
                  : state.queueStatus === 'FAILED_TERMINAL'
                    ? 'Failed'
                    : state.queueStatus.charAt(0) + state.queueStatus.slice(1).toLowerCase()
                : state.status === 'running'
                  ? 'In progress'
                  : state.status === 'stopped'
                    ? 'Stopped'
                    : 'Completed'}
        </span>
      </header>

      <section className={s.card} aria-labelledby="agent-current-work">
        <div className={s.sectionHeading} id="agent-current-work">
          Current work
        </div>
        <div className={s.task}>{state.task}</div>
        <p className={s.body}>{state.currentStep}</p>
      </section>

      {state.evidence && <Evidence evidence={state.evidence} />}

      {(state.assigneeMemberIds?.length || state.reviewerMemberId) && (
        <section className={s.card} aria-labelledby="agent-people">
          <div className={s.sectionHeading} id="agent-people">
            People
          </div>
          {state.assigneeMemberIds && state.assigneeMemberIds.length > 0 && (
            <div className={s.peopleGroup}>
              <div className={s.muted}>Assignees</div>
              <ul className={s.peopleList}>
                {state.assigneeMemberIds.map((id) => (
                  <li key={id}>{displayMember(id, members)}</li>
                ))}
              </ul>
            </div>
          )}
          {state.reviewerMemberId && (
            <div className={s.peopleGroup}>
              <div className={s.muted}>Reviewer</div>
              <div>{displayMember(state.reviewerMemberId, members)}</div>
            </div>
          )}
        </section>
      )}

      {state.status === 'proposed' && (
        <section className={s.decision} aria-labelledby="agent-pending-decision">
          <div className={s.sectionHeading} id="agent-pending-decision">
            Human decision
          </div>
          <p className={s.body}>{state.pendingDecision.question}</p>
          <div className={s.actions}>
            <Button
              size={28}
              variant="primary"
              isPending={isPending}
              isDisabled={isPending || state.pendingDecision.canDecide === false}
              onPress={() => onDecision?.(state.pendingDecision.id, 'approve')}
            >
              Approve
            </Button>
            <Button
              size={28}
              variant="secondary"
              isDisabled={isPending || state.pendingDecision.canDecide === false}
              onPress={() => onDecision?.(state.pendingDecision.id, 'reject')}
            >
              Decline
            </Button>
          </div>
          {state.pendingDecision.canDecide === false && (
            <div className={s.muted}>Only the assigned reviewer can decide this proposal.</div>
          )}
        </section>
      )}

      {state.status === 'approved' && (
        <section className={s.decision} aria-labelledby="agent-approved-action">
          <div className={s.sectionHeading} id="agent-approved-action">
            Approved action
          </div>
          <p className={s.body}>{state.pendingExecution.question}</p>
          <div className={s.actions}>
            <Button
              size={28}
              variant="primary"
              isPending={isPending}
              isDisabled={state.pendingExecution.canExecute === false}
              onPress={() => onExecute?.(state.pendingExecution.id)}
            >
              Create task
            </Button>
          </div>
        </section>
      )}

      {state.status === 'stopped' && (
        <section className={s.receipt} aria-labelledby="agent-stopped-outcome">
          <div className={s.sectionHeading} id="agent-stopped-outcome">
            Outcome
          </div>
          <p className={s.body}>{state.outcome}</p>
        </section>
      )}

      {mutationError && (
        <div className={s.muted} role="alert">
          {mutationError}
        </div>
      )}

      <section className={s.queue} aria-labelledby="agent-queue">
        <div className={s.sectionHeading} id="agent-queue">
          Queue
        </div>
        <p className={s.body}>{state.queue.reason}</p>
        <div className={s.nextEvent}>
          <Icon icon="clock" size={14} />
          {state.queue.nextEvent}
        </div>
      </section>

      {state.receipt && (
        <section className={s.receipt} aria-labelledby="agent-receipt">
          <div className={s.sectionHeading} id="agent-receipt">
            Receipt
          </div>
          <p className={s.body}>{state.receipt.summary}</p>
          <div className={s.muted}>{state.receipt.occurredAt}</div>
        </section>
      )}
    </div>
  );
}

function Evidence({
  evidence,
}: {
  evidence: NonNullable<Extract<AgentRecordState, { status: 'proposed' }>['evidence']>;
}) {
  return (
    <section className={s.card} aria-labelledby="agent-evidence">
      <div className={s.sectionHeading} id="agent-evidence">
        Evidence
      </div>
      <div className={s.evidenceList}>
        {evidence.map((item, index) => {
          const label = {
            VERIFIED: 'Verified',
            PROBABLE: 'Probable',
            CONFLICTED: 'Conflicted',
            REJECTED: 'Rejected',
          }[item.band];
          return (
            <article className={s.evidenceItem} key={`${item.source}-${index}`} data-testid="agent-evidence-item">
              <div className={s.evidenceMeta}>
                <span className={s.evidenceBand} data-band={item.band}>
                  {label}
                </span>
                <span className={s.muted}>{item.source}</span>
              </div>
              <blockquote className={s.quote}>“{item.quote}”</blockquote>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function displayMember(
  id: string,
  members: Array<Pick<Member, 'id' | 'firstName' | 'lastName' | 'emailAddress'>>,
): string {
  return memberName(members.find((member) => member.id === id)) || id;
}
