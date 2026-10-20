// The sort/filter row of the object page (C1 README §2.1): [Sort pill] | [filter pills …] [+] … [Discard changes]
// [Save for everyone ⌄]. 48 px + 1 px rule; pills scroll horizontally when they overflow.
import type { ViewDraft } from '../useViewDraft';
import * as s from '../views.css';
import { FilterBar } from './FilterBar';
import { SaveViewBar } from './SaveViewBar';
import { SortPopover } from './SortPopover';

export interface ViewFilterSortBarProps {
  draft: ViewDraft;
  onNavigate: (viewId: string) => void;
  canSave?: boolean;
}

export function ViewFilterSortBar({ draft, onNavigate, canSave }: ViewFilterSortBarProps) {
  return (
    <div className={s.bar} data-testid="view-filter-sort-bar">
      <SortPopover draft={draft} />
      <span className={s.barDivider} aria-hidden />
      <FilterBar draft={draft} />
      <span className={s.barSpacer} />
      <SaveViewBar draft={draft} onNavigate={onNavigate} canSave={canSave} />
    </div>
  );
}
