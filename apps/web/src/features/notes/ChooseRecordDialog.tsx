// "Choose record" (E README §2.3): opened by "+ New note" and `n` outside a record. Search records (autofocus),
// "Records" (recent) / "Results" (typed), each with avatar, name, secondary text and object on the right; last option
// "Create new record" / `Create "<query>" as record`; footer "↑ ↓ Navigate" and "Select record ⏎". Enter picks.
import { Button, DialogHeader, Icon, Kbd, Modal } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { type ObjectSummary, useObjects } from '../../data/objects';
import { api, inWorkspace } from '../../data/trpc';
import { NewRecordDialog } from '../attributes/NewRecordDialog';
import { RecordAvatar, recordKind } from '../attributes/ui/primitives';
import type { RecordRef } from '../overlays/model';
import { useWorkspace } from '../shell/workspaceContext';
import * as s from './chooser.css';

type Row =
  | { kind: 'record'; ref: RecordRef; title: string; subtitle: string | null; object: ObjectSummary | undefined }
  | { kind: 'create' }
  | { kind: 'object'; object: ObjectSummary };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ChooseRecordDialog({
  title = 'Choose record',
  onPick,
  onClose,
}: {
  title?: string;
  onPick: (record: RecordRef) => void;
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data ?? [];
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [step, setStep] = useState<'records' | 'objects'>('records');
  const [creating, setCreating] = useState<ObjectSummary | null>(null);
  const [createTitle, setCreateTitle] = useState('');
  const q = useDebounced(query.trim(), 100);
  const listRef = useRef<HTMLDivElement>(null);
  const ws = { id: workspace.id, slug: workspace.slug };
  const search = useQuery({
    queryKey: ['ws', ws.id, 'record-search', 'choose-record', q],
    queryFn: () => api.search.records.query({ query: q, limit: 25 }, inWorkspace(ws)),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });

  const rows: Row[] =
    step === 'records'
      ? [
          ...(search.data?.hits ?? []).map((h) => ({
            kind: 'record' as const,
            ref: { entityDefinitionId: h.entityDefinitionId, entityInstanceId: h.entityInstanceId },
            title: h.title ?? 'Untitled record',
            subtitle: h.subtitle,
            object: objects.find((o) => o.id === h.entityDefinitionId),
          })),
          { kind: 'create' as const },
        ]
      : objects
          .filter((o) => !q || o.singularNoun.toLowerCase().includes(q.toLowerCase()))
          .map((object) => ({ kind: 'object' as const, object }));

  useEffect(() => setActive(0), [q, step]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  });

  const choose = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'record') onPick(row.ref);
    else if (row.kind === 'create') {
      setCreateTitle(query.trim());
      setStep('objects');
      setQuery('');
    } else setCreating(row.object);
  };

  if (creating) {
    return (
      <NewRecordDialog
        entityDefinitionId={creating.id}
        initialTitle={createTitle}
        allowCreateMore={false}
        navigateOnCreate={false}
        onClose={onClose}
        onCreated={(record) => onPick(record)}
      />
    );
  }

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} size={600} aria-label={title}>
      <div className={s.root} data-testid="choose-record-dialog">
        <DialogHeader
          title={step === 'records' ? title : 'Choose object'}
          icon={step === 'objects' ? <BackButton onPress={() => setStep('records')} /> : undefined}
          onClose={onClose}
        />
        <div className={s.searchRow}>
          <Icon icon="search" size={16} className={s.searchIcon} />
          <input
            className={s.searchInput}
            role="combobox"
            aria-expanded
            aria-controls="choose-record-list"
            aria-label={step === 'records' ? 'Search records' : 'Search objects'}
            placeholder={step === 'records' ? 'Search records...' : 'Search objects...'}
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const n = rows.length;
                setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(rows[active]);
              }
            }}
          />
        </div>
        <div className={s.list} id="choose-record-list" role="listbox" aria-label="Records" ref={listRef}>
          {step === 'records' && <div className={s.label}>{q ? 'Results' : 'Records'}</div>}
          {rows.map((row, i) => {
            const isActive = i === active;
            const common = {
              role: 'option' as const,
              'aria-selected': isActive,
              className: s.option,
              'data-active': isActive || undefined,
              onMouseEnter: () => setActive(i),
              onClick: () => choose(row),
            };
            if (row.kind === 'record') {
              return (
                <div key={row.ref.entityInstanceId} {...common}>
                  <RecordAvatar kind={recordKind(row.object as Parameters<typeof recordKind>[0])} size={20} />
                  <span className={s.optionTitle}>{row.title}</span>
                  {row.subtitle && <span className={s.optionSecondary}>{row.subtitle}</span>}
                  <span className={s.optionObject}>{row.object?.singularNoun ?? ''}</span>
                </div>
              );
            }
            if (row.kind === 'create') {
              return (
                <div key="create" {...common} data-testid="choose-record-create">
                  <span className={s.createIcon}>
                    <Icon icon="add" size={14} />
                  </span>
                  <span className={s.optionTitle}>{q ? `Create "${q}" as record` : 'Create new record'}</span>
                </div>
              );
            }
            return (
              <div key={row.object.id} {...common}>
                <RecordAvatar kind={recordKind(row.object as Parameters<typeof recordKind>[0])} size={20} />
                <span className={s.optionTitle}>{row.object.singularNoun}</span>
              </div>
            );
          })}
        </div>
        <div className={s.footer}>
          <span className={s.hint}>
            <Kbd keys={['up']} size={18} />
            <Kbd keys={['down']} size={18} />
            Navigate
          </span>
          <Button variant="primary" size={28} shortcut={['enter']} onPress={() => choose(rows[active])}>
            {step === 'records' ? 'Select record' : 'Select object'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return <Button variant="ghost" size={20} icon="chevronLeft" iconOnly aria-label="Back" onPress={onPress} />;
}
