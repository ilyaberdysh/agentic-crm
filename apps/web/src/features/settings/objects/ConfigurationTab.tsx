// Configuration tab (J objects-lists): General (plural/singular nouns
// with the icon button, slug read-only + pencil "Change slug"), Appearance (record image / text + preview; custom
// objects only), Record page layout, Danger zone (custom: delete; activatable standard: deactivate; system: none).
// Fields save on blur / Enter, one PATCH per field.
import type { AttributeDefinition, EntityDefinition } from '@agentic-crm/contracts';
import { AlertDialog, Button, Icon, IconButton, Select, SelectItem, TextInput, toast } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api, inWorkspace, type WorkspaceRef } from '../../../data/trpc';
import { getAttributeUi, useAttributeValues } from '../../attributes';
import { useWorkspace } from '../../shell/workspaceContext';
import { ChangeSlugDialog } from './ChangeSlugDialog';
import { archiveObject, updateObject, useAttributes, writeErrorOf } from './data';
import { IconPicker } from './IconPicker';
import { decodeObjectIcon, encodeObjectIcon, type ObjectIconValue, objectTile } from './objectIcon';
import * as s from './objects.css';
import { InfoTip, ObjectTile, SectionHeader } from './parts';

const isSystemObject = (o: EntityDefinition) => o.entityType === 'person-record' || o.entityType === 'company-record';

export function ConfigurationTab({ object, canEdit }: { object: EntityDefinition; canEdit: boolean }) {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const system = isSystemObject(object);
  const custom = object.entityType === 'custom-record';
  const [slugOpen, setSlugOpen] = useState(false);

  async function patch(field: 'pluralNoun' | 'singularNoun' | 'icon', value: string, label: string) {
    try {
      await updateObject(workspace, { entityDefinitionId: object.id, [field]: value });
    } catch (error) {
      toast.error({ title: `Failed to update ${label}`, description: writeErrorOf(error).message });
    }
  }

  return (
    <div className={s.sections}>
      <section className={s.section} aria-label="General">
        <SectionHeader title="General" description="Set words to describe single and multiple objects of this type" />
        <div className={s.fieldGrid}>
          <div className={s.nounRow}>
            <IconPicker
              value={decodeObjectIcon(object.icon) ?? (objectTile(object) as ObjectIconValue)}
              isDisabled={!canEdit || !custom}
              onChange={(v) => void patch('icon', encodeObjectIcon(v), 'icon')}
            />
            <AutosaveInput
              label="Plural noun"
              value={object.pluralNoun}
              isDisabled={!canEdit || system}
              onSave={(v) => patch('pluralNoun', v, 'plural noun')}
            />
          </div>
          <AutosaveInput
            label="Singular noun"
            value={object.singularNoun}
            isDisabled={!canEdit || system}
            onSave={(v) => patch('singularNoun', v, 'singular noun')}
          />
          <div className={`${s.fieldFull} ${s.slugRow}`}>
            <TextInput
              label={
                <span className={s.labelWithInfo}>
                  Slug
                  <InfoTip content="Slugs are used to identify your object in the URL" />
                </span>
              }
              size={32}
              isReadOnly
              inputClassName={s.readonlyText}
              isDisabled={!custom}
              value={object.apiSlug}
              prefix={<span className={s.slugPrefix}>/</span>}
              style={{ flex: 1 }}
            />
            {custom && canEdit && (
              <IconButton
                icon="edit"
                aria-label="Change slug"
                tooltip="Change slug"
                variant="secondary"
                size={32}
                onPress={() => setSlugOpen(true)}
              />
            )}
          </div>
          {!custom && (
            <p className={`${s.fieldFull} ${s.note}`}>
              {system
                ? "You can't change the slug of a system object"
                : "You can't change the slug of a standard object"}
            </p>
          )}
        </div>
      </section>

      {custom && <AppearanceSection object={object} workspace={workspace} canEdit={canEdit} />}

      {/* Part of the Appearance block on custom objects (24 px below the record label, not a new section). */}
      <section className={custom ? `${s.section} ${s.joinedSection}` : s.section} aria-label="Record page layout">
        <div className={s.settingRow}>
          <div>
            <h3 className={s.subTitle}>Record page layout</h3>
            <p className={s.subDescription}>Configure tabs, widgets, and layout for this object's record pages</p>
          </div>
          <Button
            variant="secondary"
            size={32}
            icon="edit"
            onPress={() => toast('Record page layouts arrive with the record page (slice 3)')}
          >
            Configure record page
          </Button>
        </div>
      </section>

      {canEdit && !system && (
        <DangerZone
          object={object}
          onDone={() => void navigate({ href: href('settings/data/objects') })}
          workspace={workspace}
        />
      )}

      <ChangeSlugDialog
        kind="object"
        currentSlug={object.apiSlug}
        isOpen={slugOpen}
        onOpenChange={setSlugOpen}
        onSave={async (slug) => {
          try {
            const next = await updateObject(workspace, { entityDefinitionId: object.id, apiSlug: slug });
            // The URL follows the new slug (J objects-lists).
            void navigate({ href: href(`settings/data/objects/${next.apiSlug}/general`), replace: true });
          } catch (error) {
            throw writeErrorOf(error);
          }
        }}
      />
    </div>
  );
}

