// Unsaved filter/sort changes (C1 README §2.1, §3.1; evidence C1/17, 18): "Discard changes" (instant, no request) and
// a blue split button "Save for everyone" + ⌄ → "Save as new view" (modal with the de-duplicated title, Create view ↵).
// Renders nothing while the view has no unsaved changes.
import type { View } from '@agentic-crm/contracts';
import { Button, ButtonGroup, Menu, MenuItem, MenuTrigger } from '@agentic-crm/ui';
import { useState } from 'react';
import { dedupeTitle, useViews } from '../data';
import type { ViewDraft } from '../useViewDraft';
import { TitleDialog } from './dialogs';

export interface SaveViewBarProps {
  draft: ViewDraft;
  /** Navigate to the view created by "Save as new view". */
  onNavigate: (viewId: string) => void;
  /** Without `update_entity_view` only "Save as new view" is possible (and without create, nothing). */
  canSave?: boolean;
}

export function SaveViewBar({ draft, onNavigate, canSave = true }: SaveViewBarProps) {
  const [saveAs, setSaveAs] = useState(false);
  const [saving, setSaving] = useState(false);
  const views = useViews(draft.view.entityDefinitionId).data ?? [];
  if (!draft.isDirty && !saveAs) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }} data-testid="save-view-bar">
      {draft.isDirty && (
        <>
          <Button variant="ghost" size={28} onPress={() => draft.discard()}>
            Discard changes
          </Button>
          <ButtonGroup aria-label="Save view">
            <Button
              size={28}
              isPending={saving}
              isDisabled={!canSave}
              onPress={async () => {
                setSaving(true);
                try {
                  await draft.saveForEveryone();
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save for everyone
            </Button>
            <MenuTrigger>
              <Button size={28} icon="chevronDown" aria-label="More save options" />
              <Menu
                aria-label="More save options"
                placement="bottom end"
                onAction={(key) => key === 'save-as' && setSaveAs(true)}
              >
                <MenuItem id="save-as" icon="add">
                  Save as new view
                </MenuItem>
              </Menu>
            </MenuTrigger>
          </ButtonGroup>
        </>
      )}
      <TitleDialog
        isOpen={saveAs}
        onOpenChange={setSaveAs}
        heading="Save as new view"
        label="Title"
        initialTitle={dedupeTitle(
          draft.view.title,
          views.map((v: View) => v.title),
        )}
        submitLabel="Create view"
        onSubmit={async (title) => {
          const created = await draft.saveAsNew(title);
          onNavigate(created.id);
        }}
      />
    </div>
  );
}
