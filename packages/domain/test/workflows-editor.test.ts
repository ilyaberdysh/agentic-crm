// Workflow editor (BACKLOG 8.01–8.05, 8.10; acceptance 4): catalogue, transient creation, draft edits, validation with
// per-input issues (required, deleted / inaccessible variables, type mismatches), the variable picker, publish /
// unpublished changes / discard / restore (forks a new draft), enable / disable, settings, permissions, duplicate,
// delete rules, organize.
import { cfg, conditionOperatorsFor, conditionToAst, isAssignable, T } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { evaluateFormula, matchEvents, newId, nextCronRun, parseCron, workflowCatalog } from '../src/index.ts';
import { addMember } from './collab-fixtures.ts';
import { expectCode } from './support/harness.ts';
import { attrOp, buildWorkflow, domain, field, workspaceWith } from './workflows-fixtures.ts';

describe('catalogue', () => {
  it('lists the 16 triggers and the step registry; the first set is available, the rest is not yet', () => {
    const catalog = workflowCatalog();
    expect(catalog.triggers).toHaveLength(16);
    expect(catalog.steps.length).toBeGreaterThanOrEqual(44);
    expect(catalog.categories[0]).toEqual({ slug: 'agents', label: 'Agents' });
    const available = (slugs: string[]) =>
      slugs.map((s) => [...catalog.triggers, ...catalog.steps].find((d) => d.slug === s)?.available);
    expect(
      available([
        'on-record-created',
        'on-record-updated',
        'on-attribute-invalidated',
        'on-list-entry-created',
        'on-list-entry-updated',
        'on-task-created',
        'on-note-created',
        'on-manual-run',
        'on-record-action',
        'on-list-entry-action',
        'on-recurring-schedule',
        'on-inbound-webhook',
      ]).every(Boolean),
    ).toBe(true);
    expect(
      available([
        'create-record',
        'update-record',
        'assert-record',
        'find-records',
        'create-list-entry',
        'update-list-entry',
        'delete-list-entry',
        'find-list-entries',
        'create-task',
        'update-task',
        'complete-task',
        'find-tasks',
        'create-note',
        'delay',
        'delay-until',
        'adjust-timestamp',
        'formula',
        'aggregate-values',
        'generate-random-number',
        'round-robin',
        'for-each',
        'parse-json',
        'send-http-request',
        'send-notification',
        'send-workspace-toast',
        'send-workspace-celebration',
        'guard',
        'branch',
        'switch',
      ]).every(Boolean),
    ).toBe(true);
    // Slice 10: the AI blocks are available; the Web agent still is not.
    const agent = catalog.steps.find((s) => s.slug === 'run-custom-ai-agent');
    expect(agent).toMatchObject({ available: true, cost: { type: 'dynamic' } });
    expect(catalog.steps.find((s) => s.slug === 'research-entity')).toMatchObject({
      available: false,
      cost: { type: 'dynamic' },
      unavailableReason: 'Web agent needs a web-research provider',
    });
    expect(catalog.steps.find((s) => s.slug === 'query-particle-sql')).toMatchObject({
      available: false,
      gate: { kind: 'enterprise', label: 'Enterprise' },
      cost: { type: 'fixed', amount: 10 },
    });
    expect(catalog.steps.find((s) => s.slug === 'create-record')?.cost).toEqual({ type: 'fixed', amount: 1 });
    expect(catalog.steps.find((s) => s.slug === 'formula')).toMatchObject({
      cost: { type: 'free' },
      safeToRetry: true,
    });
  });
});