/** Text input that saves on blur or Enter; Escape reverts. Empty values revert (nouns are required). */
function AutosaveInput({
  label,
  value,
  isDisabled,
  onSave,
}: {
  label: string;
  value: string;
  isDisabled?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (!next) {
      setDraft(value);
      return;
    }
    if (next !== value) void onSave(next);
  };
  return (
    <TextInput
      label={label}
      size={32}
      value={draft}
      onChange={setDraft}
      isDisabled={isDisabled}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={{ flex: 1 }}
    />
  );
}

/** Attributes that can label a record: text-like single values. */
function labelCandidates(attributes: readonly AttributeDefinition[]): AttributeDefinition[] {
  return attributes.filter(
    (a) => !a.isArchived && !a.isMultiselect && (a.type === 'text' || a.type === 'personal-name'),
  );
}

function AppearanceSection({
  object,
  workspace,
  canEdit,
}: {
  object: EntityDefinition;
  workspace: WorkspaceRef;
  canEdit: boolean;
}) {
  const attributes = useAttributes(workspace, object.id);
  const candidates = labelCandidates(attributes.data ?? []);
  const sample = useQuery({
    queryKey: ['ws', workspace.id, 'snapshot', object.id, 'settings-sample'],
    queryFn: () =>
      api.snapshots.query.query(
        { entityDefinitionId: object.id, initialRange: { start: 0, size: 1 } },
        inWorkspace(workspace),
      ),
    staleTime: 60_000,
  });
  const items = [{ id: 'none', title: 'None' }, ...candidates.map((a) => ({ id: a.id, title: a.title }))];
  const selected = (path: EntityDefinition['epithetPath']) => path?.[0]?.attributeDefinitionId ?? null;

  async function setPath(field: 'epithetPath' | 'imagePath', attributeId: string | null) {
    try {
      await updateObject(workspace, {
        entityDefinitionId: object.id,
        [field]: attributeId ? [{ entityDefinitionId: object.id, attributeDefinitionId: attributeId }] : null,
      });
    } catch (error) {
      toast.error({ title: 'Failed to update record label', description: writeErrorOf(error).message });
    }
  }

  const look = objectTile(object);
  return (
    <section className={s.section} aria-label="Appearance">
      <h2 className={s.sectionTitle}>Appearance</h2>
      <div className={s.appearanceGrid}>
        <div className={s.section}>
          <div>
            <h3 className={s.subTitle}>Record label</h3>
            <p className={s.subDescription}>Define the attributes used to identify records</p>
          </div>
          <Select<{ id: string; title: string }>
            label="Record image"
            placeholder="Choose an attribute..."
            items={items}
            searchable
            isDisabled={!canEdit}
            selectedKey={selected(object.imagePath)}
            onSelectionChange={(k) => void setPath('imagePath', k === 'none' ? null : String(k))}
          >
            {(item) => <SelectItem id={item.id}>{item.title}</SelectItem>}
          </Select>
          <Select<{ id: string; title: string }>
            label="Record text"
            placeholder="Choose an attribute..."
            items={items}
            searchable
            isDisabled={!canEdit}
            selectedKey={selected(object.epithetPath)}
            onSelectionChange={(k) => void setPath('epithetPath', k === 'none' ? null : String(k))}
          >
            {(item) => <SelectItem id={item.id}>{item.title}</SelectItem>}
          </Select>
        </div>
        <div className={s.previewCard} aria-label="Preview">
          <div className={s.previewInner}>
            <div className={s.previewLine}>
              <ObjectTile object={object} />
              {object.pluralNoun}
            </div>
            <div className={s.previewLine}>
              <Icon icon={look.icon} size={14} style={{ color: 'var(--ar-color-content-tertiary)' }} />
              <RecordLabelPreview
                object={object}
                attribute={(attributes.data ?? []).find((a) => a.id === selected(object.epithetPath))}
                recordId={sample.data?.ids[0]}
              />
            </div>
          </div>
          Preview
        </div>
      </div>
    </section>
  );
}

