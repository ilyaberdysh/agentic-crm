// "Create object" (J objects-lists §2; raw J s02-dialog, s04-empty-submit, s04-dup-slug): 808 px modal over a dimmed
// page. Plural noun (with the icon picker; autofocused) · Singular noun · Slug ("/" prefix; auto-filled from the
// plural noun until edited) · Workspace access. Client validation on submit; 409 → "The slug "…" is already in use".
// Success navigates to the new object's Configuration tab.
import { Banner, DialogBody, DialogFooter, DialogHeader, Modal, Select, SelectItem, TextInput } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import type { WorkspaceRef } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { createObject, writeErrorOf } from './data';
import { IconPicker } from './IconPicker';
import { encodeObjectIcon, type ObjectIconValue, randomObjectIcon } from './objectIcon';
import { type CreateObjectErrors, slugFromNoun, validateCreateObject } from './objectSlug';
import * as s from './objects.css';
import { DialogActions, InfoTip, submitOnModEnter } from './parts';

type Access = 'full-access' | 'read-write' | 'read-only';

const ACCESS_OPTIONS: Array<{ id: Access; label: string }> = [
  { id: 'full-access', label: 'Full access' },
  { id: 'read-write', label: 'Read and write' },
  { id: 'read-only', label: 'Read only' },
];

export function CreateObjectDialog({
  workspace,
  isOpen,
  onOpenChange,
  objectsHref,
}: {
  workspace: WorkspaceRef;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** `/<slug>/settings/data/objects` */
  objectsHref: string;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="large" overlay aria-label="Create object">
      {/* The overlay unmounts when closed, so every opening starts with a fresh form (and a new random icon). */}
      <CreateObjectForm workspace={workspace} objectsHref={objectsHref} onClose={() => onOpenChange(false)} />
    </Modal>
  );
}

function CreateObjectForm({
  workspace,
  objectsHref,
  onClose,
}: {
  workspace: WorkspaceRef;
  objectsHref: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [icon, setIcon] = useState<ObjectIconValue>(() => randomObjectIcon());
  const [pluralNoun, setPluralNoun] = useState('');
  const [singularNoun, setSingularNoun] = useState('');
  const [apiSlug, setApiSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [access, setAccess] = useState<Access>('read-write');
  const [errors, setErrors] = useState<CreateObjectErrors>({});
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const id = useRef(newId());

  async function submit() {
    if (pending) return;
    const draft = { pluralNoun, singularNoun, apiSlug };
    const found = validateCreateObject(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    setFormError(null);
    try {
      const object = await createObject(workspace, {
        id: id.current,
        apiSlug: apiSlug.trim(),
        pluralNoun: pluralNoun.trim(),
        singularNoun: singularNoun.trim(),
        icon: encodeObjectIcon(icon),
      });
      onClose();
      void navigate({ href: `${objectsHref}/${object.apiSlug}/general` });
    } catch (error) {
      const e = writeErrorOf(error);
      if (e.code === 'OVER_USAGE_LIMIT') {
        setFormError("You have met your plan's object limit.");
      } else if (e.code === 'SLUG_IN_USE' || (e.status === 409 && !e.code)) {
        setErrors({ apiSlug: `The slug "${apiSlug.trim()}" is already in use` });
      } else if (e.code === 'RESERVED_SLUG' || e.code === 'RESERVED_API_SLUG') {
        setErrors({ apiSlug: `The slug "${apiSlug.trim()}" is reserved and can't be used` });
      } else {
        setFormError(e.message ? `Failed to create object. ${e.message}` : 'Failed to create object.');
      }
      setPending(false);
    }
  }

  return (
    <div onKeyDown={submitOnModEnter(() => void submit())} style={{ display: 'contents' }}>
      <DialogHeader title="Create object" onClose={onClose} />
      <DialogBody className={s.dialogBody}>
        {formError && <Banner variant="error" title={formError} />}
        <div>
          <h3 className={s.dialogSectionTitle}>Details</h3>
          <p className={s.dialogSectionDescription}>
            Configure your object settings. You can always edit these settings later.
          </p>
        </div>
        <div className={s.fieldGrid}>
          <div className={s.nounRow}>
            <IconPicker value={icon} onChange={setIcon} />
            <TextInput
              label="Plural noun"
              size={34}
              placeholder="e.g. Products"
              autoFocus
              value={pluralNoun}
              onChange={(v) => {
                setPluralNoun(v);
                if (!slugTouched) setApiSlug(slugFromNoun(v));
              }}
              isInvalid={Boolean(errors.pluralNoun)}
              errorMessage={errors.pluralNoun}
              style={{ flex: 1 }}
            />
          </div>
          <TextInput
            label="Singular noun"
            size={34}
            placeholder="e.g. Product"
            value={singularNoun}
            onChange={setSingularNoun}
            isInvalid={Boolean(errors.singularNoun)}
            errorMessage={errors.singularNoun}
          />
          <TextInput
            className={s.fieldFull}
            label={
              <span className={s.labelWithInfo}>
                Slug
                <InfoTip content="Slugs are used to identify your object in the URL and must only include lowercase letters, numbers, and underscores" />
              </span>
            }
            size={34}
            placeholder="e.g. products"
            prefix={<span className={s.slugPrefix}>/</span>}
            value={apiSlug}
            onChange={(v) => {
              setApiSlug(v);
              setSlugTouched(true);
            }}
            isInvalid={Boolean(errors.apiSlug)}
            errorMessage={errors.apiSlug}
          />
          <Select<{ id: Access; label: string }>
            className={s.fieldFull}
            label="Workspace access"
            items={ACCESS_OPTIONS}
            selectedKey={access}
            onSelectionChange={(k) => setAccess(k as Access)}
          >
            {(item) => <SelectItem id={item.id}>{item.label}</SelectItem>}
          </Select>
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogActions
          onCancel={onClose}
          onSubmit={() => void submit()}
          submitLabel={pending ? 'Creating...' : 'Create object'}
          isPending={pending}
        />
      </DialogFooter>
    </div>
  );
}