describe('workflows and drafts', () => {
  it('new workflows are transient until their first edit; title, archive, settings, duplicate, delete', async () => {
    const { ws } = await workspaceWith();
    const id = newId();
    const created = await domain.workflows.create(ws.ctx, { id });
    expect(created).toMatchObject({
      isTransient: true,
      status: 'draft',
      displayTitle: 'Untitled Workflow',
      access: { level: 'full-access' },
      failureNotifications: true,
      hasUnpublishedChanges: false,
    });
    // Replays answer the stored workflow.
    expect((await domain.workflows.create(ws.ctx, { id })).draftVersionId).toBe(created.draftVersionId);
    expect((await domain.workflows.list(ws.ctx)).workflows).toHaveLength(0);
    const renamed = await domain.workflows.update(ws.ctx, { workflowId: id, title: 'Lead triage' });
    expect(renamed).toMatchObject({ isTransient: false, displayTitle: 'Lead triage' });
    expect((await domain.workflows.list(ws.ctx)).workflows.map((w) => w.id)).toEqual([id]);

    // Settings: timezone and failure notifications.
    await expectCode(
      domain.workflows.settings.update(ws.ctx, { workflowId: id, timezone: 'Mars/Base' }),
      'VALIDATION_ERROR',
      400,
    );
    const settings = await domain.workflows.settings.update(ws.ctx, {
      workflowId: id,
      timezone: 'Europe/Moscow',
      failureNotifications: false,
    });
    expect(settings).toMatchObject({ timezone: 'Europe/Moscow', failureNotifications: false });

    // Permissions: workspace Full access + creator Full access (internal-api §6).
    const grants = await domain.permissions.list(ws.ctx, { resourceKind: 'workflow', resourceId: id });
    expect(grants).toMatchObject({ resourceName: 'Lead triage' });
    expect(grants.grants.map((g) => [g.target.type, g.level])).toEqual([
      ['workspace', 'full-access'],
      ['member', 'full-access'],
    ]);

    const copy = await domain.workflows.duplicate(ws.ctx, { workflowId: id });
    expect(copy).toMatchObject({
      displayTitle: 'Copy of Lead triage',
      status: 'draft',
      isTransient: false,
      runCount: 0,
    });

    const archived = await domain.workflows.update(ws.ctx, { workflowId: copy.id, isArchived: true });
    expect(archived.isArchived).toBe(true);
    expect((await domain.workflows.list(ws.ctx)).workflows.map((w) => w.id)).toEqual([id]);
    expect((await domain.workflows.list(ws.ctx, { includeArchived: true })).workflows).toHaveLength(2);

    await domain.workflows.delete(ws.ctx, { workflowId: copy.id });
    await expectCode(domain.workflows.get(ws.ctx, { workflowId: copy.id }), 'NOT_FOUND', 404);
  });

  it('acceptance 4: edits show unpublished changes until published; restoring a version forks a new draft', async () => {
    const { ws } = await workspaceWith();
    const t = newId();
    const step = newId();
    const { workflowId } = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-manual-run' },
        { id: step, slug: 'formula', config: { formula: cfg.text('1 + 1') } },
      ],
      [[0, 'done', 1]],
    );
    let wf = (await domain.workflows.get(ws.ctx, { workflowId })).workflow;
    expect(wf).toMatchObject({ status: 'draft', hasUnpublishedChanges: true, latestPublishedVersionId: null });

    const first = await domain.workflows.publish(ws.ctx, { workflowId });
    const v1 = first.version.id;
    expect(first.workflow).toMatchObject({ status: 'live', activeVersionId: v1, hasUnpublishedChanges: false });
    expect(first.version).toMatchObject({ type: 'immutable', status: 'live' });
    expect(first.workflow.firstSetLiveAt).not.toBeNull();

    // An edit of the live workflow's draft: "This workflow has unpublished changes".
    await domain.workflows.blocks.put(ws.ctx, {
      workflowId,
      blockId: step,
      slug: 'formula',
      config: cfg.object({ formula: cfg.text('2 + 2') }),
    });
    wf = (await domain.workflows.get(ws.ctx, { workflowId })).workflow;
    expect(wf).toMatchObject({ status: 'live', activeVersionId: v1, hasUnpublishedChanges: true });
    // The live version is untouched.
    const live = await domain.workflows.get(ws.ctx, { workflowId, versionId: v1 });
    expect(live.version.blocks.find((b) => b.id === step)?.config).toEqual(cfg.object({ formula: cfg.text('1 + 1') }));

    const second = await domain.workflows.publish(ws.ctx, { workflowId });
    const v2 = second.version.id;
    expect(second.workflow).toMatchObject({ activeVersionId: v2, hasUnpublishedChanges: false });
    let versions = (await domain.workflows.versions(ws.ctx, { workflowId })).versions;
    expect(versions.map((v) => [v.type, v.status])).toEqual([
      ['draft', 'draft'],
      ['immutable', 'live'],
      ['immutable', 'superseded'],
    ]);

    // Restore v1: a new draft copied from v1, labelled "restored from"; the live version stays v2.
    const draftBefore = second.workflow.draftVersionId;
    const restored = await domain.workflows.restoreVersion(ws.ctx, { workflowId, versionId: v1 });
    expect(restored.workflow.draftVersionId).not.toBe(draftBefore);
    expect(restored.workflow).toMatchObject({ activeVersionId: v2, hasUnpublishedChanges: true });
    expect(restored.version).toMatchObject({
      type: 'draft',
      restoredFrom: { versionId: v1, publishedAt: first.version.publishedAt },
    });
    expect(restored.version.blocks.find((b) => b.id === step)?.config).toEqual(
      cfg.object({ formula: cfg.text('1 + 1') }),
    );
    versions = (await domain.workflows.versions(ws.ctx, { workflowId })).versions;
    expect(versions).toHaveLength(3);
    expect(versions[0]).toMatchObject({ id: restored.workflow.draftVersionId, restoredFrom: { versionId: v1 } });

    // Discard changes: the draft is the latest published version again.
    const discarded = await domain.workflows.discardDraft(ws.ctx, { workflowId });
    expect(discarded.workflow.hasUnpublishedChanges).toBe(false);
    expect(discarded.version.blocks.find((b) => b.id === step)?.config).toEqual(
      cfg.object({ formula: cfg.text('2 + 2') }),
    );

    // Live switch: off pauses (version history marks it Paused), on re-activates the latest published version.
    const paused = await domain.workflows.disable(ws.ctx, { workflowId });
    expect(paused).toMatchObject({ status: 'paused', activeVersionId: null });
    expect((await domain.workflows.versions(ws.ctx, { workflowId })).versions[1]).toMatchObject({
      id: v2,
      status: 'paused',
    });
    await expectCode(domain.workflows.delete(ws.ctx, { workflowId: newId() }), 'NOT_FOUND', 404);
    const enabled = await domain.workflows.enable(ws.ctx, { workflowId });
    expect(enabled).toMatchObject({ status: 'live', activeVersionId: v2 });
    await expectCode(domain.workflows.delete(ws.ctx, { workflowId }), 'WORKFLOW_STATE_CONFLICT', 409);
  });

  it('replacing a block keeps its id and drops paths from outcomes it no longer has; organize answers Undo positions', async () => {
    const { ws } = await workspaceWith();
    const t = newId();
    const branch = newId();
    const { workflowId, ids } = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-manual-run' },
        { id: branch, slug: 'branch' },
        { slug: 'formula', config: { formula: cfg.text('1') } },
      ],
      [
        [0, 'done', 1],
        [1, 'false', 2],
      ],
    );
    await expectCode(
      domain.workflows.blocks.connect(ws.ctx, {
        workflowId,
        sourceBlockId: branch,
        outcome: 'maybe',
        targetBlockId: ids[2] as string,
      }),
      'VALIDATION_ERROR',
      400,
    );
    await expectCode(
      domain.workflows.blocks.put(ws.ctx, { workflowId, blockId: newId(), slug: 'research-entity' }),
      'VALIDATION_ERROR',
      400,
    );
    const replaced = await domain.workflows.blocks.put(ws.ctx, { workflowId, blockId: branch, slug: 'guard' });
    expect(replaced.block).toMatchObject({ id: branch, slug: 'guard', title: 'Filter' });
    const version = (await domain.workflows.get(ws.ctx, { workflowId })).version;
    expect(version.paths.map((p) => p.outcome)).toEqual(['done']);

    // Already organized (the builder lays blocks out in columns): nothing changes.
    expect((await domain.workflows.blocks.organize(ws.ctx, { workflowId })).changed).toBe(false);
    await domain.workflows.blocks.put(ws.ctx, {
      workflowId,
      blockId: branch,
      slug: 'guard',
      position: { x: 33, y: 444 },
    });
    const organized = await domain.workflows.blocks.organize(ws.ctx, { workflowId });
    expect(organized.changed).toBe(true);
    expect(organized.previous.find((p) => p.blockId === branch)?.position).toEqual({ x: 33, y: 444 });
    expect(organized.positions.find((p) => p.blockId === t)?.position).toEqual({ x: 0, y: 0 });
    expect(organized.positions.find((p) => p.blockId === branch)?.position).toEqual({ x: 270, y: 0 });
    const undo = await domain.workflows.blocks.organize(ws.ctx, { workflowId, positions: organized.previous });
    expect(undo.changed).toBe(true);

    await domain.workflows.blocks.delete(ws.ctx, { workflowId, blockId: branch });
    const after = (await domain.workflows.get(ws.ctx, { workflowId })).version;
    expect(after.blocks.map((b) => b.id).sort()).toEqual([t, ids[2]].sort());
    expect(after.paths).toEqual([]);
  });
});

