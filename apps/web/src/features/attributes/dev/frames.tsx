// visual review frames: fixed-geometry reconstructions of the curated  visual examples (cells at the measured column
// and row positions, the editor open on the same cell) for apps/web/e2e/attributes-parity.spec.ts. Only the
// attribute-owned parts are drawn (cells, editors, history, new-record dialog); headers and footers are the table's.
import { cx } from '@agentic-crm/ui';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { EditorPopover } from '../editors/shell';
import { buildHistory } from '../history';
import { NewRecordDialog } from '../NewRecordDialog';
import { getAttributeUi } from '../registry';
import type { AttributeDefinition, AttributeValue, CommitInput } from '../types';
import { HistoryContent } from '../ValueHistoryPopover';
import { planCommit } from '../write/plan';
import {
  A,
  byBudget,
  byId,
  DEAL,
  GALLERY_WS,
  MEMBERS,
  OBJ,
  PEOPLE_ROWS,
  type ProjectRow,
  personValues,
  projectValues,
  summaryHistory,
} from './fixtures';
import * as g from './gallery.css';

interface Column {
  x: number;
  width: number;
  attribute: AttributeDefinition;
  field?: string;
}

interface Row {
  top: number;
  id: string;
  values: Record<string, AttributeValue[]>;
}

const col = (x: number, width: number, attribute: AttributeDefinition, field?: string): Column => ({
  x,
  width,
  attribute,
  field,
});

const projectRows = (list: ProjectRow[], firstTop: number, from = 0, to = list.length): Row[] =>
  list.slice(from, to).map((p, i) => ({ top: firstTop + i * 36, id: p.id, values: projectValues(p) }));

/** The open editor of a frame: which cell, and an optional query typed into it. */
interface Editing {
  attributeId: string;
  rowId: string;
  initialKey?: string;
  history?: boolean;
  selected?: boolean;
}

function Grid({ columns, rows, editing }: { columns: Column[]; rows: Row[]; editing?: Editing }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [values, setValues] = useState<Record<string, Record<string, AttributeValue[]>>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.values])),
  );
  const editCol = editing ? columns.find((c) => c.attribute.id === editing.attributeId) : undefined;
  const commit = (rowId: string, attribute: AttributeDefinition) => (next: CommitInput) =>
    setValues((all) => {
      const plan = planCommit(attribute, all[rowId]?.[attribute.id] ?? [], next, {
        recordRef: { workspace: GALLERY_WS, entityDefinitionId: attribute.entityDefinitionId, entityInstanceId: rowId },
        newId: () => crypto.randomUUID(),
      });
      return { ...all, [rowId]: { ...all[rowId], [attribute.id]: plan.optimistic } };
    });
  return (
    <>
      {rows.map((r) =>
        columns.map((c) => {
          const isEditing = editing?.rowId === r.id && editing.attributeId === c.attribute.id;
          const View = getAttributeUi(c.attribute.type).View;
          return (
            <div
              key={`${r.id}:${c.attribute.id}:${c.x}`}
              ref={isEditing ? setAnchor : undefined}
              className={cx(g.gridCell, isEditing && editing?.selected && g.gridSelected)}
              style={{ left: c.x, top: r.top, width: c.width }}
              data-cell={`${r.id}:${c.attribute.apiSlug}`}
            >
              <View
                attribute={c.attribute}
                values={values[r.id]?.[c.attribute.id] ?? []}
                density="cell"
                field={c.field}
              />
            </div>
          );
        }),
      )}
      {editing && editCol && anchor && !editing.history && (
        <FrameEditor
          attribute={editCol.attribute}
          values={values[editing.rowId]?.[editCol.attribute.id] ?? []}
          anchor={anchor}
          initialKey={editing.initialKey}
          onCommit={commit(editing.rowId, editCol.attribute)}
          field={editCol.field}
        />
      )}
      {editing?.history && anchor && editCol && <FrameHistory anchor={anchor} rowId={editing.rowId} />}
    </>
  );
}

function FrameEditor({
  attribute,
  values,
  anchor,
  initialKey,
  onCommit,
  field,
}: {
  attribute: AttributeDefinition;
  values: AttributeValue[];
  anchor: HTMLElement;
  initialKey?: string;
  onCommit: (next: CommitInput) => void;
  field?: string;
}) {
  const Editor = getAttributeUi(attribute.type).Editor;
  return (
    <Editor
      attribute={attribute}
      values={values}
      anchor={anchor}
      initialKey={initialKey}
      onCommit={onCommit}
      onCancel={() => {}}
      field={field}
    />
  );
}

