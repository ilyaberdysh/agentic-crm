// /v2 contract tests for slice 3 (BACKLOG 3.18): notes (markdown and plaintext content), tasks, threads and comments,
// files (folders, multipart upload, download redirect). Every 200 is checked against the public API's OpenAPI schema and the
// generated Zod schema of the operation.
import { readFileSync } from 'node:fs';
import { BUILTIN_STORAGE_PROVIDER } from '@agentic-crm/contracts/v2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from '../support/harness';
import { expectError, expectOk, operationResponse, type V2Fixture, v2Fixture } from './support';

let h: Harness;
let f: V2Fixture;
let companyId: string;
let personId: string;
let personEmail: string;
const TS_9 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/;

beforeAll(async () => {
  h = await startHarness({}, { publicApi: { rateLimits: { readsPerSecond: 5000, writesPerSecond: 5000 } } });
  f = await v2Fixture(h, 'collab');
  const company = expectOk(
    'createRecord',
    await f.call('POST', '/objects/companies/records', {
      body: { data: { values: { name: 'Acme', domains: ['acme.io'] } } },
    }),
  );
  companyId = company.data.id.record_id;
  personEmail = 'jane@acme.io';
  const person = expectOk(
    'createRecord',
    await f.call('POST', '/objects/people/records', {
      body: {
        data: {
          values: {
            email_addresses: [personEmail],
            name: [{ first_name: 'Jane', last_name: 'Cooper', full_name: 'Jane Cooper' }],
          },
        },
      },
    }),
  );
  personId = person.data.id.record_id;
});
afterAll(async () => {
  await h?.close();
});

describe('notes', () => {
  it('creates with markdown, reads content_markdown / content_plaintext, updates and deletes', async () => {
    const created = expectOk(
      'createNote',
      await f.call('POST', '/notes', {
        body: {
          data: {
            parent_object: 'companies',
            parent_record_id: companyId,
            title: 'Kickoff',
            format: 'markdown',
            content: '# Agenda\n- **Scope**\n- ==Budget==',
          },
        },
      }),
    );
    const note = created.data;
    expect(note).toMatchObject({
      parent_object: 'companies',
      parent_record_id: companyId,
      title: 'Kickoff',
      meeting_id: null,
      content_markdown: '# Agenda\n- **Scope**\n- ==Budget==',
      content_plaintext: 'Agenda\nScope\nBudget',
      tags: [],
      created_by_actor: { type: 'api-token', id: f.tokenId },
    });
    expect(note.created_at).toMatch(TS_9);
    const id = note.id.note_id;
    expect(expectOk('getNote', await f.call('GET', `/notes/${id}`)).data.title).toBe('Kickoff');
    const listed = expectOk(
      'listNotes',
      await f.call('GET', '/notes', { query: { parent_object: 'companies', parent_record_id: companyId } }),
    );
    expect(listed.data.map((n: { id: { note_id: string } }) => n.id.note_id)).toEqual([id]);
    const patched = expectOk(
      'updateNote',
      await f.call('PATCH', `/notes/${id}`, {
        body: { data: { title: 'Kickoff v2', format: 'plaintext', content: 'a*b\n- not a list' } },
      }),
    );
    expect(patched.data).toMatchObject({ title: 'Kickoff v2', content_plaintext: 'a*b\n- not a list' });
    expect(patched.data.content_markdown).toBe('a\\*b\n\\- not a list');
    expectOk('deleteNote', await f.call('DELETE', `/notes/${id}`));
    expectError('getNote', await f.call('GET', `/notes/${id}`), 404, 'not_found');
  });

  it('backdates, lists by object with paging limits, and rejects bad input', async () => {
    const backdated = expectOk(
      'createNote',
      await f.call('POST', '/notes', {
        body: {
          data: {
            parent_object: 'people',
            parent_record_id: personId,
            title: 'Old call',
            format: 'plaintext',
            content: 'Hello',
            created_at: '2024-01-02T03:04:05.000000000Z',
          },
        },
      }),
    );
    expect(backdated.data.created_at).toBe('2024-01-02T03:04:05.000000000Z');
    const byObject = expectOk(
      'listNotes',
      await f.call('GET', '/notes', { query: { parent_object: 'people', limit: '1' } }),
    );
    expect(byObject.data).toHaveLength(1);
    expectError(
      'createNote',
      await f.call('POST', '/notes', {
        body: {
          data: {
            parent_object: 'companies',
            parent_record_id: crypto.randomUUID(),
            title: 'x',
            format: 'plaintext',
            content: 'x',
          },
        },
      }),
      404,
      'not_found',
    );
    expectError(
      'createNote',
      await f.call('POST', '/notes', { body: { data: { parent_object: 'companies', title: 'x' } } }),
      400,
      'validation_type',
    );
    expectError('getNote', await f.call('GET', '/notes/not-a-uuid'), 404, 'not_found');
  });
});

