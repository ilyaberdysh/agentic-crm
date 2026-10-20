// What every part of an open record page needs: the object, the record, its layout, the object's attributes and
// navigation between tabs (replace-navigation inside an overlay, D §2.7).
import type { AttributeDefinition, CustomLayout, EntityDefinition } from '@agentic-crm/contracts';
import { createContext, useContext } from 'react';
import type { ResolvedLayout } from './layout/model';

export interface RecordRef {
  entityDefinitionId: string;
  entityInstanceId: string;
}

/** Sequence context of the preview drawer opened from a view ("2 of 12 in {view}", ↑ / ↓). */
export interface RecordSequence {
  ids: string[];
  total: number;
  title: string;
  /** Where × / Esc return to (the originating view URL). */
  returnTo: string;
}

export type RecordDialog = 'edit' | 'merge' | 'delete' | 'choose-list' | null;

export interface RecordPageContextValue {
  object: EntityDefinition;
  recordRef: RecordRef;
  layout: ResolvedLayout;
  rawLayout: CustomLayout;
  /** Live (not archived) attributes of the object in attribute order. */
  attributes: AttributeDefinition[];
  /** The display-name attribute (epithet) when it is a single attribute of the object. */
  titleAttribute: AttributeDefinition | undefined;
  /** `/<ws>/company/<id>` etc. (no tab). */
  basePath: string;
  activeTab: string;
  goToTab: (slug: string) => void;
  /** Rendered inside the record overlay (features/overlays). */
  inOverlay: boolean;
  openDialog: (dialog: Exclude<RecordDialog, null>) => void;
}

export const RecordPageContext = createContext<RecordPageContextValue | null>(null);

export function useRecordPage(): RecordPageContextValue {
  const ctx = useContext(RecordPageContext);
  if (!ctx) throw new Error('useRecordPage must be used inside a record page');
  return ctx;
}