function FrameHistory({ anchor, rowId }: { anchor: HTMLElement; rowId: string }) {
  const events = useMemo(() => buildHistory(A.summary, summaryHistory(rowId)), [rowId]);
  return (
    <EditorPopover
      anchor={anchor}
      width={320}
      label="Edit history"
      placement="right"
      onDismiss={() => {}}
      onEscape={() => {}}
    >
      <HistoryContent attribute={A.summary} events={events} members={MEMBERS} />
    </EditorPopover>
  );
}

const ROW_012 = byBudget.find((p) => p.code === 'SEED-012')?.id ?? '';

export interface FrameSpec {
  viewport: { width: number; height: number };
  render: () => ReactNode;
}

/** Editor crops: rows 3–11 of the Budget-desc order, row SEED-012 at y=184. */
const cropRows = () => projectRows(byBudget, 4 - 36 * 4, 0, 12);

export const FRAMES: Record<string, FrameSpec> = {
  //: 12 rows in record-id order from y=186.
  'cells-projects': {
    viewport: { width: 2000, height: 660 },
    render: () => (
      <Grid
        rows={projectRows(byId, 186)}
        columns={[
          col(250, 180, A.code),
          col(430, 180, A.summary),
          col(610, 180, A.budget),
          col(790, 180, A.headcount),
          col(970, 100, A.strategic),
          col(1070, 180, A.startDate),
          col(1250, 200, A.kickoff),
          col(1450, 180, A.phase),
          col(1630, 180, A.tags),
          col(1810, 140, A.health),
          col(1950, 180, A.stakeholders),
        ]}
      />
    ),
  },
  //  (the path column "Next … › Due date" is the table's).
  'cells-related': {
    viewport: { width: 2000, height: 660 },
    render: () => (
      <Grid
        rows={projectRows(byId, 186)}
        columns={[
          col(25, 180, A.stakeholders),
          col(205, 180, A.owner),
          col(385, 200, A.createdAt),
          col(785, 180, A.priority),
          col(965, 180, A.createdBy),
          col(1145, 180, A.recordId),
          col(1325, 180, A.office, 'locality'),
          col(1505, 180, A.office, 'country_code'),
        ]}
      />
    ),
  },
  //
  'cells-deal': {
    viewport: { width: 1237, height: 945 },
    render: () => (
      <Grid
        rows={[{ top: 186, id: DEAL.id, values: DEAL.values }]}
        columns={[
          col(250, 180, A.dealStage),
          col(430, 180, A.dealOwner),
          col(610, 180, A.dealValue),
          col(970, 180, A.dealCreatedBy),
        ]}
      />
    ),
  },
  'editor-timestamp': {
    viewport: { width: 1000, height: 619 },
    render: () => (
      <Grid
        rows={cropRows()}
        editing={{ attributeId: A.kickoff.id, rowId: ROW_012 }}
        columns={[
          col(-40, 100, A.strategic),
          col(60, 180, A.startDate),
          col(240, 200, A.kickoff),
          col(440, 180, A.phase),
          col(620, 180, A.tags),
          col(800, 140, A.health),
          col(940, 180, A.stakeholders),
        ]}
      />
    ),
  },
  'editor-status': {
    viewport: { width: 1000, height: 619 },
    render: () => (
      <Grid
        rows={cropRows()}
        editing={{ attributeId: A.phase.id, rowId: ROW_012 }}
        columns={[
          col(-140, 180, A.startDate),
          col(40, 200, A.kickoff),
          col(240, 180, A.phase),
          col(420, 180, A.tags),
          col(600, 140, A.health),
          col(740, 180, A.stakeholders),
          col(920, 180, A.owner),
        ]}
      />
    ),
  },
  'editor-multiselect': {
    viewport: { width: 1000, height: 619 },
    render: () => (
      <Grid
        rows={cropRows()}
        editing={{ attributeId: A.tags.id, rowId: ROW_012 }}
        columns={[
          col(-140, 200, A.kickoff),
          col(60, 180, A.phase),
          col(240, 180, A.tags),
          col(420, 140, A.health),
          col(560, 180, A.stakeholders),
          col(740, 180, A.owner),
          col(920, 200, A.createdAt),
        ]}
      />
    ),
  },
  'editor-select': {
    viewport: { width: 1000, height: 619 },
    render: () => (
      <Grid
        rows={cropRows()}
        editing={{ attributeId: A.priority.id, rowId: ROW_012 }}
        columns={[
          col(132, 180, A.priority),
          col(312, 180, A.createdBy),
          col(492, 180, A.recordId),
          col(672, 180, A.office, 'locality'),
          col(852, 180, A.office, 'country_code'),
        ]}
      />
    ),
  },
  'editor-create-option': {
    viewport: { width: 1000, height: 619 },
    render: () => (
      <Grid
        rows={cropRows()}
        editing={{ attributeId: A.tags.id, rowId: ROW_012, initialKey: 'Zeta' }}
        columns={[
          col(-48, 180, A.phase),
          col(132, 180, A.tags),
          col(312, 140, A.health),
          col(452, 180, A.stakeholders),
          col(632, 180, A.owner),
          col(812, 200, A.createdAt),
        ]}
      />
    ),
  },
  //: people, Jane Cooper's row at y=234.
  'editor-email': {
    viewport: { width: 1000, height: 700 },
    render: () => (
      <Grid
        rows={PEOPLE_ROWS.map((p, i) => ({ top: 18 + i * 36, id: p.id, values: personValues(p) }))}
        editing={{ attributeId: A.personEmails.id, rowId: PEOPLE_ROWS[6]?.id ?? '' }}
        columns={[
          col(120, 180, A.personName),
          col(300, 180, A.personEmails),
          col(480, 180, A.personPhones),
          col(660, 180, A.personCompany),
          col(840, 180, A.personJob),
        ]}
      />
    ),
  },
  'editor-phone': {
    viewport: { width: 1000, height: 700 },
    render: () => (
      <Grid
        rows={PEOPLE_ROWS.map((p, i) => ({ top: 18 + i * 36, id: p.id, values: personValues(p) }))}
        editing={{ attributeId: A.personPhones.id, rowId: PEOPLE_ROWS[6]?.id ?? '' }}
        columns={[
          col(-60, 180, A.personName),
          col(120, 180, A.personEmails),
          col(300, 180, A.personPhones),
          col(480, 180, A.personCompany),
          col(660, 180, A.personJob),
        ]}
      />
    ),
  },
  //: the popover is pushed left by the window edge (8 px collision padding).
  'editor-date': {
    viewport: { width: 1237, height: 945 },
    render: () => (
      <Grid
        rows={projectRows(byBudget, 186)}
        editing={{ attributeId: A.startDate.id, rowId: ROW_012 }}
        columns={[col(1057, 180, A.startDate)]}
      />
    ),
  },
  //: the Summary of SEED-012 being edited.
  'editor-text': {
    viewport: { width: 1237, height: 945 },
    render: () => (
      <Grid
        rows={projectRows(byBudget, 186)}
        editing={{ attributeId: A.summary.id, rowId: ROW_012 }}
        columns={[
          col(250, 180, A.code),
          col(430, 180, A.summary),
          col(610, 180, A.budget),
          col(790, 180, A.headcount),
          col(970, 100, A.strategic),
          col(1070, 180, A.startDate),
        ]}
      />
    ),
  },
  //  (dark): "View edit history" beside the selected Summary cell.
  history: {
    viewport: { width: 1237, height: 945 },
    render: () => (
      <Grid
        rows={projectRows(byBudget, 186)}
        editing={{ attributeId: A.summary.id, rowId: ROW_012, history: true, selected: true }}
        columns={[
          col(-26, 180, A.code),
          col(155, 180, A.summary),
          col(335, 180, A.budget),
          col(515, 180, A.headcount),
          col(695, 100, A.strategic),
          col(795, 180, A.startDate),
          col(975, 200, A.kickoff),
          col(1175, 180, A.phase),
        ]}
      />
    ),
  },
  // Companies and [seed] Projects in dark mode.
  'new-record-companies': {
    viewport: { width: 1512, height: 945 },
    render: () => <NewRecordDialog entityDefinitionId={OBJ.companies} onClose={() => {}} />,
  },
  'new-record-projects': {
    viewport: { width: 1512, height: 945 },
    render: () => <NewRecordDialog entityDefinitionId={OBJ.projects} onClose={() => {}} />,
  },
};

export function ParityFrame({ id }: { id: string }) {
  const spec = FRAMES[id];
  const [ready, setReady] = useState(false);
  useEffect(() => {
    document.fonts.ready.then(() => setReady(true));
  }, []);
  if (!spec) return <div style={{ padding: 24 }}>Unknown frame “{id}”</div>;
  return (
    <div className={g.frame} data-frame={id} data-ready={ready || undefined}>
      {spec.render()}
    </div>
  );
}