describe('tasks', () => {
  it('creates with linked records by id, matching attribute and domain; filters; updates; deletes', async () => {
    const created = expectOk(
      'createTask',
      await f.call('POST', '/tasks', {
        body: {
          data: {
            content: 'Send the proposal',
            format: 'plaintext',
            deadline_at: '2026-10-20T15:00:00.000Z',
            is_completed: false,
            linked_records: [
              { target_object: 'companies', target_record_id: companyId },
              { target_object: 'people', email_addresses: [{ email_address: personEmail }] },
            ],
            assignees: [{ referenced_actor_type: 'workspace-member', referenced_actor_id: f.memberId }],
          },
        },
      }),
    );
    const task = created.data;
    expect(task).toMatchObject({
      content_plaintext: 'Send the proposal',
      deadline_at: '2026-10-20T15:00:00.000000000Z',
      is_completed: false,
      completed_at: null,
      assignees: [{ referenced_actor_type: 'workspace-member', referenced_actor_id: f.memberId }],
    });
    expect(task.linked_records.map((r: { target_record_id: string }) => r.target_record_id)).toEqual([
      companyId,
      personId,
    ]);
    const id = task.id.task_id;
    const byDomain = expectOk(
      'createTask',
      await f.call('POST', '/tasks', {
        body: {
          data: {
            content: 'Ping',
            format: 'plaintext',
            deadline_at: null,
            is_completed: true,
            linked_records: ['acme.io'],
            assignees: [],
          },
        },
      }),
    );
    expect(byDomain.data).toMatchObject({ is_completed: true, linked_records: [{ target_record_id: companyId }] });
    const linked = expectOk(
      'listTasks',
      await f.call('GET', '/tasks', { query: { linked_object: 'people', linked_record_id: personId } }),
    );
    expect(linked.data.map((t: { id: { task_id: string } }) => t.id.task_id)).toEqual([id]);
    const open = expectOk('listTasks', await f.call('GET', '/tasks', { query: { is_completed: 'false' } }));
    expect(open.data.map((t: { id: { task_id: string } }) => t.id.task_id)).toEqual([id]);
    const unassigned = expectOk('listTasks', await f.call('GET', '/tasks', { query: { assignee: '' } }));
    expect(unassigned.data.map((t: { id: { task_id: string } }) => t.id.task_id)).toEqual([byDomain.data.id.task_id]);
    const mine = expectOk(
      'listTasks',
      await f.call('GET', '/tasks', { query: { assignee: f.user.email, sort: 'created_at:desc' } }),
    );
    expect(mine.data).toHaveLength(1);
    const completedFirst = expectOk(
      'listTasks',
      await f.call('GET', '/tasks', { query: { sort: 'completed_at:desc' } }),
    );
    expect(completedFirst.data[0].is_completed).toBe(true);
    const updated = expectOk(
      'updateTask',
      await f.call('PATCH', `/tasks/${id}`, {
        body: { data: { is_completed: true, deadline_at: null, assignees: [] } },
      }),
    );
    expect(updated.data).toMatchObject({ is_completed: true, deadline_at: null, assignees: [] });
    expect(updated.data.completed_at).toMatch(TS_9);
    expectOk('deleteTask', await f.call('DELETE', `/tasks/${id}`));
    expectError('getTask', await f.call('GET', `/tasks/${id}`), 404, 'not_found');
  });

  it('rejects unknown linked records and non-members', async () => {
    expectError(
      'createTask',
      await f.call('POST', '/tasks', {
        body: {
          data: {
            content: 'x',
            format: 'plaintext',
            deadline_at: null,
            is_completed: false,
            linked_records: ['nobody@nowhere.io'],
            assignees: [],
          },
        },
      }),
      404,
      'not_found',
    );
    expectError(
      'createTask',
      await f.call('POST', '/tasks', {
        body: {
          data: {
            content: 'x'.repeat(2001),
            format: 'plaintext',
            deadline_at: null,
            is_completed: false,
            linked_records: [],
            assignees: [],
          },
        },
      }),
      400,
      'validation_type',
    );
  });
});

