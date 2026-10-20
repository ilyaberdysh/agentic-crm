import { type Block, textBlock } from '@agentic-crm/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ComposerApi, ComposerSession, type Draft } from './session';

const p = (text: string): Block => textBlock('unstyled', text);

function draft(patch: Partial<Draft> = {}): Draft {
  return {
    id: 'd1',
    workspaceId: 'w',
    memberId: 'm',
    senderMailboxId: 'mb1',
    subject: { text: '', variables: [] },
    body: [p('')],
    to: [],
    cc: [],
    bcc: [],
    isMassSend: false,
    signatureId: null,
    parentMessageId: null,
    templateId: null,
    attachments: [],
    revision: 0,
    fieldUpdatedAt: {},
    hasVariables: false,
    preview: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...patch,
  } as Draft;
}

type FakeApi = ComposerApi & { failNext?: boolean; failUpload?: boolean };

function fakeApi(initial: Draft = draft()) {
  const server = { draft: initial };
  const calls = {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    createAttachment: vi.fn(),
    upload: vi.fn(),
    commitAttachment: vi.fn(),
    removeAttachment: vi.fn(),
  };
  const api: FakeApi = {
    create: async (input) => {
      calls.create(input);
      return server.draft;
    },
    get: async () => server.draft,
    update: async (input) => {
      calls.update(input);
      if (api.failNext) {
        api.failNext = false;
        throw new Error('boom');
      }
      server.draft = {
        ...server.draft,
        revision: server.draft.revision + 1,
        // The server resolves recipients to records.
        to: (input.to ?? server.draft.to).map((r) => ({ ...r, record: r.record ?? null })) as Draft['to'],
      };
      return server.draft;
    },
    remove: async (id) => {
      calls.remove(id);
    },
    createAttachment: async (input) => {
      calls.createAttachment(input);
      return {
        attachment: {
          id: input.id,
          name: input.name,
          contentType: input.contentType,
          size: input.size,
          state: 'pending',
        },
        uploadUrl: 'http://s3/upload',
      };
    },
    upload: async (url, _file, contentType) => {
      calls.upload(url, contentType);
      if (api.failUpload) throw new Error('Failed to upload attachment');
    },
    commitAttachment: async (input) => {
      calls.commitAttachment(input);
      return { id: input.attachmentId, name: 'a.txt', contentType: 'text/plain', size: 3, state: 'committed' };
    },
    removeAttachment: async (input) => {
      calls.removeAttachment(input);
    },
    signature: async () => null,
  };
  return { api, calls, server };
}

let counter = 0;
const options = { debounceMs: 600, newId: () => `id-${++counter}` };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('opening', () => {
  it('creates a new draft from the seed and becomes ready', async () => {
    const { api, calls } = fakeApi();
    const session = new ComposerSession('d1', api, options);
    await session.start({ to: [{ emailAddress: 'a@x.com' }], isMassSend: true });
    expect(calls.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1', to: [{ emailAddress: 'a@x.com' }], isMassSend: true }),
    );
    expect(session.getSnapshot().status).toBe('ready');
  });

  it('loads an existing draft without a seed and reports a missing one', async () => {
    const { api } = fakeApi(draft({ subject: { text: 'Hi', variables: [] } }));
    const opened = new ComposerSession('d1', api, options);
    await opened.start();
    expect(opened.getSnapshot().draft?.subject.text).toBe('Hi');
    const missing = new ComposerSession(
      'd2',
      { ...api, get: async () => Promise.reject(new Error('Draft not found')) },
      options,
    );
    await missing.start();
    expect(missing.getSnapshot()).toMatchObject({ status: 'error', error: 'Draft not found' });
  });
});

describe('default signature', () => {
  it('is in the body when the window becomes ready and does not make the draft non-empty', async () => {
    const { api, calls } = fakeApi(draft({ signatureId: 'sig1' }));
    api.signature = async () => ({ id: 'sig1', body: [p('Best,'), p('Ada')] });
    const session = new ComposerSession('d1', api, options);
    const statuses: string[] = [];
    session.subscribe(() => statuses.push(session.getSnapshot().status));
    await session.start({});
    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe('ready');
    expect((snapshot.draft?.body as Block[]).map((b) => b.text)).toEqual(['', '', 'Best,', 'Ada']);
    // Never "ready" before the signature went in.
    expect(statuses.slice(0, statuses.lastIndexOf('ready')).every((s) => s === 'loading')).toBe(true);
    expect(session.isEmpty()).toBe(true);
    await session.close();
    expect(calls.remove).toHaveBeenCalledWith('d1');
  });

  it('is only remembered for a reopened draft (its body already has it)', async () => {
    const body = [p('Hi'), p(''), p('Best,')];
    const { api } = fakeApi(draft({ signatureId: 'sig1', body }));
    api.signature = async () => ({ id: 'sig1', body: [p('Best,')] });
    const session = new ComposerSession('d1', api, options);
    await session.start();
    expect(session.getSnapshot().draft?.body).toEqual(body);
    expect(session.getSnapshot().signatureBlocks).toEqual([p('Best,')]);
    expect(session.isEmpty()).toBe(false);
  });
});

