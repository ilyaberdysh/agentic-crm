// "Start with a template": the
// gallery of custom presets — use-case chips in the fixed order, a search over title and description, cards with a
// scaled-down section preview — and the preset preview (read-only sections, a side panel, "Use this template").
import { Button, Checkbox, DialogHeader, Icon, IconButton, Modal } from '@agentic-crm/ui';
import { useEffect, useMemo, useState } from 'react';
import { type InsightPreset, useTemplatePresets } from './data';
import { filterPresets, PRESET_CATEGORY_LABEL, PRESET_CATEGORY_ORDER, type PresetCategory, sortPresets } from './model';
import * as s from './templates.css';

const CATEGORY_ICON = {
  general: 'presetGeneral',
  sales: 'presetSales',
  success: 'presetSuccess',
  product: 'presetProduct',
  marketing: 'presetMarketing',
  recruiting: 'presetRecruiting',
  fundraising: 'presetFundraising',
  investing: 'presetInvesting',
} as const satisfies Record<PresetCategory, string>;

function FormatTag({ type }: { type: 'plaintext' | 'list' }) {
  return (
    <span className={s.miniFormat} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <Icon icon={type === 'list' ? 'formatList' : 'formatText'} size={9} />
      {type === 'list' ? 'List' : 'Text'}
    </span>
  );
}

function CategoryTags({ preset }: { preset: InsightPreset }) {
  return (
    <div className={s.tags}>
      {preset.categories.map((cat) => (
        <span key={cat} className={`${s.tag} ${s.categoryHue[cat]}`} data-testid="preset-category">
          {PRESET_CATEGORY_LABEL[cat]}
        </span>
      ))}
    </div>
  );
}

function PresetCard({
  preset,
  active,
  onOpen,
  onHover,
}: {
  preset: InsightPreset;
  active: boolean;
  onOpen: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      className={s.presetCard}
      data-testid="preset-card"
      data-preset-id={preset.id}
      data-active={active}
      onClick={onOpen}
      onMouseEnter={onHover}
      onFocus={onHover}
    >
      <span className={s.presetMini} aria-hidden="true">
        {preset.sections.slice(0, 3).map((sec) => (
          <span key={sec.title} className={s.miniRow}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sec.title}</span>
            <FormatTag type={sec.type} />
          </span>
        ))}
      </span>
      <span className={s.presetInfo}>
        <span className={s.presetHead}>
          <span className={s.presetTitle}>{preset.title}</span>
          <span className={s.countBadge} data-testid="preset-sections">
            {preset.sections.length} {preset.sections.length === 1 ? 'Section' : 'Sections'}
          </span>
        </span>
        <span className={s.presetDescription}>{preset.description}</span>
        <CategoryTags preset={preset} />
      </span>
    </button>
  );
}

