// @vitest-environment jsdom
import { aiTargetModelChoice } from '@agentic-crm/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelPicker } from './ModelPicker';

const target = aiTargetModelChoice('12345678-1234-4567-8901-123456789abc', 4);
vi.mock('../data', () => ({
  useModels: () => ({
    data: {
      configured: true,
      models: [
        { id: 'claude-opus-5-5', label: 'Opus', brand: 'anthropic', isAuto: true, isUnavailable: true },
        { id: target, label: 'My model · Local', brand: 'openai-compatible', isAuto: false, isUnavailable: false },
      ],
    },
  }),
}));

afterEach(cleanup);

describe('saved target model picker', () => {
  it('shows the saved target and returns its version-pinned choice on selection', async () => {
    const onChange = vi.fn();
    render(<ModelPicker value="auto" onChange={onChange} />);
    fireEvent.keyDown(screen.getByTestId('ask-model-picker'), { key: 'ArrowDown' });
    const saved = await screen.findByText('My model · Local');
    await userEvent.click(saved);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(target));
  });

  it('labels the selected saved target instead of Auto', () => {
    render(<ModelPicker value={target} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Chosen model: My model · Local' })).toBeDefined();
  });
});
