// "Start with a view" (C1 README §2.2, evidence C1/01): shown when an object has no views. Two cards open the
// "Create view" dialog with the type preselected; no toolbar or table is rendered in this state.
import type { EntityDefinition, View } from '@agentic-crm/contracts';
import { Icon } from '@agentic-crm/ui';
import { type ReactNode, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import * as s from '../views.css';
import { CreateViewDialog } from './dialogs';

export interface StartWithAViewProps {
  object: Pick<EntityDefinition, 'id' | 'pluralNoun'>;
  onCreated: (view: View) => void;
  /** No `create_entity_view` permission. */
  canCreate?: boolean;
  onCreateStatusAttribute?: () => void;
  /** Below the cards (lists: "or" + "Delete list", C2 README §2.3). */
  extra?: ReactNode;
  /** "Learn more" right below the content instead of at the bottom (lists, evidence/C2/list-no-views.png). */
  learnMoreInline?: boolean;
}

export function StartWithAView({
  object,
  onCreated,
  canCreate = true,
  onCreateStatusAttribute,
  extra,
  learnMoreInline = false,
}: StartWithAViewProps) {
  const [type, setType] = useState<View['type'] | null>(null);
  return (
    <div className={s.start} data-testid="start-with-a-view">
      <div className={s.startInner}>
        <h2 className={s.startTitle}>Start with a view</h2>
        <p className={s.startText}>Organize and visualize your data to highlight what’s important</p>
        {canCreate ? (
          <div className={s.startCards}>
            <AriaButton className={s.startCard} onPress={() => setType('table')}>
              <span className={s.startCardTile}>
                <Icon icon="table" size={16} />
              </span>
              <span className={s.startCardTitle}>Table</span>
              <span className={s.startCardText}>
                Organize your {object.pluralNoun} in a table view and create a unique filter set to show only relevant{' '}
                {object.pluralNoun}.
              </span>
            </AriaButton>
            <AriaButton className={s.startCard} onPress={() => setType('kanban')}>
              <span className={s.startCardTile}>
                <Icon icon="kanban" size={16} />
              </span>
              <span className={s.startCardTitle}>Kanban</span>
              <span className={s.startCardText}>
                Visualize your pipeline in a kanban view and create a unique filter set to show only relevant{' '}
                {object.pluralNoun}.
              </span>
            </AriaButton>
          </div>
        ) : (
          <p className={s.startCardText}>You don't have permission to create views here.</p>
        )}
        {extra}
      </div>
      <div className={s.learnMore} style={learnMoreInline ? { marginTop: 0, paddingTop: 12 } : undefined}>
        <div className={s.learnMoreLabel}>Learn more</div>
        <div className={s.learnCards}>
          <span className={s.learnCard}>
            <span className={s.learnCardTile}>
              <Icon icon="learn" size={20} />
            </span>
            Create and manage kanban views
          </span>
          <span className={s.learnCard}>
            <span className={s.learnCardTile}>
              <Icon icon="learn" size={20} />
            </span>
            Create and manage table views
          </span>
        </div>
      </div>
      <CreateViewDialog
        entityDefinitionId={object.id}
        isOpen={type !== null}
        onOpenChange={(open) => !open && setType(null)}
        initialType={type ?? 'table'}
        onCreated={onCreated}
        onCreateStatusAttribute={onCreateStatusAttribute}
      />
    </div>
  );
}