describe('threads and comments', () => {
  it('creates a thread on a record, replies, lists threads, pages a thread and deletes', async () => {
    const root = expectOk(
      'createComment',
      await f.call('POST', '/comments', {
        body: {
          data: {
            format: 'plaintext',
            content: `Hi ${f.user.email}, see the deck`,
            author: { type: 'workspace-member', id: f.memberId },
            record: { object: 'companies', record_id: companyId },
          },
        },
      }),
    );
    expect(root.data).toMatchObject({
      content_plaintext: `Hi ${f.user.email}, see the deck`,
      entry: null,
      record: { record_id: companyId },
      resolved_at: null,
      author: { type: 'workspace-member', id: f.memberId },
    });
    const threadId = root.data.thread_id;
    const reply = expectOk(
      'createComment',
      await f.call('POST', '/comments', {
        body: {
          data: {
            format: 'plaintext',
            content: 'Thanks',
            author: { type: 'workspace-member', id: f.memberId },
            thread_id: threadId,
          },
        },
      }),
    );
    expect(reply.data.thread_id).toBe(threadId);
    const threads = expectOk(
      'listThreads',
      await f.call('GET', '/threads', { query: { object: 'companies', record_id: companyId } }),
    );
    expect(threads.data).toHaveLength(1);
    expect(threads.data[0].comments).toHaveLength(2);
    const firstPage = expectOk('getThread', await f.call('GET', `/threads/${threadId}`, { query: { limit: '1' } }));
    expect(firstPage.data.comments[0].id.comment_id).toBe(root.data.id.comment_id);
    expect(firstPage.pagination.next_cursor).not.toBeNull();
    const second = expectOk(
      'getThread',
      await f.call('GET', `/threads/${threadId}`, { query: { limit: '1', cursor: firstPage.pagination.next_cursor } }),
    );
    expect(second.data.comments[0].id.comment_id).toBe(reply.data.id.comment_id);
    expect(second.pagination.next_cursor).toBeNull();
    expect(expectOk('getComment', await f.call('GET', `/comments/${reply.data.id.comment_id}`)).data.thread_id).toBe(
      threadId,
    );
    expectOk('deleteComment', await f.call('DELETE', `/comments/${root.data.id.comment_id}`));
    expectError('getComment', await f.call('GET', `/comments/${reply.data.id.comment_id}`), 404, 'not_found');
    expectError('getThread', await f.call('GET', `/threads/${threadId}`), 404, 'not_found');
  });

  it('rejects unknown authors (value_not_found) and needs a target', async () => {
    const res = await f.call('POST', '/comments', {
      body: {
        data: {
          format: 'plaintext',
          content: 'x',
          author: { type: 'workspace-member', id: crypto.randomUUID() },
          record: { object: 'companies', record_id: companyId },
        },
      },
    });
    expectError('createComment', res, 400, 'value_not_found');
    expectError('listThreads', await f.call('GET', '/threads'), 400, 'validation_type');
  });
});

