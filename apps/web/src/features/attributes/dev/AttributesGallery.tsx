// `/__dev/attributes` (dev builds only): every attribute type in its densities and editors on fixture data, for
// visual checks; `?frame=<id>` renders one fixed-geometry parity frame (dev/frames.tsx) for the Playwright parity run.
import { Button, cx, useThemeSettings } from '@agentic-crm/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { AttributeEnvProvider } from '../data/env';
import { buildHistory } from '../history';
import { NewRecordDialog } from '../NewRecordDialog';
import { getAttributeUi } from '../registry';
import type { AttributeDefinition, AttributeValue, CommitInput, CommitMeta, Density } from '../types';
import { HistoryContent } from '../ValueHistoryPopover';
import { planCommit } from '../write/plan';
import {
  A,
  byId,
  GALLERY_WS,
  galleryEnv,
  galleryQueryClient,
  MEMBERS,
  OBJ,
  PEOPLE_ROWS,
  personValues,
  projectValues,
  summaryHistory,
} from './fixtures';
import { ParityFrame } from './frames';
import * as g from './gallery.css';

interface Sample {
  label: string;
  attribute: AttributeDefinition;
  values: AttributeValue[];
  field?: string;
}

function samples(): Sample[] {
  const project = projectValues(byId.find((p) => p.code === 'SEED-001') ?? (byId[0] as (typeof byId)[number]));
  const person = personValues(
    PEOPLE_ROWS.find((p) => p.emails.length > 1) ?? (PEOPLE_ROWS[0] as (typeof PEOPLE_ROWS)[number]),
  );
  const v = (a: AttributeDefinition, from: Record<string, AttributeValue[]>) => from[a.id] ?? [];
  const interaction = (): AttributeValue[] => [
    {
      ...(v(A.summary, project)[0] as AttributeValue),
      id: 'interaction',
      attributeDefinitionId: A.personLast.id,
      attributeType: 'interaction',
      value: {
        interactionHeaderId: null,
        interactionType: 'email',
        interactedAt: '2025-10-08T10:00:00Z',
        ownerMembershipId: MEMBERS[0]?.id ?? null,
        mailboxId: null,
      },
    },
  ];
  return [
    { label: 'text', attribute: A.summary, values: v(A.summary, project) },
    { label: 'number', attribute: A.headcount, values: v(A.headcount, project) },
    { label: 'currency', attribute: A.budget, values: v(A.budget, project) },
    { label: 'checkbox', attribute: A.strategic, values: v(A.strategic, project) },
    { label: 'date', attribute: A.startDate, values: v(A.startDate, project) },
    { label: 'timestamp', attribute: A.kickoff, values: v(A.kickoff, project) },
    { label: 'rating', attribute: A.health, values: v(A.health, project) },
    { label: 'status', attribute: A.phase, values: v(A.phase, project) },
    { label: 'select', attribute: A.priority, values: v(A.priority, project) },
    { label: 'multi-select', attribute: A.tags, values: v(A.tags, project) },
    { label: 'record reference', attribute: A.client, values: v(A.client, project) },
    { label: 'record reference (multi)', attribute: A.stakeholders, values: v(A.stakeholders, project) },
    { label: 'actor reference', attribute: A.owner, values: v(A.owner, project) },
    { label: 'actor (API token)', attribute: A.createdBy, values: v(A.createdBy, project) },
    { label: 'location', attribute: A.office, values: v(A.office, project) },
    { label: 'location › City', attribute: A.office, values: v(A.office, project), field: 'locality' },
    { label: 'domain', attribute: A.website, values: v(A.website, project) },
    { label: 'email address (multi)', attribute: A.personEmails, values: v(A.personEmails, person) },
    { label: 'phone number', attribute: A.contactPhone, values: v(A.contactPhone, project) },
    { label: 'interaction', attribute: A.personLast, values: interaction() },
    { label: 'interaction (empty)', attribute: A.personLast, values: [] },
    { label: 'personal name', attribute: A.personName, values: v(A.personName, person) },
  ];
}

function useSampleState() {
  const [state, setState] = useState<Sample[]>(samples);
  const commit = (index: number) => (next: CommitInput) =>
    setState((list) =>
      list.map((s, i) => {
        if (i !== index) return s;
        const plan = planCommit(s.attribute, s.values, next, {
          recordRef: {
            workspace: GALLERY_WS,
            entityDefinitionId: s.attribute.entityDefinitionId,
            entityInstanceId: 'r',
          },
          newId: () => crypto.randomUUID(),
        });
        return { ...s, values: plan.optimistic };
      }),
    );
  return { state, commit };
}