describe('autosave', () => {
  it('batches edits within the debounce window and writes only the changed fields', async () => {
    const { api, calls } = fakeApi();
    const session = new ComposerSession('d1', api, options);
    await session.start({});
    session.setSubject({ text: 'Hello', variables: [] });
    session.setBody([p('Body')]);
    expect(session.getSnapshot().saving).toBe(true);
    await vi.advanceTimersByTimeAsync(599);
    expect(calls.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(calls.update).toHaveBeenCalledTimes(1);
    const sent = calls.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['body', 'draftId', 'subject']);
    await session.flush();
    expect(session.getSnapshot().saving).toBe(false);
  });

  it('writes recipients and switches separately and adopts the records the server resolved', async () => {
    const { api, calls } = fakeApi();
    const session = new ComposerSession('d1', api, options);
    await session.start({});
    session.setRecipients('to', [{ emailAddress: 'jane@x.com', name: 'Jane' }]);
    session.setMassSend(true);
    await session.flush();
    expect(calls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: 'd1',
        to: [expect.objectContaining({ emailAddress: 'jane@x.com' })],
        isMassSend: true,
      }),
    );
    expect(session.getSnapshot().draft?.isMassSend).toBe(true);
    expect(session.getSnapshot().draft?.revision).toBe(1);
  });

  it('keeps a local edit made while a save is in flight', async () => {
    const { api, calls } = fakeApi();
    const session = new ComposerSession('d1', api, options);
    await session.start({});
    session.setSubject({ text: 'One', variables: [] });
    const flushing = session.flush();
    session.setSubject({ text: 'Two', variables: [] });
    await flushing;
    await session.flush();
    expect(session.getSnapshot().draft?.subject.text).toBe('Two');
    expect(calls.update).toHaveBeenLastCalledWith(expect.objectContaining({ subject: { text: 'Two', variables: [] } }));
  });

  it('computes hasVariables from subject and body', async () => {
    const { api } = fakeApi();
    const session = new ComposerSession('d1', api, options);
    await session.start({});
    session.setBody([
      {
        ...p('Hi _'),
        variables: [{ start: 3, length: 1, path: [{ attributeDefinitionId: 'name' }], field: null, fallback: null }],
      },
    ]);
    expect(session.getSnapshot().draft?.hasVariables).toBe(true);
    session.setBody([p('Hi')]);
    expect(session.getSnapshot().draft?.hasVariables).toBe(false);
  });

  it('retries a failed save with the next flush and keeps the error visible meanwhile', async () => {
    const { api, calls } = fakeApi();
    const session = new ComposerSession('d1', api, options);
    await session.start({});
    api.failNext = true;
    session.setSubject({ text: 'Hello', variables: [] });
    await session.flush();
    expect(session.getSnapshot().saveError).toBe('boom');
    await session.flush();
    expect(session.getSnapshot().saveError).toBeNull();
    expect(calls.update).toHaveBeenCalledTimes(2);
  });
});

describe('closing', () => {
  it('deletes an empty draft and keeps one with content', async () => {
    const empty = fakeApi();
    const a = new ComposerSession('d1', empty.api, options);
    await a.start({});
    await a.close();
    expect(empty.calls.remove).toHaveBeenCalledWith('d1');
    expect(a.getSnapshot().finished).toBe(true);

    const filled = fakeApi();
    const b = new ComposerSession('d1', filled.api, options);
    await b.start({});
    b.setSubject({ text: 'Keep me', variables: [] });
    await b.close();
    expect(filled.calls.update).toHaveBeenCalled();
    expect(filled.calls.remove).not.toHaveBeenCalled();
  });

  it('a draft that was sent is never deleted', async () => {
    const { api, calls } = fakeApi();
    const session = new ComposerSession('d1', api, options);
    await session.start({});
    session.sent();
    await session.close();
    expect(calls.remove).not.toHaveBeenCalled();
  });
});

describe('attachments', () => {
  const file = new File(['abc'], 'a.txt', { type: 'text/plain' });

  it('creates, uploads and commits, ending as a committed attachment', async () => {
    const { api, calls } = fakeApi();
    const session = new ComposerSession('d1', api, options);
    await session.start({});
    const result = await session.addFiles([file]);
    expect(result.failed).toEqual([]);
    expect(calls.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 'd1', name: 'a.txt', contentType: 'text/plain', size: 3 }),
    );
    expect(calls.upload).toHaveBeenCalledWith('http://s3/upload', 'text/plain');
    const snapshot = session.getSnapshot();
    expect(snapshot.uploads).toEqual([]);
    expect(snapshot.draft?.attachments).toEqual([expect.objectContaining({ state: 'committed' })]);
  });

  it('removes the half-created attachment when the upload fails', async () => {
    const { api, calls } = fakeApi();
    api.failUpload = true;
    const session = new ComposerSession('d1', api, options);
    await session.start({});
    const result = await session.addFiles([file]);
    expect(result.failed).toEqual([{ name: 'a.txt', message: 'Failed to upload attachment' }]);
    expect(calls.removeAttachment).toHaveBeenCalled();
    expect(session.getSnapshot().draft?.attachments).toEqual([]);
  });

  it('refuses files above 25 MB without a request', async () => {
    const { api, calls } = fakeApi();
    const session = new ComposerSession('d1', api, options);
    await session.start({});
    const big = new File(['x'], 'big.bin');
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    const result = await session.addFiles([big]);
    expect(result.failed[0]?.message).toMatch(/too large/);
    expect(calls.createAttachment).not.toHaveBeenCalled();
  });

  it('removes a committed attachment optimistically', async () => {
    const { api, calls } = fakeApi(
      draft({ attachments: [{ id: 'x', name: 'a', contentType: 't', size: 1, state: 'committed' }] }),
    );
    const session = new ComposerSession('d1', api, options);
    await session.start();
    await session.removeAttachment('x');
    expect(session.getSnapshot().draft?.attachments).toEqual([]);
    expect(calls.removeAttachment).toHaveBeenCalledWith({ draftId: 'd1', attachmentId: 'x' });
  });
});