describe('validation and variables', () => {
  it('reports required inputs, type mismatches, deleted and inaccessible variables with their input paths', async () => {
    const { ws, opp } = await workspaceWith();
    const t = newId();
    const formula = newId();
    const stray = newId();
    const task = newId();
    const { workflowId } = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-record-created', config: { object: cfg.object_(opp.objectId) } },
        { id: formula, slug: 'formula', config: { formula: cfg.text('1') } },
        {
          id: task,
          slug: 'create-task',
          config: {
            // A record into a timestamp input: incompatible.
            due_at: cfg.variable(t, 'done', [field('entity_instance')]),
            // A block that is not upstream of this one.
            references: { type: 'array', items: [cfg.variable(stray, 'done', [field('result')])] },
          },
        },
        { id: stray, slug: 'formula', config: { formula: cfg.text('2') } },
        {
          slug: 'update-record',
          config: {
            object: cfg.object_(opp.objectId),
            record: cfg.variable(t, 'done', [field('entity_instance')]),
            configured_attributes: cfg.object({
              // Number attribute ← number result: fine; select ← an unknown option title is a run-time check.
              [opp.amount]: cfg.object({ value: cfg.variable(formula, 'done', [field('result')]) }),
              // Text attribute ← a deleted attribute of the record.
              [opp.note]: cfg.object({
                value: cfg.variable(t, 'done', [field('entity_instance'), attrOp(opp.objectId, newId())]),
              }),
              // Static value of the wrong type.
              [opp.score]: cfg.object({ value: cfg.value('not a number') }),
            }),
          },
        },
      ],
      [
        [0, 'done', 1],
        [1, 'done', 2],
        [2, 'done', 4],
      ],
    );
    const { version } = await domain.workflows.get(ws.ctx, { workflowId });
    const issuesOf = (id: string) => version.blocks.find((b) => b.id === id)?.issues ?? [];
    expect(issuesOf(task)).toEqual(
      expect.arrayContaining([
        { path: ['content'], code: 'required', message: 'This input is required.' },
        { path: ['due_at'], code: 'type-mismatch', message: 'This variable is not compatible with this input' },
        {
          path: ['references'],
          code: 'inaccessible-variable',
          message: 'This variable is not accessible from this block',
        },
      ]),
    );
    expect(issuesOf(stray)).toEqual([
      { path: [], code: 'not-connected', message: 'This step is not connected to a trigger' },
    ]);
    const update = version.blocks.find((b) => b.slug === 'update-record');
    expect(update?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['configured_attributes', opp.note], code: 'deleted-variable' }),
        expect.objectContaining({ path: ['configured_attributes', opp.score], code: 'invalid' }),
      ]),
    );
    expect(update?.issues.some((i) => i.path[1] === opp.amount)).toBe(false);
    expect(version.checklist.errorCount).toBeGreaterThanOrEqual(6);
    const err = await expectCode(domain.workflows.publish(ws.ctx, { workflowId }), 'WORKFLOW_INVALID', 400);
    expect((err as unknown as Error).message).toBe(
      `Please fix the ${version.checklist.errorCount} errors in the workflow and try again.`,
    );

    // A workflow needs a step; a trigger without a next step is flagged.
    const lonely = await buildWorkflow(ws, [{ slug: 'on-manual-run' }], []);
    const lonelyVersion = (await domain.workflows.get(ws.ctx, { workflowId: lonely.workflowId })).version;
    expect(lonelyVersion.blocks[0]?.issues).toEqual([
      { path: [], code: 'no-next-step', message: 'This trigger is not connected to any steps' },
    ]);
    expect(lonelyVersion.checklist.messages).toContain('Workflow must have at least one step');
  });

  it('the variable picker lists upstream blocks nearest first with typed outputs and attribute lists', async () => {
    const { ws, opp } = await workspaceWith();
    const t = newId();
    const branch = newId();
    const find = newId();
    const last = newId();
    const { workflowId } = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-record-action', config: { object: cfg.object_(opp.objectId) } },
        {
          id: branch,
          slug: 'branch',
          config: {
            predicate: cfg.condition(
              cfg.variable(t, 'done', [field('entity_instance'), attrOp(opp.objectId, opp.amount)]),
              'is-not-empty',
            ),
          },
        },
        { id: find, slug: 'find-records', config: { entity: cfg.object_(opp.objectId), limit: cfg.number(5) } },
        { id: last, slug: 'formula', config: { formula: cfg.text('1') } },
      ],
      [
        [0, 'done', 1],
        [1, 'true', 2],
        [2, 'done', 3],
      ],
    );
    const picker = await domain.workflows.variables(ws.ctx, { workflowId, blockId: last });
    expect(picker.blocks.map((b) => [b.title, b.distance])).toEqual([
      ['Find records', 1],
      ['If', 2],
      ['Record action', 3],
    ]);
    expect(picker.blocks[1]?.outcomes).toEqual([{ slug: 'true', label: 'True', outputs: null }]);
    expect(picker.blocks[0]?.outcomes[0]?.outputs).toEqual([
      { key: 'match_count', label: 'Match count', type: T.number },
      { key: 'records', label: 'Records', type: T.array(T.record(opp.objectId)) },
    ]);
    expect(picker.blocks[2]?.outcomes[0]?.outputs?.map((o) => o.label)).toEqual([
      'Record',
      'Triggered by',
      'Triggered at',
    ]);
    const object = picker.definitions.find((d) => d.id === opp.objectId);
    expect(object?.attributes.find((a) => a.id === opp.amount)).toMatchObject({ title: 'Amount', type: T.number });
    expect(object?.attributes.find((a) => a.id === opp.stage)?.type).toEqual({ kind: 'select' });
  });
});