function PresetPreview({
  preset,
  applying,
  onBack,
  onClose,
  onUse,
}: {
  preset: InsightPreset;
  applying: boolean;
  onBack: () => void;
  onClose: () => void;
  onUse: () => void;
}) {
  return (
    <>
      <div className={s.galleryTop}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <IconButton
            icon="chevronLeft"
            size={28}
            aria-label="Back to templates"
            onPress={onBack}
            data-testid="preset-back"
          />
          <span className={s.muted}>Templates</span>
          <span className={s.muted}>/</span>
          <span data-testid="preset-preview-title">{preset.title}</span>
        </span>
        <IconButton icon="close" size={28} aria-label="Close" onPress={onClose} />
      </div>
      <div className={`${s.galleryBody} ${s.presetPreview}`}>
        <div className={s.presetSections}>
          {preset.sections.map((sec) => (
            <div key={sec.title} className={s.sectionCard} data-testid="preset-section">
              <p className={s.readOnlyTitle}>{sec.title}</p>
              <hr className={s.sectionRule} />
              <p className={s.readOnlyPrompt}>{sec.prompt}</p>
              <div className={s.sectionFooter}>
                Format
                <span
                  style={{
                    color: 'var(--ar-color-content-primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Icon icon={sec.type === 'list' ? 'formatList' : 'formatText'} size={12} />
                  {sec.type === 'list' ? 'List' : 'Text'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <aside className={s.presetSide}>
          <CategoryTags preset={preset} />
          <h3 className={s.sideTitle}>{preset.title}</h3>
          <p className={s.sideDescription}>{preset.description}</p>
          <hr className={s.sideRule} />
          <span className={s.sideLabel}>Sections</span>
          <div className={s.sideList}>
            {preset.sections.map((sec) => (
              <span key={sec.title} className={s.sideItem}>
                <Icon icon={sec.type === 'list' ? 'formatList' : 'formatText'} size={14} />
                {sec.title}
              </span>
            ))}
          </div>
        </aside>
      </div>
      <div className={s.galleryFooter}>
        <span />
        <Button variant="primary" size={28} isPending={applying} onPress={onUse} data-testid="preset-use">
          {applying ? 'Applying template...' : 'Use this template'}
        </Button>
      </div>
    </>
  );
}

export function PresetGallery({
  isOpen,
  onOpenChange,
  onUse,
  applying,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onUse: (preset: InsightPreset) => void;
  applying: boolean;
}) {
  const presets = useTemplatePresets();
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState<InsightPreset | null>(null);
  const list = useMemo(
    () => sortPresets(filterPresets(presets.data ?? [], { categories, query })),
    [presets.data, categories, query],
  );
  useEffect(() => setActive(0), [categories, query]);
  useEffect(() => {
    if (!isOpen) {
      setPreview(null);
      setQuery('');
      setCategories([]);
    }
  }, [isOpen]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (preview) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!applying) onUse(preview);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && list[active] && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      setPreview(list[active] ?? null);
    }
  };

  useEffect(() => {
    document
      .querySelector<HTMLElement>(`[data-testid="preset-card"][data-active="true"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size={1244}
      alignment="top"
      aria-label="Templates"
      overlay
      className={s.gallery}
      style={{ height: 'min(690px, 86vh)', display: 'flex', flexDirection: 'column' }}
    >
      <div
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        onKeyDown={onKeyDown}
        data-testid="preset-gallery"
        data-view={preview ? 'preview' : 'list'}
      >
        {preview ? (
          <PresetPreview
            preset={preview}
            applying={applying}
            onBack={() => setPreview(null)}
            onClose={() => onOpenChange(false)}
            onUse={() => onUse(preview)}
          />
        ) : (
          <>
            <DialogHeader title="Templates" onClose={() => onOpenChange(false)} />
            <div className={s.galleryBody}>
              <aside className={s.galleryAside}>
                <div className={s.asideLabel}>Use cases</div>
                {PRESET_CATEGORY_ORDER.map((cat) => (
                  <Checkbox
                    key={cat}
                    className={s.categoryRow}
                    aria-label={PRESET_CATEGORY_LABEL[cat]}
                    isSelected={categories.includes(cat)}
                    onChange={(on) => setCategories((prev) => (on ? [...prev, cat] : prev.filter((c) => c !== cat)))}
                    data-testid="preset-use-case"
                  >
                    <span className={s.categoryLabel}>
                      <span className={`${s.categoryTile} ${s.categoryHue[cat]}`}>
                        <Icon icon={CATEGORY_ICON[cat]} size={12} />
                      </span>
                      <span className={s.categoryName}>{PRESET_CATEGORY_LABEL[cat]}</span>
                    </span>
                  </Checkbox>
                ))}
              </aside>
              <div className={s.galleryMain}>
                <input
                  className={s.gallerySearch}
                  placeholder="Search for templates, topics, goals..."
                  aria-label="Search templates"
                  value={query}
                  autoFocus
                  onChange={(e) => setQuery(e.target.value)}
                  data-testid="preset-search"
                />
                <div className={s.galleryList} data-testid="preset-list">
                  {presets.isPending ? (
                    <div className={s.stateText}>Loading templates...</div>
                  ) : list.length === 0 ? (
                    <div className={s.state}>
                      <span className={s.stateTitle}>
                        {query.trim() ? `No results found for "${query.trim()}"` : 'No templates'}
                      </span>
                    </div>
                  ) : (
                    list.map((p, i) => (
                      <PresetCard
                        key={p.id}
                        preset={p}
                        active={i === active}
                        onOpen={() => setPreview(p)}
                        onHover={() => setActive(i)}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className={s.galleryFooter}>
              <span>↑↓ Navigate</span>
              <Button
                variant="primary"
                size={28}
                isDisabled={list.length === 0}
                onPress={() => setPreview(list[active] ?? null)}
                data-testid="preset-preview-open"
              >
                Preview template
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
