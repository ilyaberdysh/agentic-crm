// Per-browser board preferences: collapsed columns, card display mode and "Hide empty
// attributes" live in localStorage only (no request), synced across tabs.
import { useCallback, useMemo } from 'react';
import { usePersistentState } from '../../lib/storage';
import { cardDisplayModeKey, collapsedColumnsKey, hideEmptyFieldsKey } from './config';
import type { StageKey } from './model';

export type CardDisplayMode = 'expanded' | 'collapsed';

export interface BoardPrefs {
  collapsed: ReadonlySet<StageKey>;
  isCollapsed(key: StageKey): boolean;
  setCollapsed(key: StageKey, collapsed: boolean): void;
  /** Board-level "Collapse columns" (every visible column) / "Expand columns" (none). */
  setAllCollapsed(keys: readonly StageKey[] | null): void;
  cardMode: CardDisplayMode;
  setCardMode(mode: CardDisplayMode): void;
  hideEmpty: boolean;
  setHideEmpty(hide: boolean): void;
}

export function useBoardPrefs(workspaceId: string, viewId: string): BoardPrefs {
  const [collapsedList, setCollapsedList] = usePersistentState<StageKey[]>(collapsedColumnsKey(viewId), []);
  const [cardMode, setCardModeRaw] = usePersistentState<CardDisplayMode>(
    cardDisplayModeKey(workspaceId, viewId),
    'expanded',
  );
  const [hideEmpty, setHideEmptyRaw] = usePersistentState<boolean>(hideEmptyFieldsKey(workspaceId, viewId), false);
  const collapsed = useMemo(() => new Set(Array.isArray(collapsedList) ? collapsedList : []), [collapsedList]);
  const setCollapsed = useCallback(
    (key: StageKey, on: boolean) =>
      setCollapsedList((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        if (on) return list.includes(key) ? list : [...list, key];
        return list.filter((k) => k !== key);
      }),
    [setCollapsedList],
  );
  const setAllCollapsed = useCallback(
    (keys: readonly StageKey[] | null) => setCollapsedList(keys ? [...keys] : []),
    [setCollapsedList],
  );
  return useMemo<BoardPrefs>(
    () => ({
      collapsed,
      isCollapsed: (key) => collapsed.has(key),
      setCollapsed,
      setAllCollapsed,
      cardMode: cardMode === 'collapsed' ? 'collapsed' : 'expanded',
      setCardMode: setCardModeRaw,
      hideEmpty: hideEmpty === true,
      setHideEmpty: setHideEmptyRaw,
    }),
    [collapsed, setCollapsed, setAllCollapsed, cardMode, setCardModeRaw, hideEmpty, setHideEmptyRaw],
  );
}