describe('permissions', () => {
  it('members see workflows by grant; read only cannot edit; admins list every workflow', async () => {
    const { ws } = await workspaceWith();
    const bob = await addMember(ws, 'Bob');
    const { workflowId } = await buildWorkflow(ws, [{ slug: 'on-manual-run' }], []);
    expect((await domain.workflows.list(bob.ctx)).workflows.map((w) => w.id)).toEqual([workflowId]);
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'workflow',
      resourceId: workflowId,
      target: { type: 'workspace' },
      level: 'no-access',
    });
    expect((await domain.workflows.list(bob.ctx)).workflows).toHaveLength(0);
    await expectCode(domain.workflows.get(bob.ctx, { workflowId }), 'NOT_FOUND', 404);
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'workflow',
      resourceId: workflowId,
      target: { type: 'member', id: bob.memberId },
      level: 'read-only',
    });
    const seen = await domain.workflows.get(bob.ctx, { workflowId });
    expect(seen.workflow.access).toMatchObject({
      level: 'read-only',
      flags: { read_workflow: true, update_workflow: false },
    });
    await expectCode(domain.workflows.update(bob.ctx, { workflowId, title: 'Mine' }), 'FORBIDDEN', 403);
    await expectCode(domain.workflows.list(bob.ctx, { admin: true }), 'VALIDATION_ERROR', 400);
    expect((await domain.workflows.list(ws.ctx, { admin: true })).workflows.map((w) => w.id)).toEqual([workflowId]);
    const resolved = await domain.permissions.resolve(bob.ctx, { resourceKind: 'workflow', resourceIds: [workflowId] });
    expect(resolved.resolved[workflowId]).toMatchObject({ state: 'complete', value: { level: 'read-only' } });
  });
});

