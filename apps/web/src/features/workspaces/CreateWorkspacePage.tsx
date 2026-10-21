// `/welcome/workspace-details` — "Create your workspace" (K legacy-welcome). The handle follows the kebab-case
// of the company name until edited; availability is checked 250 ms after typing stops (reserved/taken → "This
// handle is already in use"). The logo tile mirrors the name; uploads arrive with file storage (D-19). Billing
// country and the post-creation welcome steps are deferred (defer list).
import { Avatar, Button, cx, IconButton, Spinner, TextInput } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { errorEnvelopeOf } from '../../data/trpc';
import {
  checkSlugAvailability,
  createWorkspace,
  type SlugAvailability,
  SlugTakenError,
  useWorkspaces,
} from '../../data/workspaces';
import { newId } from '../../lib/ids';
import { isValidSlug, kebabCase } from '../../lib/slug';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { AuthFooter } from '../auth/AuthLayout';
import * as a from '../auth/auth.css';
import { Wordmark } from '../auth/Wordmark';
import * as s from '../auth/welcome.css';

type HandleState = { slug: string; status: 'idle' | 'checking' | SlugAvailability | 'error' };

const TAKEN = 'This handle is already in use';
const INVALID = 'Use lower-case letters, digits and single hyphens';

export function CreateWorkspacePage() {
  useDocumentTitle('Create your workspace');
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const [workspaceId] = useState(newId);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [handle, setHandle] = useState<HandleState>({ slug: '', status: 'idle' });
  const [errors, setErrors] = useState<{ name?: string; slug?: string; form?: string }>({});
  const [pending, setPending] = useState(false);
  const latest = useRef('');

  // Untouched handle follows the company name.
  useEffect(() => {
    if (!slugTouched) setSlug(kebabCase(name));
  }, [name, slugTouched]);

  // Debounced availability check.
  useEffect(() => {
    latest.current = slug;
    if (!slug || !isValidSlug(slug)) {
      setHandle({ slug, status: slug ? 'invalid' : 'idle' });
      return;
    }
    setHandle({ slug, status: 'checking' });
    const timer = setTimeout(() => {
      checkSlugAvailability(slug).then(
        (status) => latest.current === slug && setHandle({ slug, status }),
        () => latest.current === slug && setHandle({ slug, status: 'error' }),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [slug]);

  const handleError =
    errors.slug ??
    (handle.status === 'taken' && handle.slug === slug ? TAKEN : undefined) ??
    (handle.status === 'invalid' && slug ? INVALID : undefined);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Please enter a workspace name';
    if (!slug) next.slug = 'Please enter a workspace handle';
    else if (!isValidSlug(slug)) next.slug = INVALID;
    else if (handle.status === 'taken' && handle.slug === slug) next.slug = TAKEN;
    setErrors(next);
    if (next.name || next.slug) return;
    setPending(true);
    try {
      const workspace = await createWorkspace({ id: workspaceId, name, slug });
      await navigate({ to: '/$workspaceSlug', params: { workspaceSlug: workspace.slug } });
    } catch (error) {
      setPending(false);
      if (error instanceof SlugTakenError) setErrors({ slug: error.message });
      else
        setErrors({
          form:
            errorEnvelopeOf(error).message ??
            'An unexpected error occurred while creating your workspace. Please try again and contact support if this issue persists.',
        });
    }
  }

  const displayName = name.trim() || 'Your workspace';

  return (
    <main className={a.page}>
      <header className={a.header}>
        <Wordmark />
      </header>
      <div className={s.cardWrap}>
        <div className={s.card}>
          <div className={s.left}>
            <div className={s.progress} style={{ width: '25%' }} />
            {workspaces.length > 0 && (
              <IconButton
                icon="chevronLeft"
                aria-label="go back"
                variant="ghost"
                size={28}
                onPress={() => navigate({ to: '/workspaces' })}
                style={{ position: 'absolute', top: 24, left: 24 }}
              />
            )}
            <form className={s.fields} onSubmit={onSubmit} noValidate>
              <h1 className={s.stepTitle}>Create your workspace</h1>
              <div className={s.logoRow}>
                <Avatar kind="workspace" name={displayName} seed={workspaceId} size={56} />
                <div className={s.logoLabel}>
                  <span className={s.logoTitle}>Company logo</span>
                  <span className={s.logoHint}>We support PNGs, JPEGs and GIFs under 10MB.</span>
                  <span className={s.logoHint}>Recommended size is 400x400px.</span>
                </div>
              </div>
              <TextInput
                label="Company name"
                name="name"
                size={32}
                placeholder="Enter your company name..."
                autoFocus
                value={name}
                onChange={(v) => {
                  setName(v);
                  if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
                }}
                isInvalid={Boolean(errors.name)}
                errorMessage={errors.name}
              />
              <TextInput
                label="Workspace handle"
                name="slug"
                size={32}
                prefix={`${window.location.host}/`}
                placeholder="my-workspace"
                value={slug}
                onChange={(v) => {
                  setSlugTouched(true);
                  setSlug(v.toLowerCase().replace(/\s+/g, '-'));
                  if (errors.slug) setErrors((e) => ({ ...e, slug: undefined }));
                }}
                isInvalid={Boolean(handleError)}
                errorMessage={handleError}
              />
              {!handleError && <HandleStatus state={handle} slug={slug} />}
              <Button type="submit" variant="primary" size={32} fullWidth isPending={pending}>
                {pending ? 'Creating your workspace' : 'Continue'}
              </Button>
              {errors.form && (
                <div role="alert" className={a.formError}>
                  {errors.form}
                </div>
              )}
            </form>
          </div>
          <div className={s.preview} aria-hidden="true">
            <div className={s.previewFrame}>
              <div className={s.previewSidebar}>
                <div className={s.previewHeader}>
                  <Avatar kind="workspace" name={displayName} seed={workspaceId} size={20} />
                  <span className={s.previewName}>{displayName}</span>
                </div>
                {[96, 72, 84, 64, 90].map((w) => (
                  <div key={w} className={s.previewRow}>
                    <span className={s.previewBar} style={{ width: 12 }} />
                    <span className={s.previewBar} style={{ width: w }} />
                  </div>
                ))}
              </div>
              <div className={s.previewMain}>
                <div className={s.previewTopbar} />
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className={s.previewTableRow}>
                    <span className={s.previewBar} style={{ width: `${60 + ((i * 17) % 30)}%` }} />
                    <span className={s.previewBar} style={{ width: `${40 + ((i * 23) % 40)}%` }} />
                    <span className={s.previewBar} style={{ width: `${30 + ((i * 13) % 50)}%` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <AuthFooter signOut />
    </main>
  );
}

function HandleStatus({ state, slug }: { state: HandleState; slug: string }) {
  if (!slug || state.slug !== slug) return <div className={s.handleStatus} />;
  if (state.status === 'checking')
    return (
      <div className={s.handleStatus}>
        <Spinner size={12} /> Checking availability...
      </div>
    );
  if (state.status === 'available')
    return <div className={cx(s.handleStatus, s.handleAvailable)}>This handle is available</div>;
  return <div className={s.handleStatus} />;
}