function EditableValue({
  sample,
  density,
  onCommit,
}: {
  sample: Sample;
  density: Density;
  onCommit: (next: CommitInput, meta?: CommitMeta) => void;
}) {
  const ui = getAttributeUi(sample.attribute.type);
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ key?: string } | null>(null);
  const editable = ui.editorKind !== 'readonly' && !sample.attribute.isReadOnly;
  const close = () => {
    setEditing(null);
    ref.current?.focus();
  };
  const isCell = density === 'cell';
  return (
    <>
      <div
        ref={ref}
        tabIndex={0}
        role="gridcell"
        aria-label={`${sample.label} (${density})`}
        className={cx(isCell ? g.cellBox : g.fieldBox, editing && (isCell ? g.cellSelected : g.fieldOpen))}
        style={isCell ? { width: ui.defaultWidth } : undefined}
        onDoubleClick={() => editable && setEditing({})}
        onClick={() => !isCell && editable && setEditing({})}
        onKeyDown={(e) => {
          if (!editable || editing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            setEditing({});
          } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setEditing({ key: e.key });
          } else if (e.key === 'Backspace') onCommit([]);
        }}
      >
        <ui.View
          attribute={sample.attribute}
          values={sample.values}
          density={density}
          field={sample.field}
          onCommit={onCommit}
        />
      </div>
      {editing && (
        <ui.Editor
          attribute={sample.attribute}
          values={sample.values}
          anchor={ref.current}
          density={density}
          field={sample.field}
          initialKey={editing.key}
          onCommit={(next, meta) => {
            onCommit(next, meta);
            if (!meta?.keepOpen) close();
          }}
          onCancel={close}
        />
      )}
    </>
  );
}

function Overview() {
  const { state, commit } = useSampleState();
  const theme = useThemeSettings();
  const [dialog, setDialog] = useState<string | null>(null);
  const history = useMemo(() => buildHistory(A.summary, summaryHistory('r')), []);
  return (
    <div className={g.page}>
      <h1>Attribute registry</h1>
      <p className={g.lead}>
        Dev gallery (fixtures, no server). Double-click a cell, press Enter or type to edit; click a field. Locale and
        time zone follow the browser (X-11).
      </p>
      <div className={g.toolbar}>
        <Button
          size={28}
          variant="secondary"
          onPress={() => theme?.setTheme(theme.theme === 'dark' ? 'light' : 'dark')}
        >
          Toggle theme
        </Button>
        <Button size={28} variant="secondary" onPress={() => setDialog(OBJ.projects)}>
          New [seed] Project
        </Button>
        <Button size={28} variant="secondary" onPress={() => setDialog(OBJ.companies)}>
          New Company
        </Button>
      </div>
      <h2>Views and editors</h2>
      <table className={g.table}>
        <thead>
          <tr>
            <th style={{ width: 190 }}>Type</th>
            <th style={{ width: 216 }}>Cell</th>
            <th style={{ width: 216 }}>Cell (empty)</th>
            <th style={{ width: 316 }}>Field</th>
            <th style={{ width: 220 }}>Chip</th>
          </tr>
        </thead>
        <tbody>
          {state.map((s, i) => {
            const ui = getAttributeUi(s.attribute.type);
            return (
              <tr key={s.label}>
                <td className={g.typeName}>{s.label}</td>
                <td>
                  <EditableValue sample={s} density="cell" onCommit={commit(i)} />
                </td>
                <td>
                  <div className={g.cellBox} style={{ width: ui.defaultWidth }}>
                    <ui.View attribute={s.attribute} values={[]} density="cell" field={s.field} />
                  </div>
                </td>
                <td>
                  <EditableValue sample={s} density="field" onCommit={commit(i)} />
                </td>
                <td>
                  <ui.View attribute={s.attribute} values={s.values} density="chip" field={s.field} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h2>Expanded multi-value cell</h2>
      <div className={g.cellBox} style={{ width: 180, height: 'auto', minHeight: 36 }}>
        {state
          .filter((x) => x.label === 'record reference (multi)')
          .map((s) => {
            const ui = getAttributeUi(s.attribute.type);
            return <ui.View key={s.label} attribute={s.attribute} values={s.values} density="cell" expanded />;
          })}
      </div>
      <h2>Edit history</h2>
      <div style={{ width: 320, borderRadius: 12, boxShadow: 'var(--ar-elevation-e2)' }}>
        <HistoryContent attribute={A.summary} events={history} members={MEMBERS} />
      </div>
      {dialog && <NewRecordDialog entityDefinitionId={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

export function AttributesGallery() {
  const client = useMemo(galleryQueryClient, []);
  const env = useMemo(galleryEnv, []);
  const frame = new URLSearchParams(window.location.search).get('frame');
  return (
    <QueryClientProvider client={client}>
      <AttributeEnvProvider value={env}>{frame ? <ParityFrame id={frame} /> : <Overview />}</AttributeEnvProvider>
    </QueryClientProvider>
  );
}