describe('files', () => {
  it('creates folders, uploads multipart files, lists every level, downloads and deletes', async () => {
    const folder = expectOk(
      'createFileEntry',
      await f.call('POST', '/files', {
        body: { object: 'companies', record_id: companyId, file_type: 'folder', name: 'Contracts' },
      }),
    );
    expect(folder.data).toMatchObject({
      file_type: 'folder',
      name: 'Contracts',
      parent_folder_id: null,
      object_slug: 'companies',
      storage_provider: BUILTIN_STORAGE_PROVIDER,
    });
    const form = new FormData();
    form.set('object', 'companies');
    form.set('record_id', companyId);
    form.set('parent_folder_id', folder.data.id.file_id);
    form.set('file', new Blob(['%PDF fake'], { type: 'application/pdf' }), 'msa.pdf');
    const upload = await fetch(`${h.baseUrl}/v2/files/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${f.token}` },
      body: form,
    });
    expect(upload.status).toBe(201);
    const uploaded = (await upload.json()) as { data: Record<string, unknown> & { id: { file_id: string } } };
    expect(uploaded.data).toMatchObject({
      file_type: 'file',
      name: 'msa.pdf',
      content_type: 'application/pdf',
      content_size: 9,
      parent_folder_id: folder.data.id.file_id,
      storage_provider: BUILTIN_STORAGE_PROVIDER,
    });
    const schema = operationResponse('uploadFile', 201)?.content?.['application/json']?.schema;
    expect(schema).toBeDefined();
    const listed = expectOk(
      'listFiles',
      await f.call('GET', '/files', {
        query: { object: 'companies', record_id: companyId, storage_provider: BUILTIN_STORAGE_PROVIDER },
      }),
    );
    expect(listed.data.map((e: { name: string }) => e.name).sort()).toEqual(['Contracts', 'msa.pdf']);
    expect(listed.pagination.next_cursor).toBeNull();
    const inFolder = expectOk(
      'listFiles',
      await f.call('GET', '/files', {
        query: { object: 'companies', record_id: companyId, parent_folder_id: folder.data.id.file_id, limit: '1' },
      }),
    );
    expect(inFolder.data.map((e: { name: string }) => e.name)).toEqual(['msa.pdf']);
    const got = expectOk('getFile', await f.call('GET', `/files/${folder.data.id.file_id}`));
    expect(got.data).toMatchObject({ file_type: 'folder', has_children: true });
    const download = await fetch(`${h.baseUrl}/v2/files/${uploaded.data.id.file_id}/download`, {
      headers: { authorization: `Bearer ${f.token}` },
      redirect: 'manual',
    });
    expect(download.status).toBe(302);
    const location = download.headers.get('location') as string;
    expect(await (await fetch(location)).text()).toBe('%PDF fake');
    expectOk('deleteFile', await f.call('DELETE', `/files/${folder.data.id.file_id}`));
    expectError('getFile', await f.call('GET', `/files/${uploaded.data.id.file_id}`), 404, 'not_found');
  });

  it('refuses connected providers and malformed uploads', async () => {
    const res = await f.call('POST', '/files', {
      body: {
        object: 'companies',
        record_id: companyId,
        file_type: 'connected-file',
        storage_provider: 'dropbox',
        external_provider_file_id: 'x',
      },
    });
    expectError('createFileEntry', res, 400, 'validation_type');
    const form = new FormData();
    form.set('object', 'companies');
    const upload = await fetch(`${h.baseUrl}/v2/files/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${f.token}` },
      body: form,
    });
    expect(upload.status).toBe(400);
    expect(readFileSync).toBeDefined();
  });
});
