// The insight template editor `/$ws/calls/templates/$templateId` (BACKLOG 10.13; I calls;
// calls-template-editor-*.png): breadcrumb, inline title, Publish / Discard changes, the sections (rich-text title and
// prompt, List or Text, reorder, duplicate, delete), "Add section" / "Start with a template", and the preview pane.
// The editor always works on the template's draft; publishing makes it the active version.
import { rankBetween } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Breadcrumbs,
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Icon,
  Modal,
  toast,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorEnvelopeOf, httpStatusOf } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { PageHeader } from '../shell/PageHeader';
import { useWorkspace } from '../shell/workspaceContext';
import {
  type InsightPreset,
  type InsightTemplateDetail,
  incompleteIssues,
  useApplyPreset,
  useCreateSection,
  useDeleteSection,
  useDiscardTemplate,
  useDuplicateSection,
  useInsightTemplate,
  useMoveSection,
  usePublishTemplate,
  useUpdateSection,
  useUpdateTemplate,
} from './data';
import { templateTitle, UNTITLED_TEMPLATE } from './model';
import { PresetGallery } from './PresetGallery';
import { type EditorHandles, SectionCard } from './SectionCard';
import { TemplatePreviewPane } from './TemplatePreviewPane';
import { TemplateMenu } from './TemplatesPage';
import * as s from './templates.css';

/** The collab server stores documents 2 s after the last change (COLLAB_DEBOUNCE_MS). */
const EDIT_SETTLE_MS = 2400;

interface Issue {
  sectionId: string;
  section: number;
  missing: string[];
}

