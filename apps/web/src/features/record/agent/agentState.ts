import type { Member } from '../../attributes/types';

export type EvidenceBand = 'VERIFIED' | 'PROBABLE' | 'CONFLICTED' | 'REJECTED';

export interface AgentEvidence {
  band: EvidenceBand;
  quote: string;
  source: string;
}

export interface AgentQueueState {
  reason: string;
  nextEvent: string;
}

export interface AgentReceipt {
  summary: string;
  occurredAt: string;
}

interface AgentWork {
  goal: string;
  task: string;
  currentStep: string;
  evidence?: AgentEvidence[];
  assigneeMemberIds?: string[];
  reviewerMemberId?: string | null;
  queue: AgentQueueState;
  receipt?: AgentReceipt;
}

export type AgentDecision = 'approve' | 'reject';

export type AgentRecordState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | (AgentWork & {
      status: 'proposed';
      evidence: AgentEvidence[];
      pendingDecision: { id: string; question: string; canDecide?: boolean };
    })
  | (AgentWork & {
      status: 'approved';
      evidence: AgentEvidence[];
      pendingExecution: { id: string; question: string; canExecute?: boolean };
    })
  | (AgentWork & {
      status: 'queue';
      queueStatus: 'QUEUED' | 'LEASED' | 'SUCCEEDED' | 'FAILED_TERMINAL' | 'BLOCKED' | 'CANCELLED';
    })
  | (AgentWork & { status: 'running' })
  | (AgentWork & { status: 'completed'; evidence: AgentEvidence[]; receipt: AgentReceipt })
  | (AgentWork & { status: 'stopped'; evidence: AgentEvidence[]; outcome: string });

export interface RecordAgentTabProps {
  state: AgentRecordState;
  members?: Array<Pick<Member, 'id' | 'firstName' | 'lastName' | 'emailAddress'>>;
  onDecision?: (decisionId: string, decision: AgentDecision) => void;
  onExecute?: (actionId: string) => void;
  isPending?: boolean;
  mutationError?: string;
}

/** Local presentation fixtures keep each record-tab state reviewable until the W9 capability is wired. */
export const agentTabFixtures = {
  empty: { status: 'empty' },
  loading: { status: 'loading' },
  error: { status: 'error', message: 'Agent activity could not be loaded.' },
  proposed: {
    status: 'proposed',
    goal: 'Prepare a useful follow-up after the latest conversation.',
    task: 'Create a follow-up task',
    currentStep: 'Waiting for a person to review the proposed task.',
    evidence: [
      {
        band: 'VERIFIED',
        quote: 'Could you send over the rollout timeline by Friday?',
        source: 'Customer request note · 18 Oct 2026',
      },
    ],
    assigneeMemberIds: ['member-ava', 'member-noah'],
    reviewerMemberId: 'member-mira',
    pendingDecision: {
      id: 'decision-follow-up',
      question: 'Create this follow-up task?',
    },
    queue: {
      reason: 'A person must approve the task before it can be created.',
      nextEvent: 'The task will resume after a decision.',
    },
  },
  running: {
    status: 'running',
    goal: 'Prepare a useful follow-up after the latest conversation.',
    task: 'Check the rollout timeline and prepare a follow-up',
    currentStep: 'Comparing the latest call notes with the open opportunity.',
    evidence: [
      {
        band: 'PROBABLE',
        quote: 'We should have a clearer timeline after our internal review.',
        source: 'Customer request note · 18 Oct 2026',
      },
    ],
    queue: {
      reason: 'The current step has an active worker lease.',
      nextEvent: 'The next update will appear when this step finishes.',
    },
  },
  approved: {
    status: 'approved',
    goal: 'Prepare a useful follow-up after the latest conversation.',
    task: 'Create the rollout follow-up task',
    currentStep: 'The exact task was approved and is ready to be created.',
    evidence: [
      {
        band: 'VERIFIED',
        quote: 'Could you send over the rollout timeline by Friday?',
        source: 'Customer request note · 18 Oct 2026',
      },
    ],
    pendingExecution: { id: 'action-follow-up', question: 'Create the approved task now?' },
    queue: {
      reason: 'The task has human approval but has not been created yet.',
      nextEvent: 'Creating it will write the exact approved task and a receipt.',
    },
  },
  completed: {
    status: 'completed',
    goal: 'Prepare a useful follow-up after the latest conversation.',
    task: 'Create the rollout follow-up task',
    currentStep: 'The approved task was created and linked to this record.',
    evidence: [
      {
        band: 'VERIFIED',
        quote: 'We can share the rollout plan on Friday.',
        source: 'Customer request note · 18 Oct 2026',
      },
    ],
    queue: {
      reason: 'No blocked work remains for this goal.',
      nextEvent: 'Nothing is waiting to run.',
    },
    receipt: {
      summary: 'Created task “Send rollout plan on Friday”.',
      occurredAt: '18 Oct 2026 · 3:42 PM',
    },
  },
  stopped: {
    status: 'stopped',
    goal: 'Prepare a useful follow-up after the latest conversation.',
    task: 'Create the rollout follow-up task',
    currentStep: 'This proposal will not run.',
    evidence: [
      {
        band: 'VERIFIED',
        quote: 'Could you send over the rollout timeline by Friday?',
        source: 'Customer request note · 18 Oct 2026',
      },
    ],
    queue: { reason: 'The proposal is closed.', nextEvent: 'No automatic work is scheduled.' },
    outcome: 'Declined by the assigned reviewer',
  },
} satisfies Record<string, AgentRecordState>;

export const EMPTY_AGENT_STATE: AgentRecordState = agentTabFixtures.empty;
