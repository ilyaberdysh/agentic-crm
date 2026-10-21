import { describe, expect, it } from 'vitest';
import { presentAgentState } from './data';

const memberId = '11111111-1111-4111-8111-111111111111';
const actionId = '22222222-2222-4222-8222-222222222222';
const scope = {
  entityDefinitionId: '33333333-3333-4333-8333-333333333333',
  entityInstanceId: '44444444-4444-4444-8444-444444444444',
};

function persisted(status: string) {
  return {
    scope,
    unavailableActionCount: 0,
    actions: [
      {
        action: {
          id: actionId,
          digest: 'a'.repeat(64),
          status,
          version: status === 'PROPOSED' ? 1 : 2,
          proposal: {
            contractVersion: 1,
            proposalVersion: 1,
            workspaceId: '55555555-5555-4555-8555-555555555555',
            capability: 'crm.task.create',
            subject: { scope, recordVersion: '1' },
            diff: {
              operation: 'create',
              task: {
                id: '66666666-6666-4666-8666-666666666666',
                content: { text: 'Send the rollout timeline', mentions: [] },
                deadline: null,
                assigneeMemberIds: [memberId, '99999999-9999-4999-8999-999999999999'],
                linkedRecords: [scope],
                isCompleted: false,
              },
            },
            evidence: [{ id: '77777777-7777-4777-8777-777777777777', digest: 'b'.repeat(64) }],
            policy: { effect: 'require_approval', reason: 'Human review', policyVersion: 1 },
            reviewerMemberId: memberId,
            proposedBy: { type: 'workspace-member', id: memberId },
          },
        },
        evidence: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            digest: 'b'.repeat(64),
            snapshot: {
              contractVersion: 1,
              workspaceId: '55555555-5555-4555-8555-555555555555',
              scope,
              source: {
                kind: 'crm.note',
                id: '88888888-8888-4888-8888-888888888888',
                version: '1',
                contentHash: 'c'.repeat(64),
                primary: true,
                audienceMemberIds: [memberId],
                retentionClass: 'workspace',
                deletionState: 'live',
              },
              band: 'VERIFIED',
              claim: 'Customer requested a timeline.',
              fragment: { start: 0, end: 8, quote: 'Timeline' },
              capturedBy: { type: 'workspace-member', id: memberId },
              capturedAt: '2026-10-19T12:00:00.000Z',
            },
          },
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            digest: 'd'.repeat(64),
            snapshot: {
              contractVersion: 1,
              workspaceId: '55555555-5555-4555-8555-555555555555',
              scope,
              source: {
                kind: 'crm.note',
                id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                version: '1',
                contentHash: 'e'.repeat(64),
                primary: false,
                audienceMemberIds: [memberId],
                retentionClass: 'workspace',
                deletionState: 'live',
              },
              band: 'PROBABLE',
              claim: 'The customer expects a follow-up next week.',
              fragment: { start: 0, end: 8, quote: 'Next week' },
              capturedBy: { type: 'workspace-member', id: memberId },
              capturedAt: '2026-10-18T12:00:00.000Z',
            },
          },
        ],
        proposedAt: '2026-10-19T12:00:00.000Z',
        updatedAt: '2026-10-19T12:00:00.000Z',
        receipt: null,
      },
    ],
    tasks: [],
  } as unknown as Parameters<typeof presentAgentState>[0];
}

describe('persisted Agent tab presentation', () => {
  it('shows queue-only planning work instead of an empty state', () => {
    const data = persisted('PROPOSED');
    data.actions = [];
    data.tasks = [
      {
        actionId: null,
        status: 'QUEUED',
        reason: 'Waiting for a fresh customer signal.',
        nextEvent: 'Recheck after the next meeting.',
      },
    ] as typeof data.tasks;
    expect(presentAgentState(data, memberId)).toMatchObject({
      status: 'queue',
      queueStatus: 'QUEUED',
      currentStep: 'Waiting for a fresh customer signal.',
      queue: { nextEvent: 'Recheck after the next meeting.' },
    });
  });

  it('shows an exact proposal and disables decisions for anyone except its reviewer', () => {
    const owner = presentAgentState(persisted('PROPOSED'), memberId);
    expect(owner).toMatchObject({
      status: 'proposed',
      task: 'Send the rollout timeline',
      pendingDecision: { id: actionId, canDecide: true },
      evidence: [
        { band: 'VERIFIED', quote: 'Timeline' },
        { band: 'PROBABLE', quote: 'Next week' },
      ],
      assigneeMemberIds: [memberId, '99999999-9999-4999-8999-999999999999'],
      reviewerMemberId: memberId,
    });
    const teammate = presentAgentState(persisted('PROPOSED'), '99999999-9999-4999-8999-999999999999');
    expect(teammate).toMatchObject({ status: 'proposed', pendingDecision: { canDecide: false } });
  });

  it('never borrows another action queue explanation', () => {
    const data = persisted('PROPOSED');
    data.tasks = [
      {
        actionId: '99999999-9999-4999-8999-999999999999',
        reason: 'Reason for another action.',
        nextEvent: 'Another action continues.',
      },
    ] as typeof data.tasks;
    expect(presentAgentState(data, memberId)).toMatchObject({
      queue: { reason: 'No queue work is attached to this action.' },
    });
  });

  it('requires a persisted receipt before presenting success', () => {
    expect(presentAgentState(persisted('SUCCEEDED'), memberId)).toEqual({
      status: 'error',
      message: 'The completed action is missing its receipt.',
    });
  });

  it('does not present an active queue row as executable after rejection', () => {
    const data = persisted('REJECTED');
    data.tasks = [
      {
        actionId,
        status: 'QUEUED',
        reason: 'Approval will create the task.',
        nextEvent: 'Wait for approval.',
      },
    ] as typeof data.tasks;
    expect(presentAgentState(data, memberId)).toMatchObject({
      status: 'stopped',
      queue: {
        reason: 'This proposal is closed, while its linked queue row is still queued.',
        nextEvent: 'Queue reconciliation is pending; this row does not authorize a CRM write.',
      },
    });
  });

  it('presents a cancelled queue row as the terminal result of rejection', () => {
    const data = persisted('REJECTED');
    data.tasks = [
      {
        actionId,
        status: 'CANCELLED',
        reason: 'The linked action is rejected; queued work was cancelled.',
        nextEvent: 'No further queue work is scheduled for this action.',
      },
    ] as typeof data.tasks;
    expect(presentAgentState(data, memberId)).toMatchObject({
      status: 'stopped',
      queue: {
        reason: 'The linked action is rejected; queued work was cancelled.',
        nextEvent: 'No further queue work is scheduled for this action.',
      },
    });
  });
});
