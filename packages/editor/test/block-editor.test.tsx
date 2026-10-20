// @vitest-environment jsdom
// The email editors (BlockEditor / LineEditor): content in and out as blocks, variable chips and the commands the
// composer uses (insert, update fallback, delete).
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockEditor, type EmailEditorHandle, LineEditor, type LineValue, type VariableInput } from '../src/index.ts';
import { type Block, textBlock } from '../src/model/index.ts';

afterEach(cleanup);

const name: VariableInput = {
  path: [{ entityDefinitionId: 'people', attributeDefinitionId: 'name' }],
  field: 'first_name',
  fallback: null,
  label: 'Name › First',
};

function mountBody(initial: Block[]) {
  let handle: EmailEditorHandle | null = null;
  const changes: Block[][] = [];
  const view = render(
    <BlockEditor
      initialBlocks={initial}
      onChange={(blocks) => changes.push(blocks)}
      onReady={(h) => {
        handle = h;
      }}
    />,
  );
  return { view, changes, handle: () => handle as EmailEditorHandle };
}

describe('BlockEditor', () => {
  it('renders blocks with variable chips', () => {
    const { view } = mountBody([
      {
        ...textBlock('unstyled', 'Hi _, welcome'),
        variables: [
          { start: 3, length: 1, path: name.path, field: 'first_name', fallback: 'there', label: name.label },
        ],
      },
    ]);
    const chip = view.container.querySelector('.agentic-crm-variable') as HTMLElement;
    expect(chip.textContent).toBe('{ Name › First }');
    expect(chip.getAttribute('data-variable-fallback')).toBe('there');
  });

  it('inserts a variable at the caret and reports it as one placeholder character', () => {
    const { changes, handle } = mountBody([textBlock('unstyled', 'Hello ')]);
    act(() => {
      handle().focus('end');
      handle().insertVariable(name);
    });
    const blocks = changes.at(-1) as Block[];
    expect(blocks[0]?.text).toBe('Hello _');
    expect(blocks[0]?.variables).toEqual([
      expect.objectContaining({ start: 6, length: 1, field: 'first_name', fallback: null, label: 'Name › First' }),
    ]);
  });

  it('replaces the typed brace and updates the fallback of a chip', () => {
    const { changes, handle } = mountBody([textBlock('unstyled', 'Hi {')]);
    act(() => {
      handle().insertVariable(name, { from: 4, to: 5 });
    });
    expect((changes.at(-1) as Block[])[0]?.text).toBe('Hi _');
    const pos = 4;
    act(() => handle().updateVariable(pos, { fallback: 'there' }));
    expect((changes.at(-1) as Block[])[0]?.variables?.[0]?.fallback).toBe('there');
    act(() => handle().deleteVariable(pos));
    const last = changes.at(-1) as Block[];
    expect(last[0]?.text).toBe('Hi ');
    expect(last[0]?.variables ?? []).toEqual([]);
  });

  it('appends blocks and replaces the content', () => {
    const { handle } = mountBody([textBlock('unstyled', 'Body')]);
    act(() => handle().appendBlocks([textBlock('unstyled', ''), textBlock('unstyled', 'Signature')]));
    expect(
      handle()
        .getBlocks()
        .map((b) => b.text),
    ).toEqual(['Body', '', 'Signature']);
    act(() => handle().setBlocks([textBlock('ul', 'one')]));
    expect(handle().getBlocks()).toEqual([expect.objectContaining({ type: 'ul', text: 'one' })]);
  });
});

describe('LineEditor', () => {
  it('keeps a single line and reports variables', () => {
    let handle: EmailEditorHandle | null = null;
    const values: LineValue[] = [];
    const onEnter = vi.fn();
    render(
      <LineEditor
        initial={{ text: 'Re: ', variables: [] }}
        onChange={(v) => values.push(v)}
        onEnter={onEnter}
        onReady={(h) => {
          handle = h;
        }}
      />,
    );
    act(() => {
      (handle as EmailEditorHandle | null)?.focus('end');
      (handle as EmailEditorHandle | null)?.insertVariable(name);
    });
    expect(values.at(-1)?.text).toBe('Re: _');
    expect(values.at(-1)?.variables[0]).toEqual(expect.objectContaining({ start: 4, field: 'first_name' }));
  });
});