/** The sample record's label drawn by the attribute's own View (the same rendering as cells and fields). */
function RecordLabelPreview({
  object,
  attribute,
  recordId,
}: {
  object: EntityDefinition;
  attribute: AttributeDefinition | undefined;
  recordId: string | undefined;
}) {
  if (!attribute || !recordId) return <span className={s.cellText}>{recordId ?? 'Record'}</span>;
  return <AttributePreview object={object} attribute={attribute} recordId={recordId} />;
}

function AttributePreview({
  object,
  attribute,
  recordId,
}: {
  object: EntityDefinition;
  attribute: AttributeDefinition;
  recordId: string;
}) {
  const recordRef = { entityDefinitionId: object.id, entityInstanceId: recordId };
  const { values } = useAttributeValues(recordRef, attribute);
  const { View } = getAttributeUi(attribute.type);
  return (
    <span className={s.cellText}>
      {values.length > 0 ? (
        <View attribute={attribute} values={values} density="chip" recordRef={recordRef} />
      ) : (
        recordId
      )}
    </span>
  );
}

function DangerZone({
  object,
  workspace,
  onDone,
}: {
  object: EntityDefinition;
  workspace: WorkspaceRef;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const custom = object.entityType === 'custom-record';
  const name = object.pluralNoun;

  async function run() {
    const id = toast(custom ? `Deleting the ${name} object...` : `Deactivating the ${name}...`, {
      durationMs: Infinity,
    });
    try {
      await archiveObject(workspace, object.id);
      toast.dismiss(id);
      toast.success(custom ? `Successfully deleted the ${name} object` : `Successfully deactivated the ${name}`);
      onDone();
    } catch (error) {
      toast.dismiss(id);
      toast.error({
        title: custom
          ? `Something went wrong deleting the ${name} object`
          : `Something went wrong deactivating the ${name}`,
        description: writeErrorOf(error).message,
      });
    }
  }

  return (
    <section className={s.section} aria-label="Danger zone">
      <h2 className={s.sectionTitle}>Danger zone</h2>
      <div className={s.dangerCard}>
        <div>
          <h3 className={s.subTitle}>{custom ? 'Delete object' : 'Deactivate object'}</h3>
          <p className={s.subDescription}>
            {custom
              ? 'Once deleted, your object cannot be recovered.'
              : 'Associated lists will be permanently destroyed.'}
          </p>
        </div>
        <Button variant="destructive" size={28} icon="delete" onPress={() => setConfirming(true)}>
          {custom ? 'Delete object' : 'Deactivate object'}
        </Button>
      </div>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Are you sure?"
        description={
          custom
            ? 'Deleting this object deletes its records, data and views permanently and cannot be undone'
            : 'Deactivating this object hides its records, data and views. The associated lists will be permanently destroyed.'
        }
        confirmLabel={custom ? 'Delete object' : 'Deactivate object'}
        onConfirm={() => void run()}
      />
    </section>
  );
}
