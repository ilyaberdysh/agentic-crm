// The variable menu and "Variable settings" popover (F composer §2.6, evidence/F/composer-variable-menu.png and
// composer-variable-fallback.png): one item per attribute of the recipient object with its type icon, a grey count and
// a chevron when it drills in place ("‹ Back" + attribute name), and the chip popover with the fallback input,
// "Change variable" and the trash button.
import type { AttributeDefinition } from '@agentic-crm/contracts';
import type { VariableClick, VariableInput, VariableMenuRequest } from '@agentic-crm/editor';
import { Icon, IconButton, MenuItem, MenuList, PopoverPanel } from '@agentic-crm/ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { createPortal } from 'react-dom';
import { attributesQuery } from '../attributes/data/queries';
import { useWs } from '../mailboxes/data';
import { attributeIcon } from '../settings/objects/attributes/typeCatalog';
import * as s from './variableMenu.css';
import {
  choiceOf,
  drillOf,
  fallbackExample,
  menuAttributes,
  type PathStep,
  type SubField,
  type VariableChoice,
} from './variables';

// ---- anchoring ---------------------------------------------------------------------------------------------------

export type Anchor = { rect: () => DOMRect } | { element: HTMLElement };

/** A trigger ref for a popover anchored at a caret rectangle or a DOM element (the chip). */
function useAnchor(anchor: Anchor): { ref: RefObject<HTMLElement | null>; point: React.ReactNode } {
  const pointRef = useRef<HTMLDivElement | null>(null);
  const elementRef = useRef<HTMLElement | null>('element' in anchor ? anchor.element : null);
  elementRef.current = 'element' in anchor ? anchor.element : null;
  const [box, setBox] = useState<DOMRect | null>(() => ('rect' in anchor ? anchor.rect() : null));
  useLayoutEffect(() => {
    if ('rect' in anchor) setBox(anchor.rect());
    // The anchor is fixed for the life of the menu.
  }, []);
  if ('element' in anchor) return { ref: elementRef, point: null };
  // Portalled to the body: a dialog frame with a backdrop filter is the containing block of fixed descendants.
  return {
    ref: pointRef,
    point: createPortal(
      <div
        ref={pointRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: box?.left ?? 0,
          top: box?.top ?? 0,
          width: 1,
          height: box?.height ?? 20,
          pointerEvents: 'none',
        }}
      />,
      document.body,
    ),
  };
}

// ---- menu --------------------------------------------------------------------------------------------------------

interface Trail {
  step: PathStep;
  title: string;
}

type Level =
  | { kind: 'attributes'; definitionId: string; trail: Trail[]; title: string | null }
  | { kind: 'fields'; attribute: AttributeDefinition; fields: SubField[]; trail: Trail[] };

export interface VariableMenuProps {
  /** The recipient object (people). */
  definitionId: string;
  anchor: Anchor;
  onPick: (choice: VariableChoice) => void;
  onClose: () => void;
}

export function VariableMenu({ definitionId, anchor, onPick, onClose }: VariableMenuProps) {
  const ws = useWs();
  const { ref, point } = useAnchor(anchor);
  const [stack, setStack] = useState<Level[]>([{ kind: 'attributes', definitionId, trail: [], title: null }]);
  const level = stack[stack.length - 1] as Level;
  const attributes = useQuery({
    ...attributesQuery(ws, level.kind === 'attributes' ? level.definitionId : definitionId),
    enabled: level.kind === 'attributes',
  });
  const rows = useMemo(
    () => (level.kind === 'attributes' && attributes.data ? menuAttributes(attributes.data) : []),
    [level, attributes.data],
  );
  const depth = level.trail.length;
  // Counts of relationship rows: the number of attributes of the related object.
  const related = useQueries({
    queries: rows.map((a) => {
      const drill = drillOf(a, depth);
      return {
        ...attributesQuery(ws, drill?.kind === 'relation' ? drill.definitionId : ''),
        enabled: drill?.kind === 'relation',
        select: (list: AttributeDefinition[]) => menuAttributes(list).length,
      };
    }),
  });

  const back = () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));

  const choose = (attribute: AttributeDefinition, field: SubField | null, trail: Trail[]) =>
    onPick(choiceOf(trail, attribute, field));

  const onAttribute = (attribute: AttributeDefinition, index: number) => {
    if (level.kind !== 'attributes') return;
    const drill = drillOf(attribute, depth);
    const here: Trail = {
      step: { entityDefinitionId: attribute.entityDefinitionId, attributeDefinitionId: attribute.id },
      title: attribute.title,
    };
    if (!drill) return choose(attribute, null, level.trail);
    if (drill.kind === 'fields') {
      return setStack([...stack, { kind: 'fields', attribute, fields: drill.fields, trail: level.trail }]);
    }
    void index;
    setStack([
      ...stack,
      { kind: 'attributes', definitionId: drill.definitionId, trail: [...level.trail, here], title: attribute.title },
    ]);
  };

  return (
    <>
      {point}
      <PopoverPanel
        triggerRef={ref}
        isOpen
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        placement="bottom start"
        width={274}
        padding={4}
        maxHeight={378}
        offset={0}
      >
        <div
          className={s.menu}
          role="dialog"
          aria-label="Variables"
          data-testid="variable-menu"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' && stack.length > 1) {
              e.preventDefault();
              back();
            }
          }}
        >
          {stack.length > 1 && (
            <AriaButton className={s.back} onPress={back} data-testid="variable-menu-back">
              <Icon icon="chevronLeft" size={16} />
              <span>Back</span>
              <span className={s.backTitle}>
                {level.kind === 'fields' ? level.attribute.title : (level.title ?? '')}
              </span>
            </AriaButton>
          )}
          <MenuList aria-label="Variables" autoFocus="first">
            {level.kind === 'fields'
              ? level.fields.map((f) => (
                  <MenuItem
                    key={f.field ?? 'value'}
                    id={f.field ?? 'value'}
                    icon={attributeIcon(level.attribute)}
                    onAction={() => choose(level.attribute, f, level.trail)}
                  >
                    {f.title}
                  </MenuItem>
                ))
              : rows.map((a, i) => {
                  const drill = drillOf(a, depth);
                  const count =
                    drill?.kind === 'fields'
                      ? drill.fields.length
                      : drill?.kind === 'relation'
                        ? related[i]?.data
                        : null;
                  return (
                    <MenuItem
                      key={a.id}
                      id={a.id}
                      icon={attributeIcon(a)}
                      textValue={a.title}
                      onAction={() => onAttribute(a, i)}
                      trailing={
                        drill ? (
                          <>
                            {count !== null && count !== undefined && <span className={s.count}>{count}</span>}
                            <Icon icon="chevronRight" size={16} />
                          </>
                        ) : undefined
                      }
                    >
                      {a.title}
                    </MenuItem>
                  );
                })}
          </MenuList>
        </div>
      </PopoverPanel>
    </>
  );
}

