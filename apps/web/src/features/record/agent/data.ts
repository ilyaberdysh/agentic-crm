import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, errorEnvelopeOf, inWorkspace, noteAcceptAfter, type RouterOutputs } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { useMembers } from '../../attributes';
import { useWorkspace } from '../../shell/workspaceContext';
import type { RecordRef } from '../context';
import { recordKeys } from '../data';
import type { AgentRecordState, RecordAgentTabProps } from './agentState';

type PersistedState = RouterOutputs['agentic']['recordState'];
type Activity = PersistedState['actions'][number];

const agentKey = (workspaceId: string, scope: RecordRef) =>
  [...recordKeys.timeline(workspaceId, scope.entityDefinitionId, scope.entityInstanceId), 'agent'] as const;

function shownAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function queueFor(data: PersistedState, actionId: string) {
  const row = data.tasks.find((task) => task.actionId === actionId);
  return row
    ? { reason: row.reason, nextEvent: row.nextEvent }
    : { reason: 'No queue work is attached to this action.', nextEvent: 'No automatic work is scheduled.' };
}

function closedQueueFor(data: PersistedState, actionId: string) {
  const row = data.tasks.find((task) => task.actionId === actionId);
  if (!row || row.status === 'SUCCEEDED' || row.status === 'FAILED_TERMINAL' || row.status === 'CANCELLED')
    return queueFor(data, actionId);
  return {
    reason: `This proposal is closed, while its linked queue row is still ${row.status.toLowerCase()}.`,
    nextEvent: 'Queue reconciliation is pending; this row does not authorize a CRM write.',
  };
}

export function presentAgentState(data: PersistedState, memberId: string): AgentRecordState {
  const activity = data.actions[0];
  if (!activity) {
    if (data.unavailableActionCount > 0)
      return { status: 'error', message: 'Agent evidence changed or is no longer available to you.' };
    const task = data.tasks[0];
    if (task)
      return {
        status: 'queue',
        queueStatus: task.status,
        goal: 'Follow up on this record.',
        task: 'Evaluate the next useful follow-up',
        currentStep: task.reason,
        queue: { reason: task.reason, nextEvent: task.nextEvent },
      };
    return { status: 'empty' };
  }
  const { action } = activity;
  const evidence = activity.evidence;
  if (evidence.length === 0) return { status: 'error', message: 'This action has no readable supporting evidence.' };
  const task = action.proposal.diff.task;
  const deadline =
    task.deadline === null
      ? 'No deadline'
      : task.deadline.kind === 'date'
        ? `Due ${task.deadline.date}`
        : `Due ${shownAt(task.deadline.at)}`;
  const shared = {
    goal: 'Prepare a useful follow-up from the latest customer request.',
    task: task.content.text,
    currentStep: `${deadline} · Linked to this record`,
    evidence: evidence.map(({ snapshot }) => ({
      band: snapshot.band,
      quote: snapshot.fragment.quote,
      source: `CRM note · ${shownAt(snapshot.capturedAt)}`,
    })),
    assigneeMemberIds: task.assigneeMemberIds,
    reviewerMemberId: action.proposal.reviewerMemberId,
    queue: queueFor(data, action.id),
  } as const;
  const ownsDecision = action.proposal.reviewerMemberId === memberId;
  switch (action.status) {
    case 'PROPOSED':
      return {
        ...shared,
        status: 'proposed',
        pendingDecision: {
          id: action.id,
          question: `Create the task “${task.content.text}”?`,
          canDecide: ownsDecision,
        },
      };
    case 'APPROVED':
      return {
        ...shared,
        status: 'approved',
        currentStep: 'The exact task diff is approved but has not been written yet.',
        pendingExecution: {
          id: action.id,
          question: 'Create the exact approved task and record its receipt?',
          canExecute: ownsDecision,
        },
      };
    case 'EXECUTING':
      return { ...shared, status: 'running', currentStep: 'The approved task write is in progress.' };
    case 'SUCCEEDED': {
      const receipt = activity.receipt;
      if (!receipt) return { status: 'error', message: 'The completed action is missing its receipt.' };
      return {
        ...shared,
        status: 'completed',
        currentStep: 'The approved task was created and linked to this record.',
        receipt: { summary: `Created task “${task.content.text}”.`, occurredAt: shownAt(receipt.createdAt) },
      };
    }
    case 'REJECTED':
      return {
        ...shared,
        status: 'stopped',
        currentStep: 'The reviewer declined this proposal.',
        queue: closedQueueFor(data, action.id),
        outcome: 'Declined',
      };
    case 'STALE':
      return {
        ...shared,
        status: 'stopped',
        currentStep: 'The record or evidence changed after this proposal was prepared.',
        queue: closedQueueFor(data, action.id),
        outcome: 'Stale proposal',
      };
    case 'FAILED_TERMINAL':
      return {
        ...shared,
        status: 'stopped',
        currentStep: 'The approved task could not be created.',
        queue: closedQueueFor(data, action.id),
        outcome: 'Execution failed',
      };
    case 'OUTCOME_UNKNOWN':
      return {
        ...shared,
        status: 'stopped',
        currentStep: 'The executor disconnected before the result was known.',
        queue: closedQueueFor(data, action.id),
        outcome: 'Outcome requires reconciliation',
      };
  }
}

