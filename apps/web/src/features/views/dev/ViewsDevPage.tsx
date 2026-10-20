// Dev route `/<workspace>/__dev/views?object=<api slug>&view=<id>` (dev builds only): mounts the views UI against a
// seeded object with the object page chrome and a stand-in grid, for visual checks against  and for e2e.
// The production object page (features/objects + features/table) composes the same components.
import type { AttributeDefinition, ViewColumn } from '@agentic-crm/contracts';
import { Button, Icon, IconTile, Spinner } from '@agentic-crm/ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { createContext, Suspense, useContext, useRef, useState } from 'react';
import { useObjects } from '../../../data/objects';
import { valuesQuery } from '../../../data/records';
import { api, inWorkspace } from '../../../data/trpc';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { objectAppearance } from '../../shell/objectAppearance';
import { PageHeader } from '../../shell/PageHeader';
import { useWorkspace } from '../../shell/workspaceContext';
import { readColumnFormat } from '../columns';
import { AddColumnPicker, AddColumnPopover } from '../components/AddColumnPicker';
import { ColumnHeaderMenu } from '../components/ColumnMenus';
import { StartWithAView } from '../components/StartWithAView';
import { ViewFilterSortBar } from '../components/ViewFilterSortBar';
import { ViewSettingsPopover } from '../components/ViewSettingsPopover';
import { ViewSwitcher } from '../components/ViewSwitcher';
import { useAttributeOptions, useViews, useWorkspaceRef } from '../data';
import { attributeIcon } from '../operators';
import { dateValueLabel } from '../relativeDates';
import { useViewDraft, type ViewDraft } from '../useViewDraft';
import * as d from './dev.css';

export interface ViewsDevSearch {
  object?: string;
  view?: string;
  empty?: boolean;
  /** Show the header menu's extra items (Filter, Insert left/right). */
  extras?: boolean;
}

const ExtrasContext = createContext(false);

export function ViewsDevPage({ search, navigate }: { search: ViewsDevSearch; navigate: (s: ViewsDevSearch) => void }) {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace);
  const slug = search.object ?? 'projects';
  const object = objects.data?.find((o) => o.apiSlug === slug);
  const views = useViews(object?.id);
  useDocumentTitle(object ? `${object.pluralNoun} (views dev)` : 'Views dev');
  if (!object || views.isPending) {
    return (
      <div style={{ padding: 24 }}>
        {objects.isPending || views.isPending ? <Spinner size={16} /> : `No object "${slug}"`}
      </div>
    );
  }
  const look = objectAppearance(object);
  const list = views.data ?? [];
  const viewId = list.find((v) => v.id === search.view)?.id ?? list[0]?.id;
  const go = (id: string | null) =>
    navigate({ object: slug, ...(id ? { view: id } : {}), ...(search.extras ? { extras: true } : {}) });
  return (
    <div className={d.page} data-testid="views-dev">
      <PageHeader
        crumbs={[{ label: object.pluralNoun, icon: <IconTile icon={look.icon} color={look.color} size={16} /> }]}
      />
      {search.empty || !viewId ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <StartWithAView object={{ id: object.id, pluralNoun: object.pluralNoun }} onCreated={(v) => go(v.id)} />
        </div>
      ) : (
        <Suspense fallback={<Spinner size={16} />}>
          <ExtrasContext.Provider value={Boolean(search.extras)}>
            <ObjectView viewId={viewId} entityDefinitionId={object.id} singular={object.singularNoun} onNavigate={go} />
          </ExtrasContext.Provider>
        </Suspense>
      )}
    </div>
  );
}

function ObjectView({
  viewId,
  entityDefinitionId,
  singular,
  onNavigate,
}: {
  viewId: string;
  entityDefinitionId: string;
  singular: string;
  onNavigate: (id: string | null) => void;
}) {
  const draft = useViewDraft(viewId);
  return (
    <>
      <div className={d.toolbar}>
        <ViewSwitcher entityDefinitionId={entityDefinitionId} currentViewId={viewId} onNavigate={onNavigate} />
        <ViewSettingsPopover draft={draft} onCreateAttribute={() => {}} onEditAttribute={() => {}} />
        <span className={d.spacer} />
        <Button variant="secondary" size={28} icon="importExport" chevron>
          Import / Export
        </Button>
        <Button size={28} icon="add">
          New {singular}
        </Button>
      </div>
      <ViewFilterSortBar draft={draft} onNavigate={(id) => onNavigate(id)} />
      <StandInGrid draft={draft} singular={singular} />
    </>
  );
}

