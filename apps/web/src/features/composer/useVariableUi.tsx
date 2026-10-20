// The variable popovers of an email editor pair (subject + body): the menu opened by `{` or "Add variable", and
// "Variable settings" opened by a chip. Shared by the composer, the template view and the template dialog.
import type { EmailEditorHandle, VariableClick, VariableHooks, VariableMenuRequest } from '@agentic-crm/editor';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useObjectDefinition } from '../attributes/data/queries';
import { VariableMenu, VariableSettings } from './VariableMenu';

export type EditorTarget = 'subject' | 'body';

interface MenuState {
  target: EditorTarget;
  request: VariableMenuRequest;
}
interface ChipState {
  target: EditorTarget;
  click: VariableClick;
}

export interface VariableUi {
  /** Props for the editor of `target`: `variables`, `onReady`, `onFocus`. */
  bind: (target: EditorTarget) => {
    variables: VariableHooks;
    onReady: (handle: EmailEditorHandle) => void;
    onFocus: () => void;
  };
  /** Footer "Add variable": types `{` in the editor that had the focus last (the body by default). */
  addVariable: () => void;
  handle: (target: EditorTarget) => EmailEditorHandle | null;
  popovers: ReactNode;
}

export function useVariableUi(): VariableUi {
  const people = useObjectDefinition('people');
  const handles = useRef<Record<EditorTarget, EmailEditorHandle | null>>({ subject: null, body: null });
  const last = useRef<EditorTarget>('body');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [chip, setChip] = useState<ChipState | null>(null);
  // While the menu is open the rest of the page is inert (modal popover), so the editor cannot take focus from the
  // pick / close handler itself. Give it back once the menu is gone — React flushes this effect before the click or
  // key event ends, so typing continues in the text instead of reaching the page's single-key shortcuts. The view's
  // own focus keeps the caret where it is (after an inserted variable).
  const refocusAfterMenu = useRef<EditorTarget | null>(null);
  useEffect(() => {
    if (menu || !refocusAfterMenu.current) return;
    const view = handles.current[refocusAfterMenu.current]?.editor.view;
    refocusAfterMenu.current = null;
    if (!view) return;
    let frames = 0;
    const attempt = () => {
      if (view.isDestroyed) return;
      view.focus();
      if (!view.hasFocus() && ++frames < 10) requestAnimationFrame(attempt);
    };
    attempt();
  }, [menu]);

  const bind = useCallback(
    (target: EditorTarget) => ({
      variables: {
        onOpenMenu: (request: VariableMenuRequest) => setMenu({ target, request }),
        onVariableClick: (click: VariableClick) => setChip({ target, click }),
      },
      onReady: (handle: EmailEditorHandle) => {
        handles.current[target] = handle;
      },
      onFocus: () => {
        last.current = target;
      },
    }),
    [],
  );

  const popovers = (
    <>
      {menu && people && (
        <VariableMenu
          definitionId={people.id}
          anchor={{ rect: menu.request.anchorRect }}
          onClose={() => {
            refocusAfterMenu.current = menu.target;
            setMenu(null);
          }}
          onPick={(choice) => {
            handles.current[menu.target]?.insertVariable(
              { path: choice.path, field: choice.field, fallback: null, label: choice.label },
              menu.request.replace,
            );
            refocusAfterMenu.current = menu.target;
            setMenu(null);
          }}
        />
      )}
      {chip && (
        <VariableSettings
          key={chip.click.pos}
          click={chip.click}
          onClose={() => setChip(null)}
          onFallback={(fallback) => handles.current[chip.target]?.updateVariable(chip.click.pos, { fallback })}
          onDelete={() => {
            handles.current[chip.target]?.deleteVariable(chip.click.pos);
            setChip(null);
          }}
          onChangeVariable={() => {
            const { pos, element } = chip.click;
            setMenu({
              target: chip.target,
              request: { replace: { from: pos, to: pos + 1 }, anchorRect: () => element.getBoundingClientRect() },
            });
            setChip(null);
          }}
        />
      )}
    </>
  );

  return {
    bind,
    addVariable: () => handles.current[last.current]?.openVariableMenu(),
    handle: (target) => handles.current[target],
    popovers,
  };
}