function TitleInput({ template }: { template: InsightTemplateDetail }) {
  const update = useUpdateTemplate();
  const [value, setValue] = useState(template.title ?? '');
  useEffect(() => setValue(template.title ?? ''), [template.title]);
  const save = () => {
    const next = value.trim();
    if (next === (template.title ?? '')) return;
    update.mutate(
      { templateId: template.id, title: next === '' ? null : next },
      {
        onError: (e) =>
          toast.error({ title: 'Failed to rename the template', description: errorEnvelopeOf(e).message }),
      },
    );
  };
  return (
    <input
      className={s.titleInput}
      value={value}
      placeholder={template.aiTitle ?? UNTITLED_TEMPLATE}
      aria-label="Template title"
      data-testid="template-title"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** "It looks like your template is incomplete": the sections missing a title or prompt, "Go to first issue". */
function IncompleteDialog({
  issues,
  action,
  onClose,
  onGo,
}: {
  issues: Issue[] | null;
  action: 'publish' | 'preview';
  onClose: () => void;
  onGo: (issue: Issue) => void;
}) {
  const first = issues?.[0];
  return (
    <Modal
      isOpen={issues !== null}
      onOpenChange={(open) => !open && onClose()}
      size="small"
      alignment="center"
      role="alertdialog"
      overlay
      aria-label="Incomplete template"
    >
      <DialogHeader title="It looks like your template is incomplete" />
      <DialogBody style={{ padding: 16 }}>
        <p style={{ margin: 0 }} data-testid="incomplete-message">
          {action === 'publish'
            ? 'You cannot publish a template with missing content.'
            : 'You cannot generate a preview with missing content.'}
        </p>
        <ul className={s.incomplete} data-testid="incomplete-issues">
          {(issues ?? []).map((i) => (
            <li key={i.sectionId}>
              Section {i.section} · Missing {i.missing.join(', ')}
            </li>
          ))}
          {issues && issues.length === 0 && <li>Add at least one section.</li>}
        </ul>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" size={28} onPress={onClose}>
          Cancel
        </Button>
        {first && (
          <Button
            variant="primary"
            size={28}
            onPress={() => {
              onGo(first);
              onClose();
            }}
            data-testid="incomplete-go"
          >
            Go to first issue
          </Button>
        )}
      </DialogFooter>
    </Modal>
  );
}

export function TemplateEditorPage({ templateId }: { templateId: string }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const template = useInsightTemplate(templateId);
  const data = template.data;
  useDocumentTitle(data ? templateTitle(data) : 'Insight template');

  const publish = usePublishTemplate();
  const discard = useDiscardTemplate();
  const createSection = useCreateSection();
  const updateSection = useUpdateSection();
  const deleteSection = useDeleteSection();
  const duplicateSection = useDuplicateSection();
  const moveSection = useMoveSection();
  const applyPreset = useApplyPreset();

  const handles = useRef<EditorHandles>(new Map());
  const cards = useRef<Map<string, HTMLDivElement>>(new Map());
  const [gallery, setGallery] = useState(false);
  const [issues, setIssues] = useState<{ list: Issue[]; action: 'publish' | 'preview' } | null>(null);
  const [confirm, setConfirm] = useState<'publish' | 'discard' | null>(null);
  const [drag, setDrag] = useState<{ id: string; before: number } | null>(null);

  const fail = (what: string) => (e: unknown) => toast.error({ title: what, description: errorEnvelopeOf(e).message });
  const sections = data?.draft?.sections ?? [];

  const goToIssue = useCallback(
    (issue: Issue) => {
      const section = sections.find((sec) => sec.id === issue.sectionId);
      if (!section) return;
      cards.current.get(section.id)?.scrollIntoView({ block: 'center' });
      const doc = issue.missing.includes('title') ? section.titleDocumentId : section.promptDocumentId;
      handles.current.get(doc)?.focus('end');
    },
    [sections],
  );

  // Typing syncs to the collab server, which stores the documents a couple of seconds later; publish, preview and
  // duplicate read the stored documents, so they wait for what was just typed to be stored.
  const lastEdit = useRef(0);
  const settle = useCallback(async () => {
    const wait = EDIT_SETTLE_MS - (Date.now() - lastEdit.current);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }, []);

  const [publishing, setPublishing] = useState(false);
  const runPublish = async () => {
    setPublishing(true);
    try {
      await settle();
      await publish.mutateAsync({ templateId });
      toast({ title: 'Template published' });
    } catch (e) {
      const found = incompleteIssues(e);
      if (found) setIssues({ list: found, action: 'publish' });
      else fail('Failed to publish template')(e);
    } finally {
      setPublishing(false);
    }
  };

  const addSection = () =>
    createSection.mutate(
      { templateId, sectionId: newId(), type: 'plaintext' },
      { onError: fail('Failed to add the section') },
    );

  // ---- reorder by dragging the handle (5 px activation, a 2 px drop line before / after the cards) ----------------------------
  const startDrag = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    let active = false;
    const slot = (y: number): number => {
      let before = sections.length;
      for (let i = 0; i < sections.length; i++) {
        const node = cards.current.get(sections[i]?.id ?? '');
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        if (y < rect.top + rect.height / 2) {
          before = i;
          break;
        }
      }
      return before;
    };
    const move = (ev: PointerEvent) => {
      if (!active && Math.abs(ev.clientY - startY) < 5) return;
      active = true;
      setDrag({ id, before: slot(ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!active) return;
      const target = slot(ev.clientY);
      const rest = sections.filter((sec) => sec.id !== id);
      const from = sections.findIndex((sec) => sec.id === id);
      const at = target > from ? target - 1 : target;
      if (at === from) return;
      const sortOrder = rankBetween(rest[at - 1]?.sortOrder ?? null, rest[at]?.sortOrder ?? null);
      updateSection.mutate({ sectionId: id, sortOrder }, { onError: fail('Failed to move the section') });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const crumbs = [
    { id: 'calls', label: 'Calls', href: href('calls'), icon: <Icon icon="meeting" size={16} /> },
    { id: 'templates', label: 'Insight Templates', href: href('calls/templates') },
    { id: 'template', label: data ? templateTitle(data) : '' },
  ];
  const header = (
    <PageHeader
      start={<Breadcrumbs items={crumbs} />}
      actions={
        data ? (
          <>
            {data.isArchived && (
              <span className={`${s.statusBadge} ${s.statusTone.disabled}`} data-testid="archived-badge">
                Archived Template
              </span>
            )}
            <TemplateMenu template={data} size={28} onDeleted={() => void navigate({ to: href('calls/templates') })} />
          </>
        ) : undefined
      }
    />
  );

  if (template.isError) {
    return (
      <>
        {header}
        <div className={s.state} data-testid="template-unavailable">
          <span className={s.stateTitle}>Failed to load template</span>
          <span className={s.stateText}>
            {httpStatusOf(template.error) === 404
              ? "This template doesn't exist, or you don't have access to it."
              : 'The template could not be loaded. Try again in a moment.'}
          </span>
        </div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        {header}
        <div className={s.state} data-testid="template-loading">
          <span className={s.stateText}>Loading template...</span>
        </div>
      </>
    );
  }
  if (!data.draft) {
    return (
      <>
        {header}
        <div className={s.state}>
          <span className={s.stateTitle}>This template is missing a draft version</span>
        </div>
      </>
    );
  }

  const publishLabel = publish.isPending
    ? 'Publishing...'
    : data.isFirstVersion
      ? 'Publish template'
      : 'Publish changes';
  return (
    <>
      {header}
      <div className={s.editor} data-testid="template-editor" data-template-id={data.id}>
        <div className={s.editorHeader}>
          <TitleInput template={data} />
          <div className={s.headerActions}>
            {data.hasUnpublishedChanges && (
              <Button
                variant="ghost"
                size={28}
                isPending={discard.isPending}
                onPress={() => setConfirm('discard')}
                data-testid="template-discard"
              >
                {discard.isPending ? 'Discarding...' : 'Discard changes'}
              </Button>
            )}
            <Button
              variant="primary"
              size={28}
              isDisabled={!data.canPublish || publishing}
              onPress={() => (data.totalInsights > 0 ? setConfirm('publish') : runPublish())}
              data-testid="template-publish"
            >
              {publishLabel}
            </Button>
          </div>
        </div>
        <div className={s.panes}>
          <div
            className={s.sectionsPane}
            data-testid="template-sections-pane"
            onInput={() => {
              lastEdit.current = Date.now();
            }}
          >
            {sections.map((section, i) => (
              <div key={section.id}>
                {drag && drag.before === i && <div className={s.dropLine} data-testid="drop-line" />}
                <SectionCard
                  section={section}
                  index={i}
                  count={sections.length}
                  readOnly={false}
                  handles={handles.current}
                  dragging={drag?.id === section.id}
                  cardRef={(node) => {
                    if (node) cards.current.set(section.id, node);
                    else cards.current.delete(section.id);
                  }}
                  onDragStart={startDrag(section.id)}
                  onMove={(direction) =>
                    moveSection.mutate(
                      { sectionId: section.id, direction },
                      { onError: fail('Failed to move the section') },
                    )
                  }
                  onDuplicate={() =>
                    void settle().then(() =>
                      duplicateSection.mutate(
                        { sectionId: section.id, newSectionId: newId() },
                        { onError: fail('Failed to duplicate the section') },
                      ),
                    )
                  }
                  onDelete={() =>
                    deleteSection.mutate({ sectionId: section.id }, { onError: fail('Failed to delete the section') })
                  }
                  onFormat={(type) =>
                    updateSection.mutate(
                      { sectionId: section.id, type },
                      { onError: fail('Failed to change the format') },
                    )
                  }
                />
              </div>
            ))}
            {drag && drag.before === sections.length && <div className={s.dropLine} data-testid="drop-line" />}
            <button type="button" className={s.addSection} onClick={addSection} data-testid="add-section">
              <Icon icon="add" size={16} />
              Add section
            </button>
            {sections.length === 0 && (
              <>
                <div className={s.orRow}>
                  <span className={s.orLine} />
                  OR
                  <span className={s.orLine} />
                </div>
                <button
                  type="button"
                  className={s.addSection}
                  onClick={() => setGallery(true)}
                  data-testid="start-with-template"
                >
                  <Icon icon="template" size={16} />
                  Start with a template
                </button>
              </>
            )}
          </div>
          <TemplatePreviewPane
            template={data}
            beforeGenerate={settle}
            onIncomplete={(list, action) => setIssues({ list, action })}
          />
        </div>
      </div>

      <PresetGallery
        isOpen={gallery}
        onOpenChange={setGallery}
        applying={applyPreset.isPending}
        onUse={(preset: InsightPreset) =>
          applyPreset.mutate(
            { templateId, presetId: preset.id },
            {
              onSuccess: () => setGallery(false),
              onError: () => toast.error({ title: 'Failed to apply template, please try again later' }),
            },
          )
        }
      />
      <IncompleteDialog
        issues={issues?.list ?? null}
        action={issues?.action ?? 'publish'}
        onClose={() => setIssues(null)}
        onGo={goToIssue}
      />
      <AlertDialog
        isOpen={confirm === 'publish'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Are you sure you want to publish these changes?"
        description="Insights already generated with this template will not be affected by these changes."
        confirmLabel="Publish changes"
        variant="primary"
        onConfirm={runPublish}
      />
      <AlertDialog
        isOpen={confirm === 'discard'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Are you sure you want to discard these changes?"
        description="This will discard all changes you have made to this template since you last published it."
        confirmLabel="Discard changes"
        onConfirm={() => discard.mutate({ templateId }, { onError: fail('Failed to discard changes') })}
      />
    </>
  );
}