// ---- chip settings ------------------------------------------------------------------------------------------------

export interface VariableSettingsProps {
  click: VariableClick;
  onFallback: (fallback: string | null) => void;
  onChangeVariable: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** The attribute a chip points at (last path step), for the fallback input's icon and example. */
function useChipAttribute(click: VariableClick): AttributeDefinition | null {
  const ws = useWs();
  const path = useMemo(() => JSON.parse(click.attrs.path || '[]') as PathStep[], [click.attrs.path]);
  const last = path[path.length - 1];
  const list = useQuery({
    ...attributesQuery(ws, last?.entityDefinitionId ?? ''),
    enabled: Boolean(last?.entityDefinitionId),
  });
  return (
    list.data?.find((a) => a.id === last?.attributeDefinitionId || a.apiSlug === last?.attributeDefinitionId) ?? null
  );
}

export function VariableSettings({ click, onFallback, onChangeVariable, onDelete, onClose }: VariableSettingsProps) {
  const attribute = useChipAttribute(click);
  const [value, setValue] = useState(click.attrs.fallback ?? '');
  const input = useRef<HTMLInputElement>(null);
  const committed = useRef(false);
  useEffect(() => input.current?.focus(), []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const next = value.trim() === '' ? null : value;
    if (next !== (click.attrs.fallback ?? null)) onFallback(next);
  };

  return (
    <PopoverPanel
      triggerRef={{ current: click.element }}
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          commit();
          onClose();
        }
      }}
      placement="bottom start"
      width={320}
      padding={0}
      offset={6}
    >
      <div className={s.settings} role="dialog" aria-label="Variable settings" data-testid="variable-settings">
        <div className={s.settingsTitle}>Variable settings</div>
        <div className={s.settingsBody}>
          <label className={s.fallbackLabel} htmlFor="variable-fallback">
            Fallback
          </label>
          <div className={s.fallbackField}>
            <Icon icon={attribute ? attributeIcon(attribute) : 'attrText'} size={16} className={s.fallbackIcon} />
            <input
              id="variable-fallback"
              ref={input}
              className={s.fallbackInput}
              value={value}
              placeholder={fallbackExample(attribute, click.attrs.field)}
              data-testid="variable-fallback"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                  onClose();
                }
              }}
            />
          </div>
        </div>
        <div className={s.settingsFooter}>
          <AriaButton
            className={s.changeButton}
            onPress={() => {
              commit();
              onChangeVariable();
            }}
            data-testid="variable-change"
          >
            <Icon icon="repeat" size={16} />
            Change variable
          </AriaButton>
          <IconButton
            icon="delete"
            aria-label="Delete variable"
            tooltip="Delete variable"
            size={28}
            onPress={() => {
              committed.current = true;
              onDelete();
            }}
          />
        </div>
      </div>
    </PopoverPanel>
  );
}

/** Helpers shared with the window: the menu request and click as popover state. */
export type MenuState = { request: VariableMenuRequest; replacePos?: number } | null;
export type { VariableInput };