// ---- stand-in grid -----------------------------------------------------------------------------------------------

const DEFAULT_WIDTH: Partial<Record<AttributeDefinition['type'], number>> = {
  timestamp: 200,
  checkbox: 100,
  rating: 140,
};

function columnWidth(column: ViewColumn, attribute: AttributeDefinition | undefined): number {
  return column.tableColumnWidth ?? (attribute ? (DEFAULT_WIDTH[attribute.type] ?? 180) : 180);
}

function StandInGrid({ draft, singular }: { draft: ViewDraft; singular: string }) {
  const ws = useWorkspaceRef();
  const snapshot = useQuery({
    queryKey: ['ws', ws.id, 'snapshot', draft.view.entityDefinitionId, 'views-dev', draft.queryKey],
    queryFn: () => api.snapshots.query.query({ ...draft.query, initialRange: { start: 0, size: 50 } }, inWorkspace(ws)),
    placeholderData: (prev) => prev,
  });
  const ids = snapshot.data?.ids ?? [];
  const emptyRef = useRef<HTMLButtonElement>(null);
  const [emptyPicker, setEmptyPicker] = useState(false);
  return (
    <div className={d.grid} data-testid="stand-in-grid">
      <div className={d.headerRow}>
        <div className={d.cell} style={{ width: draft.view.tableRecordColumnWidth ?? 250 }}>
          <span className={d.checkbox} />
          <span style={{ flex: 1 }}>{singular}</span>
          <Icon icon="add" size={16} className={d.headerIcon} />
        </div>
        {draft.columns.map((column) => (
          <HeaderCell key={column.id} draft={draft} column={column} />
        ))}
        <div className={d.cell} style={{ minWidth: 250, border: 'none', padding: '0 6px' }}>
          <AddColumnPicker draft={draft} onCreateAttribute={() => {}} />
        </div>
      </div>
      {snapshot.isError && (
        <div style={{ padding: 12, color: 'var(--ar-color-content-critical)' }}>Unable to load table</div>
      )}
      {ids.map((id) => (
        <div key={id} className={d.row} data-testid="stand-in-row">
          <div className={d.cell} style={{ width: draft.view.tableRecordColumnWidth ?? 250 }}>
            <span className={d.checkbox} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{id}</span>
          </div>
          {draft.columns.map((column) => (
            <Cell key={column.id} draft={draft} column={column} recordId={id} />
          ))}
        </div>
      ))}
      <div className={d.footer}>
        <div className={`${d.cell} ${d.numeric}`} style={{ width: draft.view.tableRecordColumnWidth ?? 250 }}>
          <span style={{ color: 'var(--ar-color-content-primary)' }}>{snapshot.data?.total ?? 0}</span> count
        </div>
      </div>
      {draft.columns.length === 0 && (
        <div className={d.empty}>
          <span className={d.emptyIcon}>
            <Icon icon="columns" size={20} />
          </span>
          <div className={d.emptyTitle}>Add your first attribute column</div>
          <div className={d.emptyText}>There are currently no attributes set up as columns in this view.</div>
          <Button ref={emptyRef} size={28} icon="add" onPress={() => setEmptyPicker(true)}>
            Add attribute column
          </Button>
          {emptyPicker && (
            <AddColumnPopover
              draft={draft}
              triggerRef={emptyRef}
              isOpen
              onOpenChange={setEmptyPicker}
              onCreateAttribute={() => {}}
            />
          )}
        </div>
      )}
    </div>
  );
}

function HeaderCell({ draft, column }: { draft: ViewDraft; column: ViewColumn }) {
  const extras = useContext(ExtrasContext);
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const attribute = draft.schema?.leaf(column.path);
  const label = column.title ?? draft.schema?.pathLabel(column.path, column.field) ?? '';
  return (
    <>
      <div
        ref={ref}
        className={d.headerCell}
        style={{ width: columnWidth(column, attribute) }}
        role="columnheader"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}
        data-testid="column-header"
      >
        {attribute && <Icon icon={attributeIcon(attribute)} size={16} className={d.headerIcon} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      </div>
      <ColumnHeaderMenu
        draft={draft}
        column={column}
        triggerRef={ref}
        isOpen={open}
        onOpenChange={setOpen}
        onEditAttribute={() => {}}
        extraItems={extras ? { filter: true, insert: true } : undefined}
      />
    </>
  );
}

