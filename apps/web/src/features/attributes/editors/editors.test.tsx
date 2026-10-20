// @vitest-environment jsdom
// Editors' commit logic: keys (Enter / Shift+Enter / Tab / Escape), blur commits, typed-key starts, parsing and the
// ops multi-value pickers emit.
import { toastStore } from '@agentic-crm/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keys } from '../../../data/keys';
import { AttributeEnvProvider } from '../data/env';
import { setFormatSettings } from '../format/locale';
import { attr, OBJ_ID, row, WS_ID } from '../test/fixtures';
import type { AttributeDefinition, EditorProps, SelectOption } from '../types';
import { DateEditor } from './date';
import { CheckboxEditor, CurrencyEditor, NumberEditor, RatingEditor, TextEditor } from './inline';
import { EmailEditor } from './lists';
import { SelectEditor, StatusEditor } from './pickers';

const option = (id: string, title: string): SelectOption => ({
  id,
  workspaceId: WS_ID,
  entityDefinitionId: OBJ_ID,
  attributeDefinitionId: 'x',
  title,
  color: 'pastel_grey',
  sortOrder: id,
  isArchived: false,
  createdAt: '2026-01-01T00:00:00Z',
});

let client: QueryClient;
const createOption = vi.fn(async (_a: AttributeDefinition, title: string) => option('zz', title));

function wrap(ui: ReactNode) {
  return (
    <QueryClientProvider client={client}>
      <AttributeEnvProvider
        value={{
          workspace: { id: WS_ID, slug: 'test' },
          memberId: null,
          searchRecords: async () => [],
          searchMembers: async () => [],
          createOption,
        }}
      >
        {ui}
      </AttributeEnvProvider>
    </QueryClientProvider>
  );
}

function setup(
  Editor: (p: EditorProps) => ReactNode,
  props: Partial<EditorProps> & { attribute: AttributeDefinition },
) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const utils = render(wrap(<Editor values={[]} onCommit={onCommit} onCancel={onCancel} {...props} />));
  return { onCommit, onCancel, ...utils };
}

beforeEach(() => {
  setFormatSettings({ locale: 'ru-RU', timeZone: 'Europe/Moscow', weekStartsOn: 1 });
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
  createOption.mockClear();
});
afterEach(() => {
  cleanup();
  setFormatSettings(null);
  for (const t of toastStore.getSnapshot()) toastStore.dismiss(t.id);
});

describe('TextEditor', () => {
  it('Enter commits, Shift+Enter adds a line, Escape cancels', async () => {
    const user = userEvent.setup();
    const text = attr('text');
    const { onCommit } = setup(TextEditor, { attribute: text, values: [row(text, 'Courier')] });
    const box = screen.getByRole('textbox');
    await user.type(box, ' app{Shift>}{Enter}{/Shift}redesign{Enter}');
    expect(onCommit).toHaveBeenCalledWith([{ value: 'Courier app\nredesign' }], { via: 'enter' });
    cleanup();
    const second = setup(TextEditor, { attribute: text, values: [row(text, 'Courier')] });
    await user.keyboard('{Escape}');
    expect(second.onCancel).toHaveBeenCalledWith({ via: 'escape' });
    expect(second.onCommit).not.toHaveBeenCalled();
  });

  it('a typed key replaces the value; Tab commits; clearing commits an empty set', async () => {
    const user = userEvent.setup();
    const text = attr('text');
    const { onCommit } = setup(TextEditor, { attribute: text, values: [row(text, 'Old')], initialKey: 'N' });
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'N');
    await user.keyboard('ew{Tab}');
    expect(onCommit).toHaveBeenCalledWith([{ value: 'New' }], { via: 'tab' });
    cleanup();
    const cleared = setup(TextEditor, { attribute: text, values: [row(text, 'Old')] });
    await user.clear(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');
    expect(cleared.onCommit).toHaveBeenCalledWith([], { via: 'enter' });
  });

  it('a press outside commits (blur)', async () => {
    const text = attr('text');
    const { onCommit } = setup(TextEditor, { attribute: text, initialKey: 'x' });
    fireEvent.pointerDown(document.body);
    expect(onCommit).toHaveBeenCalledWith([{ value: 'x' }], { via: 'blur' });
  });
});

