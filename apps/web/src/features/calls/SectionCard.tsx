// A section card of the template editor (I calls §4.2): a single-line rich-text title, the ⋮ section menu (Move Up, Move
// Down, Duplicate, Delete), a divider, the multi-line rich-text prompt and the Format chip (List / Text). Title and prompt
// are collaborative documents (`insight-section`) synced through the collab server while the section is in a draft.
import { type EditorHandle, RichTextEditor } from '@agentic-crm/editor';
import { Icon, IconButton, Menu, MenuItem, MenuSeparator, MenuTrigger } from '@agentic-crm/ui';
import { useCallback, useMemo, useRef } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { collabUrl } from '../notes/editor/BodyEditor';
import { useWorkspace } from '../shell/workspaceContext';
import type { TemplateSection } from './data';
import * as s from './templates.css';

/** Rich-text editors of the sections by document id (for "Go to first issue" and Enter from a title to its prompt). */
export type EditorHandles = Map<string, EditorHandle>;

function SectionEditor({
  documentId,
  placeholder,
  className,
  readOnly,
  singleLine,
  handles,
  onEnter,
  testId,
}: {
  documentId: string;
  placeholder: string;
  className: string;
  readOnly: boolean;
  singleLine?: boolean;
  handles: EditorHandles;
  onEnter?: () => void;
  testId: string;
}) {
  const { me, workspace } = useWorkspace();
  const user = useMemo(
    () => ({ id: me.user.id, memberId: workspace.membership.id, name: me.user.name || me.user.email }),
    [me.user.id, me.user.name, me.user.email, workspace.membership.id],
  );
  const url = useMemo(() => collabUrl(), []);
  const bound = useRef(false);
  const ready = useCallback(
    (handle: EditorHandle) => {
      handles.set(documentId, handle);
      if (singleLine && !bound.current) {
        bound.current = true;
        handle.editor.view.dom.addEventListener(
          'keydown',
          (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              e.stopPropagation();
              onEnter?.();
            }
          },
          true,
        );
      }
    },
    [documentId, handles, singleLine, onEnter],
  );
  return (
    <div className={className} data-testid={testId} data-document-id={documentId}>
      <RichTextEditor
        documentId={documentId}
        docType="insight-section"
        collabUrl={url}
        user={user}
        readOnly={readOnly}
        placeholder={placeholder}
        onReady={ready}
      />
    </div>
  );
}

export function SectionCard({
  section,
  index,
  count,
  readOnly,
  handles,
  dragging,
  onMove,
  onDuplicate,
  onDelete,
  onFormat,
  onDragStart,
  cardRef,
}: {
  section: TemplateSection;
  index: number;
  count: number;
  readOnly: boolean;
  handles: EditorHandles;
  dragging: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onFormat: (type: 'plaintext' | 'list') => void;
  onDragStart: (e: React.PointerEvent) => void;
  cardRef: (node: HTMLDivElement | null) => void;
}) {
  const focusPrompt = useCallback(
    () => handles.get(section.promptDocumentId)?.focus('start'),
    [handles, section.promptDocumentId],
  );
  return (
    <div
      ref={cardRef}
      className={s.sectionCard}
      style={dragging ? { opacity: 0.5 } : undefined}
      data-testid="section-card"
      data-section-id={section.id}
    >
      {!readOnly && (
        <span
          className={s.dragHandle}
          role="button"
          tabIndex={-1}
          aria-label="Drag to reorder"
          data-testid="section-drag"
          onPointerDown={onDragStart}
        >
          <Icon icon="drag" size={16} />
        </span>
      )}
      <div className={s.sectionTop}>
        <SectionEditor
          documentId={section.titleDocumentId}
          placeholder="Untitled section"
          className={`${s.sectionTitle} ${s.richTitle}`}
          readOnly={readOnly}
          singleLine
          handles={handles}
          onEnter={focusPrompt}
          testId="section-title"
        />
        {!readOnly && (
          <MenuTrigger>
            <IconButton icon="moreVertical" size={20} aria-label="Open section menu" data-testid="section-menu" />
            <Menu
              aria-label="Section menu"
              placement="bottom end"
              width={192}
              onAction={(key) => {
                if (key === 'up') onMove('up');
                else if (key === 'down') onMove('down');
                else if (key === 'duplicate') onDuplicate();
                else if (key === 'delete') onDelete();
              }}
            >
              {index > 0 && (
                <MenuItem id="up" icon="arrowUp">
                  Move Up
                </MenuItem>
              )}
              {index < count - 1 && (
                <MenuItem id="down" icon="arrowDown">
                  Move Down
                </MenuItem>
              )}
              <MenuItem id="duplicate" icon="copy">
                Duplicate
              </MenuItem>
              <MenuSeparator />
              <MenuItem id="delete" icon="delete" variant="danger">
                Delete
              </MenuItem>
            </Menu>
          </MenuTrigger>
        )}
      </div>
      <hr className={s.sectionRule} />
      <SectionEditor
        documentId={section.promptDocumentId}
        placeholder="Describe the insights this section should capture"
        className={`${s.sectionPrompt} ${s.richPrompt}`}
        readOnly={readOnly}
        handles={handles}
        testId="section-prompt"
      />
      <div className={s.sectionFooter}>
        Format
        {readOnly ? (
          <span className={s.formatButton}>
            <Icon icon={section.type === 'list' ? 'formatList' : 'formatText'} size={12} />
            {section.type === 'list' ? 'List' : 'Text'}
          </span>
        ) : (
          <MenuTrigger>
            <AriaButton className={s.formatButton} data-testid="section-format" aria-label="Format">
              <Icon icon={section.type === 'list' ? 'formatList' : 'formatText'} size={12} />
              {section.type === 'list' ? 'List' : 'Text'}
              <Icon icon="chevronDown" size={12} />
            </AriaButton>
            <Menu
              aria-label="Format"
              placement="bottom start"
              width={220}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[section.type]}
              onSelectionChange={(keys) => {
                const next = [...(keys as Set<string>)][0];
                if ((next === 'list' || next === 'plaintext') && next !== section.type) onFormat(next);
              }}
            >
              <MenuItem id="list" icon="formatList">
                List
              </MenuItem>
              <MenuItem id="plaintext" icon="formatText">
                Text
              </MenuItem>
            </Menu>
          </MenuTrigger>
        )}
      </div>
    </div>
  );
}
