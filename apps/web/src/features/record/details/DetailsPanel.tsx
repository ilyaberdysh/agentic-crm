// Details panel body (D README §2.3): the layout's `details-sidebar` sections in order — Record Details sections
// (configured attributes or the first five) with "View all values", and the locked Lists section (the record's list
// entries, features/lists). "View all values" replaces the body with every attribute and a fuzzy search;
// it is transient and resets when the record changes.
import { Icon, IconButton } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { useWorkspace } from '../../shell/workspaceContext';
import { RecordListsSection } from '../adapters';
import { useRecordPage } from '../context';
import { invalidateTimeline } from '../data';
import type { ResolvedSection } from '../layout/model';
import { AttributeRow } from './AttributeRow';
import { fuzzyMatches, listedAttributes, sectionAttributes } from './attributes';
import * as s from './details.css';
import { RecordHeader } from './RecordHeader';

export function DetailsPanel() {
  const { layout, recordRef } = useRecordPage();
  const [viewAll, setViewAll] = useState(false);
  return (
    <>
      <RecordHeader />
      {viewAll ? (
        <ViewAllValues onBack={() => setViewAll(false)} key={recordRef.entityInstanceId} />
      ) : (
        layout.sections.map((section) =>
          section.element.type === 'details' ? (
            <DetailsSection key={section.element.elementId} section={section} onViewAll={() => setViewAll(true)} />
          ) : (
            <ListsSection key={section.element.elementId} />
          ),
        )
      )}
    </>
  );
}

/** The activity feed derives "changed …" events from value history: refresh it once a write has landed. */
export function useRefreshActivity(): () => void {
  const { workspace } = useWorkspace();
  const { recordRef } = useRecordPage();
  return useCallback(() => invalidateTimeline(workspace, recordRef), [workspace, recordRef]);
}

function DetailsSection({ section, onViewAll }: { section: ResolvedSection; onViewAll: () => void }) {
  const { attributes, recordRef } = useRecordPage();
  const [collapsed, setCollapsed] = useState(false);
  const rows = useMemo(() => sectionAttributes(attributes, section.values), [attributes, section.values]);
  const refresh = useRefreshActivity();
  const title = section.element.title?.trim() || 'Unnamed section';
  return (
    <section className={s.section} aria-label={title} data-testid="details-section">
      <div className={s.sectionHeader}>
        <button
          type="button"
          className={s.sectionToggle}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          {title}
          <Icon icon="chevronDown" size={12} className={s.chevron} data-collapsed={collapsed || undefined} />
        </button>
      </div>
      {!collapsed && (
        <div className={s.sectionBody}>
          {rows.map((attribute) => (
            <AttributeRow key={attribute.id} attribute={attribute} recordRef={recordRef} onSettled={refresh} />
          ))}
          <button type="button" className={s.viewAll} onClick={onViewAll}>
            View all values
          </button>
        </div>
      )}
    </section>
  );
}

function ViewAllValues({ onBack }: { onBack: () => void }) {
  const { attributes, recordRef } = useRecordPage();
  const [query, setQuery] = useState('');
  const all = useMemo(() => listedAttributes(attributes), [attributes]);
  const shown = all.filter((a) => fuzzyMatches(query, a.title));
  const refresh = useRefreshActivity();
  return (
    <section className={s.section} aria-label="All values" data-testid="view-all-values">
      <div className={s.viewAllHeader}>
        <IconButton icon="chevronLeft" variant="ghost" size={20} aria-label="Back" onPress={onBack} />
        <input
          className={s.searchInput}
          placeholder="Search attributes..."
          aria-label="Search attributes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              if (query) setQuery('');
              else onBack();
            }
          }}
        />
      </div>
      <div className={s.viewAllBody}>
        {shown.map((attribute) => (
          <AttributeRow key={attribute.id} attribute={attribute} recordRef={recordRef} onSettled={refresh} />
        ))}
        {shown.length === 0 && <div className={s.noResults}>No attributes found</div>}
      </div>
    </section>
  );
}

/** Lists section (locked, D §2.3): the record's list entries (features/lists, slice 4). */
function ListsSection() {
  const { openDialog, recordRef } = useRecordPage();
  const { href } = useWorkspace();
  const navigate = useNavigate();
  return (
    <RecordListsSection
      recordRef={recordRef}
      onAdd={() => openDialog('choose-list')}
      onComment={(m) => void navigate({ href: href(`collection/${m.listId}/entry/${m.entryId}/comments`) })}
    />
  );
}