export function useAgentTab(scope: RecordRef): RecordAgentTabProps {
  const { workspace } = useWorkspace();
  const members = useMembers();
  const client = useQueryClient();
  const queryKey = agentKey(workspace.id, scope);
  const query = useQuery({
    queryKey,
    queryFn: () => api.agentic.recordState.query({ scope }, inWorkspace(workspace)),
  });

  const mutation = useMutation({
    mutationFn: async (command: { actionId: string; outcome?: 'APPROVE' | 'REJECT'; executeOnly?: boolean }) => {
      const activity = query.data?.actions.find((item) => item.action.id === command.actionId);
      if (!activity) throw new Error('The action is no longer available.');
      let state = activity.action;
      if (!command.executeOnly) {
        const decided = await api.agentic.decide.mutate(
          {
            id: newId(),
            actionId: state.id,
            proposalDigest: state.digest,
            expectedVersion: state.version,
            outcome: command.outcome ?? 'REJECT',
          },
          inWorkspace(workspace),
        );
        noteAcceptAfter(workspace.id, decided.seq);
        if (command.outcome !== 'APPROVE' || decided.status !== 'APPROVED') return;
        state = { ...state, status: decided.status, version: decided.version };
      }
      const executed = await api.agentic.executeTaskCreate.mutate(
        {
          id: newId(),
          receiptId: newId(),
          actionId: state.id,
          proposalDigest: state.digest,
          expectedVersion: state.version,
        },
        inWorkspace(workspace),
      );
      noteAcceptAfter(workspace.id, executed.seq);
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({
          queryKey: recordKeys.tasks(workspace.id, scope.entityDefinitionId, scope.entityInstanceId),
        }),
      ]);
    },
  });

  return useMemo(() => {
    const state: AgentRecordState = query.isPending
      ? { status: 'loading' }
      : query.isError
        ? { status: 'error', message: errorEnvelopeOf(query.error).message ?? 'Agent activity could not be loaded.' }
        : presentAgentState(query.data as PersistedState, workspace.membership.id);
    return {
      state,
      members,
      onDecision: (actionId, decision) =>
        mutation.mutate({ actionId, outcome: decision === 'approve' ? 'APPROVE' : 'REJECT' }),
      onExecute: (actionId) => mutation.mutate({ actionId, executeOnly: true }),
      isPending: mutation.isPending,
      mutationError: mutation.isError
        ? (errorEnvelopeOf(mutation.error).message ?? 'The action could not be completed. Reload and try again.')
        : undefined,
    };
  }, [
    mutation.error,
    mutation.isError,
    mutation.isPending,
    query.data,
    query.error,
    query.isError,
    query.isPending,
    workspace.membership.id,
    members,
  ]);
}
