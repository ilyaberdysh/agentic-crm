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

  it('sends a narrow decision command and shows the completed receipt', () => {
    const onDecision = vi.fn();
    const { rerender } = render(<RecordAgentTab state={agentTabFixtures.proposed} onDecision={onDecision} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecision).toHaveBeenCalledWith('decision-follow-up', 'approve');

    rerender(<RecordAgentTab state={agentTabFixtures.completed} />);
    expect(screen.getByText(/Created task/)).toBeTruthy();
    expect(screen.getByText('18 Oct 2026 · 3:42 PM')).toBeTruthy();
  });
});
