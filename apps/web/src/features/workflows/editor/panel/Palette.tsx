// Block palette ("Palette", Replace; evidence G/G-select-next-step.png, G-trigger-picker.png): search,
// All | Triggers | Steps, groups by category (triggers before steps), 40 px rows with the block tile; blocks this build
// cannot run yet are shown disabled with the reason; plan-gated ones carry the "Enterprise" badge. "Select next step"
// lists steps under "Pick a step to add after this block"; Replace keeps the block's kind.
import type { BlockDefinition } from '@agentic-crm/contracts';
import { Icon, IconButton, SegmentedControl, Tooltip } from '@agentic-crm/ui';
import { useEffect, useRef, useState } from 'react';
import { CATALOG } from '../../data';
import { type PaletteFilter, paletteGroups } from '../../model/blocks';
import { BlockTile } from '../../ui/parts';
import * as s from './panel.css';

export interface PaletteProps {
  purpose: 'add' | 'next' | 'replace' | 'trigger';
  /** Replace: the kind of block being replaced. */
  blockType?: 'trigger' | 'step';
  onBack?: () => void;
  onPick: (definition: BlockDefinition) => void;
}

export function Palette({ purpose, blockType, onBack, onPick }: PaletteProps) {
  const [query, setQuery] = useState('');
  const fixed: PaletteFilter | null =
    purpose === 'next'
      ? 'steps'
      : purpose === 'trigger'
        ? 'triggers'
        : purpose === 'replace'
          ? blockType === 'trigger'
            ? 'triggers'
            : 'steps'
          : null;
  const [filter, setFilter] = useState<PaletteFilter>('all');
  const groups = paletteGroups(CATALOG, fixed ?? filter, query);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const kindLabel = fixed === 'steps' ? 'Steps' : fixed === 'triggers' ? 'Triggers' : 'Blocks';
  return (
    <div
      data-testid="block-palette"
      data-purpose={purpose}
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
    >
      <div className={s.topBar} style={{ borderBottom: '1px solid var(--ar-color-stroke-primary)' }}>
        {onBack && <IconButton icon="chevronLeft" size={20} aria-label="Back" onPress={onBack} />}
        <input
          ref={input}
          className={s.paletteSearch}
          placeholder="Search"
          aria-label="Search blocks"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onBack?.();
            if (e.key === 'Enter') {
              const first = groups.flatMap((g) => g.blocks).find((b) => b.available);
              if (first) onPick(first);
            }
          }}
        />
        <span className={s.paletteKind}>{kindLabel}</span>
      </div>
      <div className={s.scroll}>
        {purpose === 'next' && (
          <div className={s.paletteHeading}>
            <h3 className={s.paletteTitle}>Select next step</h3>
            <p className={s.paletteSub}>Pick a step to add after this block</p>
          </div>
        )}
        {purpose === 'replace' && (
          <div className={s.paletteHeading}>
            <h3 className={s.paletteTitle}>{blockType === 'trigger' ? 'Replace trigger' : 'Replace step'}</h3>
            <p className={s.paletteSub}>
              {blockType === 'trigger'
                ? 'Pick a different block to replace this trigger.'
                : 'Pick a different block to replace this step.'}
            </p>
          </div>
        )}
        {fixed === null && (
          <div className={s.segmentedWrap}>
            <SegmentedControl
              aria-label="Block kinds"
              options={[
                { id: 'all', label: 'All' },
                { id: 'triggers', label: 'Triggers' },
                { id: 'steps', label: 'Steps' },
              ]}
              value={filter}
              onChange={(k) => setFilter(k as PaletteFilter)}
            />
          </div>
        )}
        {groups.length === 0 && (
          <p className={s.paletteSub} style={{ padding: '12px 20px' }}>
            No blocks found
          </p>
        )}
        {groups.map((g) => (
          <div key={g.category} className={s.paletteGroup} data-testid="palette-group" data-category={g.category}>
            <div className={s.paletteGroupLabel}>{g.label}</div>
            {g.blocks.map((b) => (
              <PaletteItem key={b.slug} block={b} onPick={onPick} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PaletteItem({
  block,
  onPick,
  compact,
}: {
  block: BlockDefinition;
  onPick: (b: BlockDefinition) => void;
  compact?: boolean;
}) {
  const disabled = !block.available;
  const item = (
    <button
      type="button"
      className={s.paletteItem}
      style={compact ? { height: 32, boxShadow: 'none', margin: 0, borderRadius: 8 } : undefined}
      data-disabled={disabled || undefined}
      aria-disabled={disabled || undefined}
      data-testid="palette-item"
      data-slug={block.slug}
      onClick={() => !disabled && onPick(block)}
    >
      <BlockTile slug={block.slug} size={compact ? 20 : 24} />
      {block.title}
      {block.gate?.kind === 'enterprise' ? (
        <span className={s.paletteBadge}>Enterprise</span>
      ) : disabled && !compact ? (
        <span className={s.paletteReason}>
          <Icon icon="lock" size={12} />
        </span>
      ) : null}
    </button>
  );
  return disabled ? <Tooltip content={block.unavailableReason ?? 'Not available yet'}>{item}</Tooltip> : item;
}
