// What the editor's side panel and inputs share: the shown version (the draft, or a past version read-only), the edit
// actions, the panel state and canvas callbacks (select a block, open the palette, highlight a block while a variable
// is hovered in the picker).
import type { Position } from '@agentic-crm/contracts';
import { createContext, useContext } from 'react';
import type { WorkflowVersion } from '../types';
import type { WorkflowPage } from './WorkflowLayout';

export type PanelState =
  | { kind: 'overview' }
  | { kind: 'versions' }
  | { kind: 'block'; blockId: string }
  | { kind: 'palette'; purpose: 'add' }
  | { kind: 'palette'; purpose: 'next'; from: { blockId: string; outcome: string }; position: Position }
  | { kind: 'palette'; purpose: 'replace'; blockId: string; blockType: 'trigger' | 'step' };

export interface EditorUi {
  page: WorkflowPage;
  version: WorkflowVersion;
  /** Old version, missing permission or the run viewer. */
  readOnly: boolean;
  /** Version id when a past version is open, else null. */
  viewingVersionId: string | null;
  panel: PanelState;
  setPanel: (panel: PanelState) => void;
  selectBlock: (blockId: string | null) => void;
  setHighlight: (blockId: string | null) => void;
  /** Title of any block of the shown version (variable chips of blocks the picker does not list). */
  blockTitle: (blockId: string) => string | null;
  viewVersion: (versionId: string | null) => void;
  /** A publish was refused: "This input is required." shows under empty required inputs too. */
  showRequired?: boolean;
}

const Ctx = createContext<EditorUi | null>(null);
export const EditorUiProvider = Ctx.Provider;

export function useEditorUi(): EditorUi {
  const ui = useContext(Ctx);
  if (!ui) throw new Error('useEditorUi outside the editor');
  return ui;
}
