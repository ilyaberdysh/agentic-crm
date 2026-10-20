// "Change slug" (J objects-lists §3.1, attribute-dialogs §7; raw J s06-change-slug, s07-error, s08-dup-after-confirm):
// a small dialog with the slug input, a client format check, then the type-to-confirm alert ("Integrations using
// "<old>" may be affected"; Update disabled until the text matches). A 409 comes back into the slug dialog.
import { Button, DialogBody, DialogFooter, DialogHeader, Modal, TextInput, useThemeClassName } from '@agentic-crm/ui';
import { useState } from 'react';
import { Heading, ModalOverlay, Dialog as RACDialog, Modal as RACModal } from 'react-aria-components';
import type { WriteError } from './data';
import { isValidApiSlug, SLUG_FORMAT_ERROR, slugConfirmationPhrase } from './objectSlug';
import * as s from './objects.css';
import { DialogActions, submitOnModEnter } from './parts';
import * as a from './slugDialog.css';

export function ChangeSlugDialog({
  kind,
  currentSlug,
  isOpen,
  onOpenChange,
  onSave,
}: {
  kind: 'object' | 'attribute';
  currentSlug: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Throws a WriteError on failure. */
  onSave: (slug: string) => Promise<void>;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size={488} overlay alignment="center" aria-label="Change slug">
      <ChangeSlugForm kind={kind} currentSlug={currentSlug} onClose={() => onOpenChange(false)} onSave={onSave} />
    </Modal>
  );
}

function ChangeSlugForm({
  kind,
  currentSlug,
  onClose,
  onSave,
}: {
  kind: 'object' | 'attribute';
  currentSlug: string;
  onClose: () => void;
  onSave: (slug: string) => Promise<void>;
}) {
  const [slug, setSlug] = useState(currentSlug);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const help =
    kind === 'object'
      ? 'Slugs are used to identify your object in URLs and the API.'
      : 'Slugs are used to identify your attribute in the API.';

  function save() {
    const next = slug.trim();
    if (!isValidApiSlug(next)) {
      setError(SLUG_FORMAT_ERROR);
      return;
    }
    if (next === currentSlug) {
      onClose();
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function confirm() {
    try {
      await onSave(slug.trim());
      setConfirming(false);
      onClose();
    } catch (err) {
      const e = err as WriteError;
      setConfirming(false);
      setError(
        e.status === 409 || e.code === 'SLUG_IN_USE'
          ? `This slug is already in use by another ${kind}.`
          : e.code === 'RESERVED_API_SLUG'
            ? (e.message ?? SLUG_FORMAT_ERROR)
            : (e.message ?? 'Failed to update slug'),
      );
    }
  }

  return (
    <div onKeyDown={submitOnModEnter(save)} style={{ display: 'contents' }}>
      <DialogHeader title="Change slug" onClose={onClose} />
      <DialogBody className={s.dialogBody}>
        <TextInput
          label="Slug"
          size={32}
          placeholder="Slug..."
          autoFocus
          value={slug}
          onChange={(v) => {
            setSlug(v);
            setError(null);
          }}
          isInvalid={Boolean(error)}
          errorMessage={error ?? undefined}
          description={error ? undefined : help}
        />
      </DialogBody>
      <DialogFooter>
        <DialogActions onCancel={onClose} onSubmit={save} submitLabel="Save" />
      </DialogFooter>
      <ConfirmPhraseDialog
        isOpen={confirming}
        title="Are you sure you want to change this slug?"
        description="Changing the slug can break links and API integrations that reference the current slug. To continue please type:"
        phrase={slugConfirmationPhrase(currentSlug)}
        confirmLabel="Update"
        onCancel={() => setConfirming(false)}
        onConfirm={confirm}
      />
    </div>
  );
}

/** Alert with a type-to-confirm input; the action stays disabled until the phrase matches. */
export function ConfirmPhraseDialog({
  isOpen,
  title,
  description,
  phrase,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  title: string;
  description: string;
  phrase: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const matches = typed.trim() === phrase;
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setTyped('');
          onCancel();
        }
      }}
      isDismissable={false}
      className={`${themeClass} ${a.overlay}`}
    >
      <RACModal className={a.alert}>
        <RACDialog role="alertdialog" className={a.dialog} aria-label={title}>
          <div className={a.body}>
            <Heading slot="title" className={a.title}>
              {title}
            </Heading>
            <p className={a.description}>
              {description} <strong className={a.phrase}>{phrase}</strong>
            </p>
            <TextInput
              label="Enter the confirmation text"
              aria-label="Enter the confirmation text"
              size={32}
              placeholder={phrase}
              autoFocus
              value={typed}
              onChange={setTyped}
              isInvalid={typed.length > 0 && !phrase.startsWith(typed.trim()) && !matches}
              errorMessage="Your input did not match the required confirmation text"
              className={a.input}
            />
          </div>
          <div className={a.footer}>
            <Button
              variant="secondary"
              size={28}
              onPress={() => {
                setTyped('');
                onCancel();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size={28}
              isDisabled={!matches}
              isPending={pending}
              onPress={async () => {
                setPending(true);
                try {
                  await onConfirm();
                } finally {
                  setPending(false);
                  setTyped('');
                }
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </RACDialog>
      </RACModal>
    </ModalOverlay>
  );
}
