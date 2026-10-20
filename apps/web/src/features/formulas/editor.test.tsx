// @vitest-environment jsdom
// The CodeMirror host renders reference tokens as atomic chips ("{ Company › Name }", "{Unknown variable}"), marks
// diagnostics, and the AI composer shows its "not configured" and refusal states.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OBJ_ID } from '../attributes/test/fixtures';
import { CodeEditor } from './editor/CodeEditor';
import type { ChipResolver } from './editor/chips';
import { loadSource, variableAnnotation } from './model/source';
import { Composer } from './sheet/Composer';

afterEach(cleanup);

const hop = (id: string) => ({ entityDefinitionId: OBJ_ID, attributeDefinitionId: id });
const resolve: ChipResolver = (a) =>
  a.type === 'entity-variable' && a.path[0]?.attributeDefinitionId === 'company'
    ? { parts: ['Company', 'Name'] }
    : { parts: null };

describe('CodeEditor chips', () => {
  it('renders tokens as chips with labels, unknown ones as errors, and error marks', () => {
    const doc = loadSource({
      plaintext: 'upper(_) + _',
      annotations: [
        { ...variableAnnotation([hop('company'), hop('name')]), startPosition: 6 },
        { ...variableAnnotation([hop('gone')]), startPosition: 11 },
      ],
    });
    render(
      <CodeEditor
        mode="formula"
        initial={doc}
        resolveChip={resolve}
        errors={[{ from: 0, to: 5, message: 'Bad' }]}
        readOnly
      />,
    );
    const chips = screen.getAllByTestId('formula-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]?.textContent).toBe('{Company›Name}');
    expect(chips[0]?.dataset.state).toBe('default');
    expect(chips[1]?.textContent).toBe('{Unknown variable}');
    expect(chips[1]?.dataset.state).toBe('error');
    expect(document.querySelector('.cm-formula-error')?.textContent).toBe('upper');
  });
});

describe('AI composer', () => {
  const base = {
    editorEmpty: true,
    generating: false,
    failure: null,
    canUndo: false,
    canRedo: false,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onDismissFailure: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };

  it('says AI is not configured and disables the input', () => {
    render(<Composer {...base} configured={false} />);
    const input = screen.getByRole('textbox', { name: 'Generate with AI' });
    expect(input).toHaveProperty('disabled', true);
    expect(input.getAttribute('placeholder')).toBe('AI is not configured for this workspace');
  });

  it('shows thinking, and refusals (unsupported function: "Try a different function")', () => {
    const { rerender } = render(<Composer {...base} configured generating />);
    expect(screen.getByTestId('formula-ai-thinking').textContent).toBe('Thinking');
    expect(screen.getByRole('button', { name: 'Cancel generation' })).toBeTruthy();
    rerender(
      <Composer
        {...base}
        configured
        failure={{ category: 'unsupported_function', message: 'Regular expressions are not supported' }}
      />,
    );
    expect(screen.getByTestId('formula-ai-failure').textContent).toContain(
      'Regular expressions are not supported. Try a different function',
    );
    rerender(<Composer {...base} configured editorEmpty={false} failure={{ category: 'other', message: 'Nope' }} />);
    expect(screen.getByTestId('formula-ai-failure').textContent).toContain("Couldn't generate your formula");
    expect(screen.getByRole('textbox', { name: 'Generate with AI' }).getAttribute('placeholder')).toBe(
      'Refine your formula',
    );
  });
});
