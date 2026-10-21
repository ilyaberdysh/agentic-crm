// The index search: an icon-only button that expands to a "Search dashboards" field. Typing sets
// `?query=` (debounced; the route passes `onQueryChange`); Escape clears it and leaving the empty field collapses it.
import { IconButton, SearchField } from '@agentic-crm/ui';
import { useEffect, useRef, useState } from 'react';
import * as s from './dashboardsIndex.css';

const DEBOUNCE_MS = 150;

export function SearchToggle({ query, onQueryChange }: { query: string; onQueryChange: (query: string) => void }) {
  const [open, setOpen] = useState(query !== '');
  const [draft, setDraft] = useState(query);
  /** The last text this field sent up: a URL echo of it must not overwrite what was typed since. */
  const sent = useRef(query);

  // External changes (Clear search, back / forward, a shared link) replace the draft.
  useEffect(() => {
    if (query === sent.current) return;
    sent.current = query;
    setDraft(query);
    setOpen(query !== '');
  }, [query]);

  useEffect(() => {
    if (draft === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = draft;
      onQueryChange(draft);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, onQueryChange]);

  if (!open && draft === '') {
    return (
      <IconButton
        icon="search"
        variant="secondary"
        size={28}
        aria-label="Search dashboards"
        tooltip="Search"
        onPress={() => setOpen(true)}
        data-testid="dashboards-search-open"
      />
    );
  }
  return (
    <SearchField
      aria-label="Search dashboards"
      placeholder="Search dashboards"
      size={28}
      autoFocus={draft === ''}
      value={draft}
      onChange={setDraft}
      onClear={() => {
        sent.current = '';
        onQueryChange('');
        setDraft('');
      }}
      onBlur={() => {
        if (draft === '') setOpen(false);
      }}
      className={s.searchField}
    />
  );
}
