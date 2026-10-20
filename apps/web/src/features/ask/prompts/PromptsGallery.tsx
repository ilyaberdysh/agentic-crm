// "Browse prompts" (ask-agentic §2.3): a large modal with a search field and category filters on the left and a grid of
// curated prompts (most saved first); a card opens its detail — categories, author and the guidance text — with
// Customize (a custom copy, opened in the editor) and Add to my prompts.
import { Button, Checkbox, Icon, IconButton, Modal, SearchField, toast } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { errorEnvelopeOf } from '../../../data/trpc';
import { brand } from '../../../lib/brand';
import { useWorkspaceRef } from '../../notes/data';
import { createPrompt, type PromptItem, promptTitle, savePrompt, usePrompts } from '../data';
import { PromptCard } from './PromptCard';
import { PromptTile } from './PromptTile';
import * as s from './prompts.css';
import { closePromptsModal, openCreatePrompt, openEditPrompt, openPromptsGallery } from './store';

const CATEGORIES = [
  { id: 'sales', label: 'Sales', icon: 'company' },
  { id: 'success', label: 'Success', icon: 'person' },
  { id: 'product', label: 'Product', icon: 'object' },
  { id: 'marketing', label: 'Marketing', icon: 'share' },
] as const;

const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? id;
const categoryIcon = (id: string) => CATEGORIES.find((c) => c.id === id)?.icon ?? 'object';

function Detail({ prompt }: { prompt: PromptItem }) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      toast.error({ title: failure, description: errorEnvelopeOf(e).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className={s.detailHead}>
        <PromptTile iconId={prompt.iconId} color={prompt.iconColor} size={56} />
        <div style={{ flex: 1 }}>
          <h2 className={s.detailTitle}>{promptTitle(prompt)}</h2>
          <p className={s.detailSummary}>{prompt.summary}</p>
        </div>
        <Button
          variant="secondary"
          size={28}
          isDisabled={busy}
          data-testid="prompt-customize"
          onPress={() =>
            void run(async () => {
              const copy = await createPrompt(client, ws, { mode: 'customize', curatedPromptId: prompt.id });
              openEditPrompt(copy.id);
            }, 'Failed to copy the prompt')
          }
        >
          Customize
        </Button>
        <Button
          variant={prompt.saved ? 'secondary' : 'primary'}
          size={28}
          isDisabled={busy}
          data-testid="prompt-add"
          onPress={() =>
            void run(async () => {
              await savePrompt(client, ws, prompt.id, !prompt.saved);
              toast({ title: prompt.saved ? 'Removed from my prompts' : 'Added to my prompts' });
            }, 'Failed to update your prompts')
          }
        >
          {prompt.saved ? 'Remove from my prompts' : 'Add to my prompts'}
        </Button>
      </div>
      <div className={s.detailLayout}>
        <div>
          <p className={s.metaLabel}>Categories</p>
          <div className={s.metaList}>
            {prompt.categories.map((cat) => (
              <span key={cat} className={s.metaItem}>
                <Icon icon={categoryIcon(cat)} size={16} />
                {categoryLabel(cat)}
              </span>
            ))}
          </div>
          <p className={s.metaLabel}>Created by</p>
          <div className={s.metaList}>
            <span className={s.metaItem}>
              <Icon icon="askAi" size={16} />
              {brand.name}
            </span>
          </div>
        </div>
        <div>
          <p className={s.metaLabel}>Guidance</p>
          <pre className={s.guidance} data-testid="prompt-guidance">
            {prompt.prompt}
          </pre>
        </div>
      </div>
    </>
  );
}

export function PromptsGallery({ promptId }: { promptId: string | null }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const curated = usePrompts({ scope: 'curated' });
  const all = curated.data?.prompts ?? [];
  const detail = promptId ? all.find((p) => p.id === promptId) : undefined;

  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all
      .filter((p) => selected.size === 0 || p.categories.some((c) => selected.has(c)))
      .filter((p) => !needle || `${promptTitle(p)} ${p.summary ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => b.savedCount - a.savedCount || promptTitle(a).localeCompare(promptTitle(b)));
  }, [all, query, selected]);

  return (
    <Modal
      isOpen
      onOpenChange={(open) => !open && closePromptsModal()}
      size={1248}
      alignment="center"
      overlay
      aria-label="Browse prompts"
      style={{ height: 788, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
    >
      <div className={s.modalHeader} data-testid="prompts-gallery-header">
        {detail ? (
          <>
            <IconButton icon="chevronLeft" size={20} aria-label="Back" onPress={() => openPromptsGallery(null)} />
            <button type="button" className={s.crumb} onClick={() => openPromptsGallery(null)}>
              Browse prompts
            </button>
            <span className={s.crumbSep}>/</span>
            <span className={s.crumbCurrent}>
              <PromptTile iconId={detail.iconId} color={detail.iconColor} size={20} />
              {promptTitle(detail)}
            </span>
          </>
        ) : (
          <span style={{ flex: 1 }}>Browse prompts</span>
        )}
        <span style={{ flex: 1 }} />
        <IconButton icon="close" size={28} aria-label="Close" onPress={closePromptsModal} />
      </div>
      <div className={s.modalBody} data-testid="prompts-gallery">
        {detail ? (
          <Detail prompt={detail} />
        ) : (
          <>
            <div className={s.titleRow}>
              <div>
                <h2 className={s.pageTitle}>Browse prompts</h2>
                <p className={s.pageSubtitle}>Discover new prompts to help you work better.</p>
              </div>
              <Button
                variant="secondary"
                size={28}
                onPress={() => openCreatePrompt()}
                data-testid="prompt-from-scratch"
              >
                Start from scratch
              </Button>
            </div>
            <div className={s.layout}>
              <div className={s.filters}>
                <SearchField aria-label="Search prompts" placeholder="Search" value={query} onChange={setQuery} />
                {CATEGORIES.map((cat) => (
                  <div key={cat.id} className={s.filterRow}>
                    <Icon icon={cat.icon} size={16} />
                    <span className={s.filterLabel}>{cat.label}</span>
                    <Checkbox
                      aria-label={cat.label}
                      isSelected={selected.has(cat.id)}
                      onChange={(on) => {
                        const next = new Set(selected);
                        if (on) next.add(cat.id);
                        else next.delete(cat.id);
                        setSelected(next);
                      }}
                    />
                  </div>
                ))}
              </div>
              <div>
                {list.length === 0 ? (
                  <div className={s.emptyResults}>{curated.isPending ? 'Loading prompts...' : 'No prompts found'}</div>
                ) : (
                  <div className={s.grid}>
                    {list.map((p) => (
                      <PromptCard key={p.id} prompt={p} gallery onOpen={() => openPromptsGallery(p.id)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