describe('NumberEditor / CurrencyEditor', () => {
  it('parses the locale format and refuses junk', async () => {
    const user = userEvent.setup();
    const n = attr('number');
    const { onCommit } = setup(NumberEditor, { attribute: n, initialKey: '1' });
    await user.keyboard(' 200,5{Enter}');
    expect(onCommit).toHaveBeenCalledWith([{ value: 1200.5 }], { via: 'enter' });
    cleanup();
    const bad = setup(NumberEditor, { attribute: n, initialKey: 'x' });
    await user.keyboard('{Enter}');
    expect(bad.onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
  });

  it('currency: typed digits append to the amount; writes the attribute currency', async () => {
    const user = userEvent.setup();
    const budget = attr('currency', {
      config: {
        currencyConfiguration: {
          defaultCurrencyCode: 'EUR',
          defaultDisplayType: 'symbol',
          defaultDecimalPlaces: 'two-decimals',
          defaultGroups: 'default',
        },
      },
    });
    const { onCommit } = setup(CurrencyEditor, {
      attribute: budget,
      values: [row(budget, { currencyValue: 15, currencyCode: null })],
      initialKey: '0',
    });
    expect(screen.getByRole('textbox')).toHaveProperty('value', '150');
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith([{ value: { currencyValue: 150, currencyCode: 'EUR' } }], { via: 'enter' });
  });
});

describe('checkbox and rating', () => {
  it('checkbox toggles on open (false is written)', () => {
    const c = attr('checkbox');
    const { onCommit } = setup(CheckboxEditor, { attribute: c, values: [row(c, true)] });
    expect(onCommit).toHaveBeenCalledWith([{ value: false }], { via: 'pick' });
  });

  it('rating: digit keys set, 0 clears, arrows + Enter commit', async () => {
    const r = attr('rating');
    expect(setup(RatingEditor, { attribute: r, initialKey: '3' }).onCommit).toHaveBeenCalledWith([{ value: 3 }], {
      via: 'shortcut',
    });
    cleanup();
    expect(setup(RatingEditor, { attribute: r, values: [row(r, 4)], initialKey: '0' }).onCommit).toHaveBeenCalledWith(
      [],
      {
        via: 'shortcut',
      },
    );
    cleanup();
    const user = userEvent.setup();
    const third = setup(RatingEditor, { attribute: r, values: [row(r, 2)] });
    await user.keyboard('{ArrowRight}{ArrowRight}{Enter}');
    expect(third.onCommit).toHaveBeenCalledWith([{ value: 4 }], { via: 'enter' });
  });
});

describe('drafts', () => {
  it('inline editors report the draft while typing', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    setup(TextEditor, { attribute: attr('text'), onDraftChange });
    await user.keyboard('Hi');
    expect(onDraftChange).toHaveBeenLastCalledWith([{ value: 'Hi' }]);
    cleanup();
    const numberDraft = vi.fn();
    setup(NumberEditor, { attribute: attr('number'), onDraftChange: numberDraft });
    await user.keyboard('1 200,5');
    expect(numberDraft).toHaveBeenLastCalledWith([{ value: 1200.5 }]);
  });
});

