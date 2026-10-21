// The kanban filter bar: Sort and Filter chips (views feature, drafts as on tables),
// "Discard / Save for everyone" when drafted, and at the far right two 2-segment toggles — "Collapse columns" /
// "Expand columns" and "Collapse cards" / "Expand cards" (both per browser).

import { Icon, Tooltip } from '@agentic-crm/ui';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { FilterBar, SaveViewBar, SortPopover, type ViewDraft } from '../views';
import * as v from '../views/views.css';
import { type Kanban, useKanbanContext } from './context';
import * as s from './kanban.css';

export function KanbanFilterBar({
  draft,
  onNavigate,
  canSave,
  kanban,
}: {
  draft: ViewDraft;
  onNavigate: (viewId: string) => void;
  canSave?: boolean;
  kanban?: Kanban;
}) {
  return (
    <div className={v.bar} data-testid="view-filter-sort-bar">
      <SortPopover draft={draft} />
      <span className={v.barDivider} aria-hidden />
      <FilterBar draft={draft} />
      <span className={v.barSpacer} />
      <SaveViewBar draft={draft} onNavigate={onNavigate} canSave={canSave} />
      <KanbanToggles kanban={kanban} />
    </div>
  );
}

export function KanbanToggles({ kanban: given }: { kanban?: Kanban }) {
  const provided = useKanbanContext();
  const kanban = given ?? provided;
  if (!kanban) return null;
  const { board, prefs } = kanban;
  const keys = board.columns.map((c) => c.key);
  const allCollapsed = keys.length > 0 && keys.every((k) => prefs.collapsed.has(k));
  return (
    <div className={s.toggles}>
      <ToggleButtonGroup
        aria-label="Columns"
        className={s.toggleGroup}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[allCollapsed ? 'collapse' : 'expand']}
        onSelectionChange={(sel) => prefs.setAllCollapsed([...sel][0] === 'collapse' ? keys : null)}
      >
        <Tooltip content="Collapse columns">
          <ToggleButton id="collapse" aria-label="Collapse columns" className={s.toggleButton}>
            <Icon icon="columnsCollapsed" size={14} />
          </ToggleButton>
        </Tooltip>
        <Tooltip content="Expand columns">
          <ToggleButton id="expand" aria-label="Expand columns" className={s.toggleButton}>
            <Icon icon="columnsExpanded" size={14} />
          </ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>
      <ToggleButtonGroup
        aria-label="Cards"
        className={s.toggleGroup}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[prefs.cardMode === 'collapsed' ? 'collapsed' : 'expanded']}
        onSelectionChange={(sel) => prefs.setCardMode([...sel][0] === 'collapsed' ? 'collapsed' : 'expanded')}
      >
        <Tooltip content="Collapse cards">
          <ToggleButton id="collapsed" aria-label="Collapse cards" className={s.toggleButton}>
            <Icon icon="cardsCollapsed" size={14} />
          </ToggleButton>
        </Tooltip>
        <Tooltip content="Expand cards">
          <ToggleButton id="expanded" aria-label="Expand cards" className={s.toggleButton}>
            <Icon icon="cardsExpanded" size={14} />
          </ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>
    </div>
  );
}
