// Insight templates (BACKLOG 10.13; I calls §4, §5.1, §10, §11.5; B.20 draft → publish, B.21 transient): a template
// is a named list of sections (rich-text title + prompt documents, format list | text, fractional order), versioned
// as snapshots. The editor always edits the draft; publishing makes it the active version (and forks a new draft
// from it); discarding replaces the draft by a fresh copy of the active version. Call insights are generated from a
// specific active snapshot and never change with later publishes. A new template is transient (hidden from the list)
// until its first content edit or a preset is applied.
import {
  type ApplyInsightPresetInput,
  applyInsightPresetInputSchema,
  type CreateInsightSectionInput,
  type CreateInsightTemplateInput,
  createInsightSectionInputSchema,
  createInsightTemplateInputSchema,
  duplicateInsightSectionInputSchema,
  duplicateInsightTemplateInputSchema,
  type InsightTemplate,
  type InsightTemplateDetail,
  type InsightTemplatePreview,
  type InsightTemplateSection,
  type InsightTemplateSnapshot,
  type ListInsightTemplatesInput,
  listInsightTemplatesInputSchema,
  moveInsightSectionInputSchema,
  rankAfter,
  rankBetween,
  type UpdateInsightSectionInput,
  type UpdateInsightTemplateInput,
  updateInsightSectionInputSchema,
  updateInsightTemplateInputSchema,
} from '@agentic-crm/contracts';
import type { InsightTemplateSnapshotsTable, InsightTemplatesTable } from '@agentic-crm/db';
import { type Selectable, sql } from '@agentic-crm/db';
import { type Block, blocksToPlaintext, textBlock } from '@agentic-crm/editor/model';
import type { z } from 'zod';
import { toActor, toActorOrNull } from '../collab/common.ts';
import { storedBlocks, writeDocumentBlocks } from '../documents/content.ts';
import { documentOps } from '../documents/service.ts';
import { badRequest, conflict, DomainError, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Tx } from '../tx.ts';
import { insightPreset } from './presets.ts';
import { touchDraft } from './touch.ts';

type TemplateRow = Selectable<InsightTemplatesTable>;
type SnapshotRow = Selectable<InsightTemplateSnapshotsTable>;

export const templateNotFound = (templateId: string) =>
  notFound('Insight template not found', { conversation_insight_template_id: templateId });

/** Plain text → document blocks (one paragraph per line; empty text → empty document). */
export function textToBlocks(text: string): Block[] {
  const trimmed = text.replace(/\s+$/, '');
  if (trimmed.trim() === '') return [];
  return trimmed.split('\n').map((line) => textBlock('unstyled', line));
}

const displayTitle = (t: { title: string | null; ai_title: string | null }) =>
  t.title ?? t.ai_title ?? 'Untitled Template';

// ---------------------------------------------------------------------------------------------------------------
// Reads

