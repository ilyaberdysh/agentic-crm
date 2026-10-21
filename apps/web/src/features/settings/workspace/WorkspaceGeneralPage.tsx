// Settings → Workspace → General (J workspace-admin; admin only): logo (upload / remove), name (saved on blur) and
// the slug with an availability check (typing asks `workspace.checkSlug`; saving asks for confirmation because every
// URL of the workspace changes). Workspace export and deletion are deferred (defer list).
import { workspaceSlugSchema } from '@agentic-crm/contracts';
import { AlertDialog, Avatar, Button, ErrorState, Icon, IconButton, Spinner, TextInput, toast } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ContentSpinner } from '../../shell/AppShell';
import { useWorkspace } from '../../shell/workspaceContext';
import { AutosaveInput, useFileUrl } from '../admin/parts';
import { IMAGE_ERROR, IMAGE_HINT, uploadMemberImage } from '../admin/uploadImage';
import { copyToClipboard } from '../objects/parts';
import * as p from '../profile/profile.css';
import { SettingsPage, SettingsSection } from '../SettingsPage';
import { findSettingsEntry } from '../settingsNav';
import { slugProblem, updateWorkspaceGeneral, useSlugCheck, useWorkspaceDetail } from './data';

export function WorkspaceGeneralPage() {
  const entry = findSettingsEntry('workspace');
  const { workspace } = useWorkspace();
  const query = useWorkspaceDetail(workspace);
  if (!entry) return null;
  const detail = query.data;
  return (
    <SettingsPage entry={entry}>
      {query.isPending ? (
        <ContentSpinner />
      ) : !detail ? (
        <ErrorState
          message="Failed to load workspace settings"
          style={{ padding: 48 }}
          actions={
            <Button variant="secondary" size={28} onPress={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <SettingsSection id="workspace-details" title="Workspace details">
          <div className={p.stack}>
            <LogoBlock logoFileId={detail.logoFileId} logoUrl={detail.logoUrl} name={detail.name} id={detail.id} />
            <AutosaveInput
              label="Name"
              placeholder="Workspace name"
              value={detail.name}
              onSave={async (name) => {
                try {
                  await updateWorkspaceGeneral(workspace, { name });
                } catch {
                  toast.error({ title: 'Failed to update workspace name' });
                }
              }}
            />
            <SlugField slug={detail.slug} />
          </div>
        </SettingsSection>
      )}
    </SettingsPage>
  );
}

function LogoBlock({
  logoFileId,
  logoUrl,
  name,
  id,
}: {
  logoFileId: string | null;
  logoUrl: string | null;
  name: string;
  id: string;
}) {
  const { workspace, workspace: summary } = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploaded = useFileUrl(logoFileId);
  const memberId = summary.membership.id;

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const fileId = await uploadMemberImage(workspace, memberId, file, 'logo');
      await updateWorkspaceGeneral(workspace, { logoFileId: fileId });
    } catch (e) {
      setError(e instanceof Error && e.message === IMAGE_HINT ? IMAGE_HINT : IMAGE_ERROR);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <p className={p.fieldLabel}>Workspace logo</p>
      <div className={p.imageRow}>
        <Avatar name={name} src={uploaded ?? logoUrl} kind="workspace" size={64} seed={id} />
        <div className={p.imageText}>
          <p className={p.imageHint}>{IMAGE_HINT}</p>
          <div className={p.imageButtons}>
            <Button
              variant="secondary"
              size={28}
              icon="image"
              isPending={uploading}
              onPress={() => fileRef.current?.click()}
            >
              {uploading ? 'Uploading...' : 'Upload new logo'}
            </Button>
            {(logoFileId || logoUrl) && (
              <Button
                variant="secondary-destructive"
                size={28}
                icon="delete"
                aria-label="Remove logo"
                isDisabled={uploading}
                onPress={() =>
                  void updateWorkspaceGeneral(workspace, { logoFileId: null }).catch(() => setError(IMAGE_ERROR))
                }
              />
            )}
          </div>
          {error && <p className={p.imageError}>{error}</p>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif"
          aria-label="Choose logo file"
          className={p.hiddenInput}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </div>
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function SlugField({ slug }: { slug: string }) {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(slug);
  useEffect(() => setDraft(slug), [slug]);
  const changed = draft !== slug;
  const formatOk = workspaceSlugSchema.safeParse(draft).success;
  const debounced = useDebounced(draft, 250);
  const check = useSlugCheck(workspace, debounced, changed && formatOk && debounced === draft);
  const checking = changed && formatOk && (check.isFetching || debounced !== draft);
  const problem = changed
    ? formatOk
      ? slugProblem(check.data)
      : 'Use lower-case letters, digits and single hyphens'
    : null;
  const ok = changed && formatOk && !checking && check.data?.available === true;
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const next = await updateWorkspaceGeneral(workspace, { slug: draft });
      toast.success('Workspace slug updated');
      // Every URL carries the slug: continue on the new one.
      void navigate({ href: `/${next.slug}/settings/workspace`, replace: true });
    } catch {
      toast.error({ title: 'Failed to update workspace slug' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className={p.slugRow}>
        <TextInput
          label="Slug"
          size={32}
          value={draft}
          onChange={(v) => setDraft(v.toLowerCase())}
          isInvalid={Boolean(problem)}
          prefix="/"
          style={{ flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ok) setConfirming(true);
            if (e.key === 'Escape') setDraft(slug);
          }}
        />
        <IconButton
          icon="copy"
          aria-label="Copy slug"
          tooltip="Copy slug"
          variant="secondary"
          size={32}
          onPress={() => void copyToClipboard(slug, (t) => toast(t, { icon: 'copy' }))}
        />
        {changed && (
          <Button variant="primary" size={32} isDisabled={!ok} isPending={saving} onPress={() => setConfirming(true)}>
            Save
          </Button>
        )}
      </div>
      {changed && (
        <p className={p.slugStatus} style={{ marginTop: 6 }} role="status" data-testid="slug-status">
          {checking ? (
            <>
              <Spinner size={12} /> Checking availability
            </>
          ) : problem ? (
            <span style={{ color: 'var(--ar-color-content-critical)' }}>{problem}</span>
          ) : ok ? (
            <>
              <Icon icon="checkCircle" size={14} color="positive" /> This slug is available
            </>
          ) : null}
        </p>
      )}
      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Change slug"
        variant="primary"
        description={`Changing the slug changes every URL of your workspace. Bookmarks and integrations that use "${slug}" will stop working.`}
        confirmLabel="Change slug"
        onConfirm={() => void save()}
      />
    </div>
  );
}