describe('pure helpers', () => {
  it('cron expressions: fields, steps, names, weekday / day-of-month OR, time zones', () => {
    expect([...parseCron('*/15 9-17 * * mon-fri').minutes]).toEqual([0, 15, 30, 45]);
    expect([...parseCron('0 0 * * 7').weekdays]).toEqual([0]);
    expect(() => parseCron('61 * * * *')).toThrow();
    expect(() => parseCron('* * *')).toThrow();
    // 2026-10-14 is a Wednesday.
    expect(nextCronRun('0 10 * * *', 'UTC', '2026-10-14T09:00:00Z')).toBe('2026-10-14T10:00:00.000Z');
    expect(nextCronRun('0 10 * * *', 'UTC', '2026-10-14T10:00:00Z')).toBe('2026-10-15T10:00:00.000Z');
    expect(nextCronRun('30 9 * * 1', 'UTC', '2026-10-14T00:00:00Z')).toBe('2026-10-19T09:30:00.000Z');
    expect(nextCronRun('0 9 * * *', 'Europe/Moscow', '2026-10-14T00:00:00Z')).toBe('2026-10-14T06:00:00.000Z');
    expect(nextCronRun('0 12 31 * *', 'UTC', '2026-10-31T13:00:00Z')).toBe('2026-12-31T12:00:00.000Z');
    // Berlin leaves summer time on 2026-10-25: 09:30 local is 07:30Z before and 08:30Z after.
    expect(nextCronRun('30 9 * * *', 'Europe/Berlin', '2026-10-24T08:00:00Z')).toBe('2026-10-25T08:30:00.000Z');
  });

  it('formula arithmetic', () => {
    expect(evaluateFormula('(12) * 2 + 1')).toBe(25);
    expect(evaluateFormula('-(3) - 4 / 2')).toBe(-5);
    expect(evaluateFormula('0.1 + 0.2')).toBe(0.3);
    expect(() => evaluateFormula('2 +')).toThrow('Invalid formula');
    expect(() => evaluateFormula('1 / 0')).toThrow('division by zero');
  });

  it('conditions map onto the shared predicate AST; operators per type; assignability', () => {
    const left = cfg.variable(newId(), 'done', [field('result')]);
    expect(conditionToAst(cfg.condition(left, 'does-not-contain', cfg.string('x')))).toEqual({
      subject: left,
      mode: 'must-not',
      constraints: [{ field: 'value', operator: 'contains', value: cfg.string('x') }],
    });
    expect(
      conditionToAst({ type: 'predicate-group', logic: 'or', predicates: [cfg.condition(left, 'is-empty')] }),
    ).toEqual({
      or: [{ subject: left, mode: 'must', constraints: [{ field: 'value', operator: 'empty', value: null }] }],
    });
    expect(conditionOperatorsFor(T.number)).toContain('greater-than');
    expect(conditionOperatorsFor(T.timestamp)).toContain('is-before');
    expect(isAssignable(T.number, T.string)).toBe('coerce');
    expect(isAssignable(T.record('a'), T.number)).toBe('incompatible');
    expect(isAssignable(T.record('a'), T.record('b'))).toBe('incompatible');
    expect(isAssignable(T.record(null), T.record('b'))).toBe('coerce');
    expect(isAssignable(T.actor, T.array(T.actor))).toBe('coerce');
    expect(isAssignable(T.array(T.number), T.number)).toBe('incompatible');
  });

  it('trigger matching: one run per record, attribute filters, no self-retrigger', () => {
    const wf = newId();
    const obj = newId();
    const attr = newId();
    const trig = (slug: string, attribute: string | null = null) => ({
      workflow_id: wf,
      version_id: newId(),
      block_id: newId(),
      slug,
      entity_definition_id: obj,
      attribute_id: attribute,
    });
    const created = { event_type: 'record.created', id: { object_id: obj, record_id: 'r1' } };
    const upd = (record: string, attribute: string) => ({
      event_type: 'record.updated',
      id: { object_id: obj, record_id: record, attribute_id: attribute },
    });
    const at = '2026-10-14T00:00:00Z';
    const member = { type: 'workspace-member' as const, id: newId() };
    // Created in the same transaction: no "updated" run; attribute changed fires for values written at creation.
    expect(matchEvents([created, upd('r1', attr)], [trig('on-record-updated')], member, at, null)).toHaveLength(0);
    expect(
      matchEvents([created, upd('r1', attr)], [trig('on-attribute-invalidated', attr)], member, at, null),
    ).toHaveLength(1);
    // Several attributes of one record in one transaction: one run.
    expect(
      matchEvents([upd('r2', attr), upd('r2', newId())], [trig('on-record-updated')], member, at, null),
    ).toHaveLength(1);
    expect(matchEvents([upd('r2', newId())], [trig('on-record-updated', attr)], member, at, null)).toHaveLength(0);
    // The workflow's own writes.
    expect(
      matchEvents([upd('r3', attr)], [trig('on-record-updated')], { type: 'workflow', id: wf }, at, { workflowId: wf }),
    ).toHaveLength(0);
    expect(
      matchEvents([upd('r3', attr)], [trig('on-record-updated')], { type: 'workflow', id: newId() }, at, {
        workflowId: newId(),
      }),
    ).toHaveLength(1);
  });
});