async function loadTemplate(tx: Tx, templateId: string, options: { lock?: boolean } = {}): Promise<TemplateRow> {
  let query = tx.db
    .selectFrom('insight_templates')
    .selectAll()
    .where('id', '=', templateId)
    .where('deleted_at', 'is', null);
  if (options.lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (!row) throw templateNotFound(templateId);
  return row as TemplateRow;
}

async function liveSnapshots(tx: Tx, templateIds: string[]): Promise<SnapshotRow[]> {
  if (templateIds.length === 0) return [];
  return (await tx.db
    .selectFrom('insight_template_snapshots')
    .selectAll()
    .where('template_id', 'in', templateIds)
    .where('status', 'in', ['draft', 'active'])
    .execute()) as SnapshotRow[];
}

async function draftOf(tx: Tx, templateId: string): Promise<SnapshotRow> {
  const row = await tx.db
    .selectFrom('insight_template_snapshots')
    .selectAll()
    .where('template_id', '=', templateId)
    .where('status', '=', 'draft')
    .forUpdate()
    .executeTakeFirst();
  if (!row) {
    throw new DomainError(409, 'SNAPSHOT_NOT_DRAFT', 'This template has no draft version', {
      conversation_insight_template_id: templateId,
    });
  }
  return row as SnapshotRow;
}

/** Plaintext of documents by id. */
async function documentTexts(tx: Tx, ids: string[]): Promise<Map<string, { text: string; blocks: Block[] }>> {
  const out = new Map<string, { text: string; blocks: Block[] }>();
  if (ids.length === 0) return out;
  const rows = await tx.db
    .selectFrom('documents')
    .select(['id', 'blocks', 'markdown'])
    .where('id', 'in', ids)
    .where('deleted_at', 'is', null)
    .execute();
  for (const r of rows) {
    const blocks = storedBlocks(r);
    out.set(r.id, { text: blocksToPlaintext(blocks).trim(), blocks });
  }
  return out;
}

/** Sections of snapshots in order, with the plaintext of their title and prompt documents. */
export async function snapshotSections(tx: Tx, snapshotIds: string[]): Promise<Map<string, InsightTemplateSection[]>> {
  const out = new Map<string, InsightTemplateSection[]>(snapshotIds.map((id) => [id, []]));
  if (snapshotIds.length === 0) return out;
  const rows = await tx.db
    .selectFrom('insight_template_sections')
    .selectAll()
    .where('snapshot_id', 'in', snapshotIds)
    .where('deleted_at', 'is', null)
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
  const texts = await documentTexts(
    tx,
    rows.flatMap((r) => [r.title_document_id, r.prompt_document_id]),
  );
  for (const r of rows) {
    out.get(r.snapshot_id)?.push({
      id: r.id,
      snapshotId: r.snapshot_id,
      type: r.type,
      sortOrder: r.sort_order,
      titleDocumentId: r.title_document_id,
      promptDocumentId: r.prompt_document_id,
      title: texts.get(r.title_document_id)?.text ?? '',
      prompt: texts.get(r.prompt_document_id)?.text ?? '',
    });
  }
  return out;
}

function snapshotView(row: SnapshotRow, sections: InsightTemplateSection[]): InsightTemplateSnapshot {
  return {
    id: row.id,
    templateId: row.template_id,
    parentSnapshotId: row.parent_snapshot_id,
    status: row.status,
    firstTouchedAt: row.first_touched_at,
    lastTouchedAt: row.last_touched_at,
    publishedAt: row.published_at,
    publishedBy: toActorOrNull(row.published_by),
    createdAt: row.created_at,
    sections,
  };
}

export async function templateViews(tx: Tx, rows: TemplateRow[]): Promise<InsightTemplate[]> {
  const ids = rows.map((r) => r.id);
  const snapshots = await liveSnapshots(tx, ids);
  const counts = new Map<string, number>();
  if (snapshots.length > 0) {
    const { rows: c } = await sql<{ snapshot_id: string; n: string }>`
      SELECT snapshot_id, count(*)::text AS n FROM insight_template_sections
      WHERE snapshot_id = ANY(${snapshots.map((s) => s.id)}::uuid[]) AND deleted_at IS NULL
      GROUP BY snapshot_id`.execute(tx.db);
    for (const r of c) counts.set(r.snapshot_id, Number(r.n));
  }
  const used = new Map<string, number>();
  if (ids.length > 0) {
    const { rows: u } = await sql<{ template_id: string; n: string }>`
      SELECT template_id, count(*)::text AS n FROM call_insights WHERE template_id = ANY(${ids}::uuid[])
      GROUP BY template_id`.execute(tx.db);
    for (const r of u) used.set(r.template_id, Number(r.n));
  }
  return rows.map((t) => {
    const draft = snapshots.find((s) => s.template_id === t.id && s.status === 'draft') ?? null;
    const active = snapshots.find((s) => s.template_id === t.id && s.status === 'active') ?? null;
    const totalInsights = used.get(t.id) ?? 0;
    const isFirstVersion = !active && (draft?.parent_snapshot_id ?? null) === null;
    return {
      id: t.id,
      title: t.title,
      aiTitle: t.ai_title,
      status: t.status,
      isTransient: t.is_transient,
      isArchived: t.archived_at !== null,
      sortOrder: t.sort_order,
      firstEnabledAt: t.first_enabled_at,
      sectionCount: counts.get((active ?? draft)?.id ?? '') ?? 0,
      lastPublishedAt: active?.published_at ?? null,
      activeSnapshotId: active?.id ?? null,
      draftSnapshotId: draft?.id ?? null,
      isFirstVersion,
      canPublish: draft !== null && (isFirstVersion || draft.first_touched_at !== null),
      hasUnpublishedChanges: draft !== null && draft.parent_snapshot_id !== null && draft.first_touched_at !== null,
      totalInsights,
      canDelete: totalInsights === 0,
      createdBy: toActor(t.created_by),
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    };
  });
}

export async function previewViews(
  tx: Tx,
  rows: {
    id: string;
    template_id: string;
    snapshot_id: string;
    recording_id: string;
    status: InsightTemplatePreview['status'];
    sections: unknown;
    error: string | null;
    credit_cost: number;
    draft_touched_at: string | null;
    created_at: string;
    completed_at: string | null;
  }[],
): Promise<InsightTemplatePreview[]> {
  if (rows.length === 0) return [];
  const recordings = await tx.db
    .selectFrom('call_recordings')
    .select(['id', 'meeting_id'])
    .where(
      'id',
      'in',
      rows.map((r) => r.recording_id),
    )
    .execute();
  const meetingOf = new Map(recordings.map((r) => [r.id, r.meeting_id]));
  const drafts = await tx.db
    .selectFrom('insight_template_snapshots')
    .select(['template_id', 'last_touched_at'])
    .where(
      'template_id',
      'in',
      rows.map((r) => r.template_id),
    )
    .where('status', '=', 'draft')
    .execute();
  const touched = new Map(drafts.map((d) => [d.template_id, d.last_touched_at]));
  return rows.map((r) => {
    const last = touched.get(r.template_id) ?? null;
    return {
      id: r.id,
      templateId: r.template_id,
      snapshotId: r.snapshot_id,
      recordingId: r.recording_id,
      meetingId: meetingOf.get(r.recording_id) ?? r.recording_id,
      status: r.status,
      sections: (r.sections ?? []) as InsightTemplatePreview['sections'],
      error: r.error,
      creditCost: r.credit_cost,
      isStale: last !== null && (r.draft_touched_at === null || last > r.draft_touched_at),
      createdAt: r.created_at,
      completedAt: r.completed_at,
    };
  });
}

async function detail(tx: Tx, row: TemplateRow): Promise<InsightTemplateDetail> {
  const [view] = await templateViews(tx, [row]);
  const snapshots = await liveSnapshots(tx, [row.id]);
  const sections = await snapshotSections(
    tx,
    snapshots.map((s) => s.id),
  );
  const draft = snapshots.find((s) => s.status === 'draft');
  const active = snapshots.find((s) => s.status === 'active');
  const previews = await tx.db
    .selectFrom('insight_template_previews')
    .selectAll()
    .where('template_id', '=', row.id)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(20)
    .execute();
  return {
    ...(view as InsightTemplate),
    draft: draft ? snapshotView(draft, sections.get(draft.id) ?? []) : null,
    active: active ? snapshotView(active, sections.get(active.id) ?? []) : null,
    previews: await previewViews(tx, previews),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Writes

function emitTemplate(tx: Tx, templateId: string, list = true): void {
  tx.emit('insight-template', templateId, { templateId });
  if (list) tx.emit('insight-template-list', null, { templateIds: [templateId] });
}

async function createSectionRow(
  tx: Tx,
  snapshotId: string,
  section: { id: string; type: 'plaintext' | 'list'; sortOrder: string; title: Block[]; prompt: Block[] },
): Promise<void> {
  const titleDocumentId = newId();
  const promptDocumentId = newId();
  await tx.db
    .insertInto('insight_template_sections')
    .values({
      id: section.id,
      workspace_id: tx.workspaceId,
      snapshot_id: snapshotId,
      title_document_id: titleDocumentId,
      prompt_document_id: promptDocumentId,
      type: section.type,
      sort_order: section.sortOrder,
      created_by: JSON.stringify(tx.ctx.actor),
    })
    .execute();
  await documentOps.create(tx, {
    id: titleDocumentId,
    docType: 'insight-section',
    parentId: section.id,
    content: { blocks: section.title },
  });
  await documentOps.create(tx, {
    id: promptDocumentId,
    docType: 'insight-section',
    parentId: section.id,
    content: { blocks: section.prompt },
  });
}

/** Copies the sections (and their documents) of one snapshot into another. */
async function copySections(tx: Tx, fromSnapshotId: string, toSnapshotId: string): Promise<void> {
  const rows = await tx.db
    .selectFrom('insight_template_sections')
    .selectAll()
    .where('snapshot_id', '=', fromSnapshotId)
    .where('deleted_at', 'is', null)
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
  const texts = await documentTexts(
    tx,
    rows.flatMap((r) => [r.title_document_id, r.prompt_document_id]),
  );
  for (const r of rows) {
    await createSectionRow(tx, toSnapshotId, {
      id: newId(),
      type: r.type,
      sortOrder: r.sort_order,
      title: texts.get(r.title_document_id)?.blocks ?? [],
      prompt: texts.get(r.prompt_document_id)?.blocks ?? [],
    });
  }
}

async function newDraft(tx: Tx, templateId: string, parent: string | null): Promise<string> {
  const id = newId();
  await tx.db
    .insertInto('insight_template_snapshots')
    .values({
      id,
      workspace_id: tx.workspaceId,
      template_id: templateId,
      parent_snapshot_id: parent,
      status: 'draft',
      created_by: JSON.stringify(tx.ctx.actor),
    })
    .execute();
  if (parent) await copySections(tx, parent, id);
  return id;
}

async function deleteSectionsOf(tx: Tx, snapshotId: string): Promise<void> {
  const rows = await tx.db
    .updateTable('insight_template_sections')
    .set({ deleted_at: tx.now })
    .where('snapshot_id', '=', snapshotId)
    .where('deleted_at', 'is', null)
    .returning(['title_document_id', 'prompt_document_id'])
    .execute();
  const docs = rows.flatMap((r) => [r.title_document_id, r.prompt_document_id]);
  if (docs.length > 0) {
    await tx.db.updateTable('documents').set({ deleted_at: tx.now }).where('id', 'in', docs).execute();
  }
}

async function lastSortOrder(tx: Tx): Promise<string | null> {
  const row = await tx.db
    .selectFrom('insight_templates')
    .select('sort_order')
    .where('deleted_at', 'is', null)
    .orderBy('sort_order', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.sort_order ?? null;
}

/** Empty section titles / prompts (and templates without sections) block publish and preview. */
export async function assertComplete(tx: Tx, snapshotId: string, action: 'publish' | 'preview'): Promise<void> {
  const sections = (await snapshotSections(tx, [snapshotId])).get(snapshotId) ?? [];
  const issues = sections
    .map((s, i) => ({
      sectionId: s.id,
      section: i + 1,
      missing: [...(s.title ? [] : ['title']), ...(s.prompt ? [] : ['prompt'])],
    }))
    .filter((i) => i.missing.length > 0);
  if (sections.length === 0 || issues.length > 0) {
    throw badRequest(
      'TEMPLATE_INCOMPLETE',
      action === 'publish'
        ? 'You cannot publish a template with missing content.'
        : 'You cannot generate a preview with missing content.',
      { issues, ...(sections.length === 0 ? { missing_sections: true } : {}) },
    );
  }
}

async function replaceWithPreset(tx: Tx, template: TemplateRow, draftId: string, presetId: string): Promise<void> {
  const preset = insightPreset(presetId);
  if (!preset) throw notFound('Template preset not found', { conversation_insight_template_preset_id: presetId });
  await deleteSectionsOf(tx, draftId);
  let order: string | null = null;
  for (const s of preset.sections) {
    order = rankAfter(order);
    await createSectionRow(tx, draftId, {
      id: newId(),
      type: s.type,
      sortOrder: order,
      title: textToBlocks(s.title),
      prompt: textToBlocks(s.prompt),
    });
  }
  if (template.title === null) {
    await tx.db.updateTable('insight_templates').set({ title: preset.title }).where('id', '=', template.id).execute();
  }
  await touchDraft(tx, template.id, draftId);
}

/** The section and its draft (only draft sections can change). */
async function loadDraftSection(tx: Tx, sectionId: string) {
  const row = await tx.db
    .selectFrom('insight_template_sections as s')
    .innerJoin('insight_template_snapshots as v', 'v.id', 's.snapshot_id')
    .innerJoin('insight_templates as t', 't.id', 'v.template_id')
    .select([
      's.id',
      's.snapshot_id',
      's.type',
      's.sort_order',
      's.title_document_id',
      's.prompt_document_id',
      'v.status',
      'v.template_id',
    ])
    .where('s.id', '=', sectionId)
    .where('s.deleted_at', 'is', null)
    .where('t.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw notFound('Section not found', { conversation_insight_template_snapshot_section_id: sectionId });
  if (row.status !== 'draft') {
    throw new DomainError(409, 'SNAPSHOT_NOT_DRAFT', 'Only the draft version of a template can be changed', {
      conversation_insight_template_snapshot_section_id: sectionId,
    });
  }
  return row;
}

async function neighbours(tx: Tx, snapshotId: string) {
  return tx.db
    .selectFrom('insight_template_sections')
    .select(['id', 'sort_order'])
    .where('snapshot_id', '=', snapshotId)
    .where('deleted_at', 'is', null)
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
}

export const templateOps = {
  async list(tx: Tx, input: ListInsightTemplatesInput): Promise<InsightTemplate[]> {
    const data = listInsightTemplatesInputSchema.parse(input);
    const rows = (await tx.db
      .selectFrom('insight_templates')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where('is_transient', '=', false)
      .orderBy('sort_order')
      .orderBy('id')
      .execute()) as TemplateRow[];
    const views = await templateViews(tx, rows);
    return data.enabledOnly ? views.filter((v) => v.status === 'enabled' && v.activeSnapshotId !== null) : views;
  },

  async get(tx: Tx, templateId: string): Promise<InsightTemplateDetail> {
    return detail(tx, await loadTemplate(tx, templateId));
  },

  /** "New template": transient draft template (idempotent by id); optionally started from a preset. */
  async create(tx: Tx, input: CreateInsightTemplateInput): Promise<InsightTemplateDetail> {
    const data = createInsightTemplateInputSchema.parse(input);
    const existing = await tx.db
      .selectFrom('insight_templates')
      .selectAll()
      .where('id', '=', data.id)
      .executeTakeFirst();
    if (existing) {
      if (existing.deleted_at) throw conflict('ID_CONFLICT', 'A template with this id already existed');
      return detail(tx, existing as TemplateRow);
    }
    const title = data.title?.trim() || null;
    const row = (await tx.db
      .insertInto('insight_templates')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        title,
        sort_order: data.sortOrder ?? rankAfter(await lastSortOrder(tx)),
        is_transient: title === null,
        created_by: JSON.stringify(tx.ctx.actor),
      })
      .returningAll()
      .executeTakeFirstOrThrow()) as TemplateRow;
    const draftId = await newDraft(tx, row.id, null);
    if (data.presetId) await replaceWithPreset(tx, row, draftId, data.presetId);
    emitTemplate(tx, row.id);
    return detail(tx, await loadTemplate(tx, row.id));
  },

  /** Rename ('' → null), reorder, archive / restore. */
  async update(tx: Tx, input: UpdateInsightTemplateInput): Promise<InsightTemplateDetail> {
    const data = updateInsightTemplateInputSchema.parse(input);
    const row = await loadTemplate(tx, data.templateId, { lock: true });
    const set: Record<string, unknown> = { updated_at: tx.now };
    if (data.title !== undefined) {
      set.title = data.title?.trim() || null;
      if (set.title !== null) set.is_transient = false;
    }
    if (data.sortOrder !== undefined) set.sort_order = data.sortOrder;
    if (data.archived === true && row.archived_at === null) {
      set.archived_at = tx.now;
      set.status = 'disabled';
      // Members whose default it was fall back to none.
      await tx.db
        .updateTable('member_call_settings')
        .set({ default_insight_template_id: null, updated_at: tx.now })
        .where('default_insight_template_id', '=', row.id)
        .execute();
    } else if (data.archived === false && row.archived_at !== null) {
      const active = await tx.db
        .selectFrom('insight_template_snapshots')
        .select('id')
        .where('template_id', '=', row.id)
        .where('status', '=', 'active')
        .executeTakeFirst();
      set.archived_at = null;
      set.status = active ? 'enabled' : 'draft';
    }
    await tx.db
      .updateTable('insight_templates')
      .set(set as never)
      .where('id', '=', row.id)
      .execute();
    emitTemplate(tx, row.id);
    return detail(tx, await loadTemplate(tx, row.id));
  },

  /** Templates that have been used cannot be deleted (I calls §4.1). */
  async delete(tx: Tx, templateId: string): Promise<{ id: string }> {
    const row = await loadTemplate(tx, templateId, { lock: true });
    const used = await tx.db
      .selectFrom('call_insights')
      .select('id')
      .where('template_id', '=', row.id)
      .limit(1)
      .executeTakeFirst();
    if (used) {
      throw conflict('TEMPLATE_IN_USE', 'Templates that have been used cannot be deleted', {
        conversation_insight_template_id: row.id,
      });
    }
    await tx.db
      .updateTable('member_call_settings')
      .set({ default_insight_template_id: null, updated_at: tx.now })
      .where('default_insight_template_id', '=', row.id)
      .execute();
    await tx.db
      .updateTable('insight_templates')
      .set({ deleted_at: tx.now, updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    emitTemplate(tx, row.id);
    return { id: row.id };
  },

  /** A new draft template with a copy of the source's latest edits (its draft). */
  async duplicate(tx: Tx, input: z.input<typeof duplicateInsightTemplateInputSchema>): Promise<InsightTemplateDetail> {
    const data = duplicateInsightTemplateInputSchema.parse(input);
    const source = await loadTemplate(tx, data.templateId);
    const existing = await tx.db
      .selectFrom('insight_templates')
      .select('id')
      .where('id', '=', data.newTemplateId)
      .executeTakeFirst();
    if (existing) throw conflict('ID_CONFLICT', 'A template with this id already exists');
    const snapshots = await liveSnapshots(tx, [source.id]);
    const from = snapshots.find((s) => s.status === 'draft') ?? snapshots.find((s) => s.status === 'active');
    await tx.db
      .insertInto('insight_templates')
      .values({
        id: data.newTemplateId,
        workspace_id: tx.workspaceId,
        title: `${displayTitle(source)} (copy)`,
        sort_order: rankAfter(await lastSortOrder(tx)),
        is_transient: false,
        created_by: JSON.stringify(tx.ctx.actor),
      })
      .execute();
    const draftId = await newDraft(tx, data.newTemplateId, null);
    if (from) await copySections(tx, from.id, draftId);
    emitTemplate(tx, data.newTemplateId);
    return detail(tx, await loadTemplate(tx, data.newTemplateId));
  },

  /** Draft → active version; a new draft is forked from it ("Publish changes" stays disabled until edited). */
  async publish(tx: Tx, templateId: string): Promise<InsightTemplateDetail> {
    const row = await loadTemplate(tx, templateId, { lock: true });
    const draft = await draftOf(tx, row.id);
    const [view] = await templateViews(tx, [row]);
    if (!view?.canPublish) {
      throw new DomainError(409, 'SNAPSHOT_NOT_DRAFT', 'There are no changes to publish', {
        conversation_insight_template_id: row.id,
      });
    }
    await assertComplete(tx, draft.id, 'publish');
    await tx.db
      .updateTable('insight_template_snapshots')
      .set({ status: 'superseded' })
      .where('template_id', '=', row.id)
      .where('status', '=', 'active')
      .execute();
    await tx.db
      .updateTable('insight_template_snapshots')
      .set({ status: 'active', published_at: tx.now, published_by: JSON.stringify(tx.ctx.actor) })
      .where('id', '=', draft.id)
      .execute();
    const firstSection = ((await snapshotSections(tx, [draft.id])).get(draft.id) ?? [])[0];
    await tx.db
      .updateTable('insight_templates')
      .set({
        status: row.archived_at ? 'disabled' : 'enabled',
        first_enabled_at: row.first_enabled_at ?? tx.now,
        is_transient: false,
        // The list shows title ?? ai_title: without a title, name the template after its first section.
        ai_title: row.title === null ? (row.ai_title ?? firstSection?.title.split('\n')[0] ?? null) : row.ai_title,
        updated_at: tx.now,
      })
      .where('id', '=', row.id)
      .execute();
    await newDraft(tx, row.id, draft.id);
    emitTemplate(tx, row.id);
    return detail(tx, await loadTemplate(tx, row.id));
  },

  /** Throws the draft away and forks a fresh one from the active version. */
  async discard(tx: Tx, templateId: string): Promise<InsightTemplateDetail> {
    const row = await loadTemplate(tx, templateId, { lock: true });
    const draft = await draftOf(tx, row.id);
    if (draft.parent_snapshot_id === null) {
      throw new DomainError(409, 'SNAPSHOT_NOT_DRAFT', 'A template that was never published has nothing to discard', {
        conversation_insight_template_id: row.id,
      });
    }
    await deleteSectionsOf(tx, draft.id);
    await tx.db
      .updateTable('insight_template_snapshots')
      .set({ status: 'discarded' })
      .where('id', '=', draft.id)
      .execute();
    await newDraft(tx, row.id, draft.parent_snapshot_id);
    emitTemplate(tx, row.id, false);
    return detail(tx, await loadTemplate(tx, row.id));
  },

  /** "Use this template": the draft's sections become the preset's. */
  async applyPreset(tx: Tx, input: ApplyInsightPresetInput): Promise<InsightTemplateDetail> {
    const data = applyInsightPresetInputSchema.parse(input);
    const row = await loadTemplate(tx, data.templateId, { lock: true });
    const draft = await draftOf(tx, row.id);
    await replaceWithPreset(tx, row, draft.id, data.presetId);
    emitTemplate(tx, row.id);
    return detail(tx, await loadTemplate(tx, row.id));
  },

  sections: {
    async create(tx: Tx, input: CreateInsightSectionInput): Promise<InsightTemplateDetail> {
      const data = createInsightSectionInputSchema.parse(input);
      const row = await loadTemplate(tx, data.templateId, { lock: true });
      const draft = await draftOf(tx, row.id);
      const existing = await tx.db
        .selectFrom('insight_template_sections')
        .select(['id', 'snapshot_id'])
        .where('id', '=', data.sectionId)
        .executeTakeFirst();
      if (existing) {
        if (existing.snapshot_id !== draft.id) throw conflict('ID_CONFLICT', 'A section with this id already exists');
        return detail(tx, row);
      }
      const all = await neighbours(tx, draft.id);
      await createSectionRow(tx, draft.id, {
        id: data.sectionId,
        type: data.type,
        sortOrder: data.sortOrder ?? rankAfter(all.at(-1)?.sort_order ?? null),
        title: textToBlocks(data.title ?? ''),
        prompt: textToBlocks(data.prompt ?? ''),
      });
      await touchDraft(tx, row.id, draft.id);
      return detail(tx, await loadTemplate(tx, row.id));
    },

    /** Format, order, and (API / tests) title / prompt text. */
    async update(tx: Tx, input: UpdateInsightSectionInput): Promise<InsightTemplateDetail> {
      const data = updateInsightSectionInputSchema.parse(input);
      const section = await loadDraftSection(tx, data.sectionId);
      const set: Record<string, unknown> = {};
      if (data.type !== undefined) set.type = data.type;
      if (data.sortOrder !== undefined) set.sort_order = data.sortOrder;
      if (Object.keys(set).length > 0) {
        await tx.db
          .updateTable('insight_template_sections')
          .set(set as never)
          .where('id', '=', section.id)
          .execute();
      }
      if (data.title !== undefined) await writeDocumentBlocks(tx, section.title_document_id, textToBlocks(data.title));
      if (data.prompt !== undefined) {
        await writeDocumentBlocks(tx, section.prompt_document_id, textToBlocks(data.prompt));
      }
      await touchDraft(tx, section.template_id, section.snapshot_id);
      return detail(tx, await loadTemplate(tx, section.template_id));
    },

    async delete(tx: Tx, sectionId: string): Promise<InsightTemplateDetail> {
      const section = await loadDraftSection(tx, sectionId);
      await tx.db
        .updateTable('insight_template_sections')
        .set({ deleted_at: tx.now })
        .where('id', '=', section.id)
        .execute();
      await tx.db
        .updateTable('documents')
        .set({ deleted_at: tx.now })
        .where('id', 'in', [section.title_document_id, section.prompt_document_id])
        .execute();
      await touchDraft(tx, section.template_id, section.snapshot_id);
      return detail(tx, await loadTemplate(tx, section.template_id));
    },

    /** A copy right after the section. */
    async duplicate(tx: Tx, input: z.input<typeof duplicateInsightSectionInputSchema>): Promise<InsightTemplateDetail> {
      const data = duplicateInsightSectionInputSchema.parse(input);
      const section = await loadDraftSection(tx, data.sectionId);
      const all = await neighbours(tx, section.snapshot_id);
      const at = all.findIndex((s) => s.id === section.id);
      const texts = await documentTexts(tx, [section.title_document_id, section.prompt_document_id]);
      await createSectionRow(tx, section.snapshot_id, {
        id: data.newSectionId,
        type: section.type,
        sortOrder: rankBetween(section.sort_order, all[at + 1]?.sort_order ?? null),
        title: texts.get(section.title_document_id)?.blocks ?? [],
        prompt: texts.get(section.prompt_document_id)?.blocks ?? [],
      });
      await touchDraft(tx, section.template_id, section.snapshot_id);
      return detail(tx, await loadTemplate(tx, section.template_id));
    },

    /** Move Up / Move Down: a new order between the neighbours. */
    async move(tx: Tx, input: z.input<typeof moveInsightSectionInputSchema>): Promise<InsightTemplateDetail> {
      const data = moveInsightSectionInputSchema.parse(input);
      const section = await loadDraftSection(tx, data.sectionId);
      const all = await neighbours(tx, section.snapshot_id);
      const at = all.findIndex((s) => s.id === section.id);
      let order: string | null = null;
      if (data.direction === 'up' && at > 0) {
        order = rankBetween(all[at - 2]?.sort_order ?? null, all[at - 1]?.sort_order ?? null);
      } else if (data.direction === 'down' && at < all.length - 1) {
        order = rankBetween(all[at + 1]?.sort_order ?? null, all[at + 2]?.sort_order ?? null);
      }
      if (order !== null) {
        await tx.db
          .updateTable('insight_template_sections')
          .set({ sort_order: order })
          .where('id', '=', section.id)
          .execute();
        await touchDraft(tx, section.template_id, section.snapshot_id);
      }
      return detail(tx, await loadTemplate(tx, section.template_id));
    },
  },
};

/** The active snapshot of an enabled, not archived template (what call insights use). */
export async function activeSnapshotOf(
  tx: Tx,
  templateId: string,
): Promise<{ template: TemplateRow; snapshotId: string }> {
  const template = await loadTemplate(tx, templateId);
  const active = await tx.db
    .selectFrom('insight_template_snapshots')
    .select('id')
    .where('template_id', '=', template.id)
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (!active || template.status !== 'enabled' || template.archived_at !== null) {
    throw badRequest('VALIDATION_ERROR', 'Only published templates can be used for call insights', {
      conversation_insight_template_id: templateId,
    });
  }
  return { template, snapshotId: active.id };
}

export { displayTitle as templateDisplayTitle, loadTemplate };