describe('pickers', () => {
  it('single select: keyboard pick commits the option', async () => {
    const user = userEvent.setup();
    const priority = attr('select');
    client.setQueryData(keys.options(WS_ID, OBJ_ID, priority.id), [option('o1', 'Low'), option('o2', 'Medium')]);
    client.setQueryData([...keys.object(WS_ID, OBJ_ID), 'policy'], null);
    const { onCommit } = setup(SelectEditor, { attribute: priority });
    await user.keyboard('med{Enter}');
    expect(onCommit).toHaveBeenCalledWith([{ value: { selectOptionId: 'o2' } }], { via: 'pick' });
  });

  it('single select: "Create “query”" creates the option and selects it', async () => {
    const user = userEvent.setup();
    const priority = attr('select');
    client.setQueryData(keys.options(WS_ID, OBJ_ID, priority.id), [option('o1', 'Low')]);
    client.setQueryData([...keys.object(WS_ID, OBJ_ID), 'policy'], null);
    const { onCommit } = setup(SelectEditor, { attribute: priority });
    await user.keyboard('Zeta');
    expect(screen.getByText('Create “Zeta”')).toBeTruthy();
    await user.keyboard('{Enter}');
    await act(async () => {});
    expect(createOption).toHaveBeenCalledWith(priority, 'Zeta');
    expect(onCommit).toHaveBeenCalledWith([{ value: { selectOptionId: 'zz' } }], { via: 'pick' });
  });

  it('multi select (liveCommit): toggles write immediately and keep the picker open', async () => {
    const user = userEvent.setup();
    const tags = attr('select', { isMultiselect: true });
    client.setQueryData(keys.options(WS_ID, OBJ_ID, tags.id), [option('o1', 'AI'), option('o2', 'CRM')]);
    client.setQueryData([...keys.object(WS_ID, OBJ_ID), 'policy'], null);
    const current = row(tags, { selectOptionId: 'o1' }, { id: 'val-ai' });
    const { onCommit } = setup(SelectEditor, { attribute: tags, values: [current], liveCommit: true });
    const options = screen.getAllByRole('option');
    expect(options[0]?.textContent).toContain('AI'); // selected first
    await user.click(screen.getByText('CRM'));
    expect(onCommit).toHaveBeenLastCalledWith([{ op: 'put', value: { selectOptionId: 'o2' } }], {
      via: 'pick',
      keepOpen: true,
    });
    await user.click(screen.getByText('AI'));
    expect(onCommit).toHaveBeenLastCalledWith([{ op: 'retire', id: 'val-ai' }], { via: 'pick', keepOpen: true });
  });

  it('multi select (default): toggles change a working set, broadcast as drafts, committed once on close', async () => {
    const user = userEvent.setup();
    const tags = attr('select', { isMultiselect: true });
    client.setQueryData(keys.options(WS_ID, OBJ_ID, tags.id), [option('o1', 'AI'), option('o2', 'CRM')]);
    client.setQueryData([...keys.object(WS_ID, OBJ_ID), 'policy'], null);
    const current = row(tags, { selectOptionId: 'o1' }, { id: 'val-ai', sortOrder: 'h' });
    const onDraftChange = vi.fn();
    const { onCommit, onCancel } = setup(SelectEditor, { attribute: tags, values: [current], onDraftChange });
    await user.click(screen.getByText('CRM'));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onDraftChange).toHaveBeenLastCalledWith([
      { id: 'val-ai', value: { selectOptionId: 'o1' }, sortOrder: 'h' },
      expect.objectContaining({ value: { selectOptionId: 'o2' } }),
    ]);
    // The working set shows CRM as selected now.
    expect(screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(2);
    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledWith(
      [
        { id: 'val-ai', value: { selectOptionId: 'o1' }, sortOrder: 'h' },
        expect.objectContaining({ value: { selectOptionId: 'o2' } }),
      ],
      { via: 'escape' },
    );
  });

  it('multi select (default): closing without changes cancels', async () => {
    const user = userEvent.setup();
    const tags = attr('select', { isMultiselect: true });
    client.setQueryData(keys.options(WS_ID, OBJ_ID, tags.id), [option('o1', 'AI')]);
    client.setQueryData([...keys.object(WS_ID, OBJ_ID), 'policy'], null);
    const { onCommit, onCancel } = setup(SelectEditor, { attribute: tags });
    await user.keyboard('{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith({ via: 'escape' });
  });

  it('status: Escape cancels', async () => {
    const user = userEvent.setup();
    const phase = attr('pipeline');
    client.setQueryData([...keys.options(WS_ID, OBJ_ID, phase.id), 'stages'], []);
    const { onCancel } = setup(StatusEditor, { attribute: phase });
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledWith({ via: 'escape' });
  });
});

describe('date and value lists', () => {
  it('date: clicking a day commits it; "No date" clears', async () => {
    const user = userEvent.setup();
    const d = attr('date');
    const { onCommit } = setup(DateEditor, { attribute: d, values: [row(d, '2026-10-09')] });
    await user.click(screen.getByRole('gridcell', { name: '2026-10-15' }));
    expect(onCommit).toHaveBeenCalledWith([{ value: '2026-10-15' }], { via: 'pick' });
    cleanup();
    const second = setup(DateEditor, { attribute: d, values: [row(d, '2026-10-09')] });
    await user.click(screen.getByText('No date'));
    expect(second.onCommit).toHaveBeenCalledWith([], { via: 'pick' });
  });

  it('email: an invalid address raises the spec toast and writes nothing; a valid one is added', async () => {
    const user = userEvent.setup();
    const emails = attr('email-address', { isMultiselect: true });
    const { onCommit } = setup(EmailEditor, { attribute: emails, liveCommit: true });
    await user.keyboard('not-an-email{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(toastStore.getSnapshot()[0]?.title).toBe('You have entered an invalid email address');
    const input = screen.getByRole('textbox', { name: 'Add email...' });
    await user.clear(input);
    await user.type(input, 'jane@northwind.example.com{Enter}');
    expect(onCommit).toHaveBeenCalledWith([{ op: 'put', value: 'jane@northwind.example.com' }], {
      via: 'enter',
      keepOpen: true,
    });
  });
});
