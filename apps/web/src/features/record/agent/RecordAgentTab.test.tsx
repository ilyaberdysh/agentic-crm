// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentTabFixtures } from './agentState';
import { RecordAgentTab } from './RecordAgentTab';

afterEach(cleanup);

describe('record Agent tab', () => {
  it.each(['empty', 'loading', 'error'] as const)('renders the %s state', (status) => {
    render(<RecordAgentTab state={agentTabFixtures[status]} />);
    expect(screen.getByTestId(`agent-state-${status}`)).toBeTruthy();
  });

  it('shows evidence, a pending decision, and queue reason for proposed work', () => {
    render(<RecordAgentTab state={agentTabFixtures.proposed} />);
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByText(/Could you send over the rollout timeline/)).toBeTruthy();
    expect(screen.getByText(/must approve the task/)).toBeTruthy();
    expect(screen.getByText('Create this follow-up task?')).toBeTruthy();
  });

  it('shows every evidence item and each exact task and reviewer identity', () => {
    const state = {
      ...agentTabFixtures.proposed,
      evidence: [
        { band: 'VERIFIED' as const, quote: 'Send the timeline by Friday.', source: 'CRM note · 18 Oct 2026' },
        {
          band: 'PROBABLE' as const,
          quote: 'The rollout may start next month.',
          source: 'Call transcript · 17 Oct 2026',
        },
      ],
      assigneeMemberIds: ['member-ava', 'member-noah'],
      reviewerMemberId: 'member-mira',
    };
    render(
      <RecordAgentTab
        state={state}
        members={[
          { id: 'member-ava', firstName: 'Ava', lastName: 'Chen', emailAddress: 'ava@example.com' },
          { id: 'member-noah', firstName: 'Noah', lastName: 'Patel', emailAddress: 'noah@example.com' },
          { id: 'member-mira', firstName: 'Mira', lastName: 'Jones', emailAddress: 'mira@example.com' },
        ]}
      />,
    );

    expect(screen.getAllByTestId('agent-evidence-item')).toHaveLength(2);
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByText('Probable')).toBeTruthy();
    expect(screen.getByText(/Send the timeline by Friday/)).toBeTruthy();
    expect(screen.getByText('Call transcript · 17 Oct 2026')).toBeTruthy();
    expect(screen.getByText('Ava Chen · ava@example.com')).toBeTruthy();
    expect(screen.getByText('Noah Patel · noah@example.com')).toBeTruthy();
    expect(screen.getByText('Mira Jones · mira@example.com')).toBeTruthy();
    expect(screen.queryByText(/2 assigned/)).toBeNull();
  });

  it('sends a narrow decision command and shows the completed receipt', () => {
    const onDecision = vi.fn();
    const { rerender } = render(<RecordAgentTab state={agentTabFixtures.proposed} onDecision={onDecision} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecision).toHaveBeenCalledWith('decision-follow-up', 'approve');

    rerender(<RecordAgentTab state={agentTabFixtures.completed} />);
    expect(screen.getByText(/Created task/)).toBeTruthy();
    expect(screen.getByText('18 Oct 2026 · 3:42 PM')).toBeTruthy();
  });

  it('disables decisions for a non-reviewer and while a decision is pending', () => {
    const state = {
      ...agentTabFixtures.proposed,
      pendingDecision: { ...agentTabFixtures.proposed.pendingDecision, canDecide: false },
    };
    const onDecision = vi.fn();
    const { rerender } = render(<RecordAgentTab state={state} onDecision={onDecision} />);
    const approve = screen.getByRole('button', { name: 'Approve' });
    const decline = screen.getByRole('button', { name: 'Decline' });
    expect(approve).toHaveProperty('disabled', true);
    expect(decline).toHaveProperty('disabled', true);
    fireEvent.click(approve);
    fireEvent.click(decline);
    expect(onDecision).not.toHaveBeenCalled();

    rerender(<RecordAgentTab state={agentTabFixtures.proposed} onDecision={onDecision} isPending />);
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Decline' })).toHaveProperty('disabled', true);
  });

  it('executes the exact approved action id', () => {
    const onExecute = vi.fn();
    render(<RecordAgentTab state={agentTabFixtures.approved} onExecute={onExecute} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(onExecute).toHaveBeenCalledOnce();
    expect(onExecute).toHaveBeenCalledWith('action-follow-up');
  });
});