function Cell({ draft, column, recordId }: { draft: ViewDraft; column: ViewColumn; recordId: string }) {
  const ws = useWorkspaceRef();
  const attribute = draft.schema?.leaf(column.path);
  const direct = column.path.length === 1 && attribute;
  const [values] = useQueries({
    queries: [
      {
        ...valuesQuery({
          workspace: ws,
          entityDefinitionId: draft.view.entityDefinitionId,
          entityInstanceId: recordId,
          attributeDefinitionId: column.path[0]?.attributeDefinitionId ?? '',
        }),
        enabled: Boolean(direct),
      },
    ],
  });
  const numeric = attribute && ['number', 'currency', 'rating'].includes(attribute.type);
  return (
    <div className={`${d.cell} ${numeric ? d.numeric : ''}`} style={{ width: columnWidth(column, attribute) }}>
      {direct && attribute ? (
        <CellText attribute={attribute} column={column} values={(values?.data?.values ?? []).map((v) => v.value)} />
      ) : (
        <span className={d.muted}>—</span>
      )}
    </div>
  );
}

function CellText({
  attribute,
  column,
  values,
}: {
  attribute: AttributeDefinition;
  column: ViewColumn;
  values: unknown[];
}) {
  const options = useAttributeOptions(attribute.type === 'select' || attribute.type === 'pipeline' ? attribute : null);
  const format = readColumnFormat(column.displayConfiguration);
  const v = values[0] as Record<string, unknown> | string | number | boolean | undefined;
  if (v === undefined || v === null) return null;
  switch (attribute.type) {
    case 'checkbox':
      return (
        <span
          className={d.checkbox}
          style={v ? { backgroundColor: 'var(--ar-color-interactive-primary)' } : undefined}
        />
      );
    case 'number':
      return (
        <>
          {new Intl.NumberFormat(undefined, {
            useGrouping: format.number?.groups !== 'no-groups',
            ...(format.number?.decimalPlaces != null
              ? {
                  minimumFractionDigits: format.number.decimalPlaces,
                  maximumFractionDigits: format.number.decimalPlaces,
                }
              : {}),
          }).format(Number(v))}
        </>
      );
    case 'currency': {
      const obj = v as { currencyValue?: number; currencyCode?: string | null };
      const code = obj.currencyCode ?? attribute.config.currencyConfiguration?.defaultCurrencyCode ?? 'USD';
      const display = format.currency?.displayType ?? 'symbol';
      const decimals = format.currency?.decimalPlaces === 'no-decimals' ? 0 : 2;
      return (
        <>
          {new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: code,
            currencyDisplay: display === 'symbol' ? 'narrowSymbol' : display,
            useGrouping: format.currency?.groups !== 'no-groups',
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          }).format(Number(obj.currencyValue ?? 0))}
        </>
      );
    }
    case 'date':
    case 'timestamp': {
      const day = String(v).slice(0, 10);
      if (format.datetime?.displayType === 'relative') {
        const days = Math.round((Date.parse(day) - Date.now()) / 86_400_000);
        return <>{new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(days, 'day')}</>;
      }
      return <>{dateValueLabel({ kind: 'exact', date: day })}</>;
    }
    case 'select':
    case 'pipeline': {
      const ids = values.map((x) =>
        String((x as Record<string, unknown>).selectOptionId ?? (x as Record<string, unknown>).pipelineStageId),
      );
      return <>{ids.map((id) => options?.find((o) => o.id === id)?.title ?? '').join(', ')}</>;
    }
    case 'rating':
      return <>{'★'.repeat(Number(v))}</>;
    default:
      if (typeof v === 'string' || typeof v === 'number') return <>{String(v)}</>;
      if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return (
          <>
            {String(
              o.fullName ??
                o.locality ??
                o.domain ??
                o.emailAddress ??
                o.originalPhoneNumber ??
                o.entityInstanceId ??
                o.referencedActorId ??
                '',
            )}
          </>
        );
      }
      return null;
  }
}
