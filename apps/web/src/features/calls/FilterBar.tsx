// Filters of the Calls list (I calls): "Filter" opens a popover with Record, Participant and Participant › Teams;
// each filter is a chip ("Record is [chip] ×") whose operator toggles between "is" and "is not". No status filter (the
// Filter menu; no filter controls are exposed in this build.
import { Icon, IconButton, Popover, Tooltip } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { api, inWorkspace } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { RecordChip, RecordPicker, useMembers } from '../attributes';
import { memberName } from '../attributes/format/formatValue';
import { useTeams } from '../settings/teams/data';
import { useWsRef } from './data';
import * as s from './list.css';
import { addFilter, type StoredFilter } from './model';

type Step = 'fields' | 'record' | 'participant';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Members, teams and person records matching the query (the combined "Select participant" search). */
function ParticipantPicker({ onPick }: { onPick: (filter: Omit<StoredFilter, 'id'>) => void }) {
  const ws = useWsRef();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 150);
  const teams = useTeams(ws).data ?? [];
  const members = useQuery({
    queryKey: ['ws', ws.id, 'member-search', 'calls-filter', debounced],
    queryFn: () => api.search.members.query({ query: debounced, limit: 8 }, inWorkspace(ws)),
    placeholderData: (prev) => prev,
  });
  const people = useQuery({
    queryKey: ['ws', ws.id, 'record-search', 'calls-filter', debounced],
    queryFn: () =>
      api.search.records.query({ query: debounced, entityDefinitionIds: ['people'], limit: 8 }, inWorkspace(ws)),
    placeholderData: (prev) => prev,
  });
  const q = debounced.trim().toLowerCase();
  const teamHits = teams.filter((t) => !q || t.name.toLowerCase().includes(q)).slice(0, 5);
  const memberHits = members.data?.hits ?? [];
  const personHits = people.data?.hits ?? [];
  const empty = teamHits.length + memberHits.length + personHits.length === 0;
  return (
    <>
      <input
        className={s.filterInput}
        placeholder="Search..."
        aria-label="Search participants"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        data-testid="participant-filter-input"
      />
      <div className={s.filterResults} role="listbox" aria-label="Participants">
        {teamHits.length > 0 && <div className={s.filterSection}>Teams</div>}
        {teamHits.map((t) => (
          <button
            key={t.id}
            type="button"
            role="option"
            aria-selected={false}
            className={s.filterOption}
            onClick={() => onPick({ field: 'participants-teams', mode: 'must', value: { teamId: t.id } })}
          >
            <Icon icon="people" size={16} />
            {t.name}
          </button>
        ))}
        {memberHits.length > 0 && <div className={s.filterSection}>Members</div>}
        {memberHits.map((m) => (
          <button
            key={m.id}
            type="button"
            role="option"
            aria-selected={false}
            className={s.filterOption}
            onClick={() => onPick({ field: 'participants', mode: 'must', value: { memberId: m.id } })}
          >
            <Icon icon="member" size={16} />
            <span className={s.filterOptionText}>
              {memberName(m)}
              <span className={s.filterOptionSub}>{m.emailAddress}</span>
            </span>
          </button>
        ))}
        {personHits.length > 0 && <div className={s.filterSection}>People</div>}
        {personHits.map((p) => (
          <button
            key={p.entityInstanceId}
            type="button"
            role="option"
            aria-selected={false}
            className={s.filterOption}
            onClick={() =>
              onPick({
                field: 'participants',
                mode: 'must',
                value: { entityDefinitionId: p.entityDefinitionId, entityInstanceId: p.entityInstanceId },
              })
            }
          >
            <Icon icon="person" size={16} />
            <span className={s.filterOptionText}>
              {p.title ?? 'Untitled record'}
              {p.subtitle && <span className={s.filterOptionSub}>{p.subtitle}</span>}
            </span>
          </button>
        ))}
        {empty && <div className={s.filterEmpty}>{members.isPending ? 'Searching...' : 'No results'}</div>}
      </div>
    </>
  );
}

export function FilterButton({
  filters,
  onChange,
}: {
  filters: StoredFilter[];
  onChange: (filters: StoredFilter[]) => void;
}) {
  const [step, setStep] = useState<Step>('fields');
  const [open, setOpen] = useState(false);
  const add = (next: Omit<StoredFilter, 'id'>) => {
    onChange(addFilter(filters, { ...next, id: newId() } as StoredFilter));
    setOpen(false);
  };
  return (
    <Popover
      isOpen={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setStep('fields');
      }}
      aria-label="Filter"
      placement="bottom start"
      padding={0}
      trigger={
        <AriaButton className={s.filterButton} data-testid="calls-filter">
          <Icon icon="filter" size={16} />
          Filter
        </AriaButton>
      }
    >
      <div className={s.filterPanel} data-testid="calls-filter-panel">
        {step === 'fields' ? (
          <div className={s.filterList}>
            <button
              type="button"
              className={s.filterOption}
              onClick={() => setStep('record')}
              data-testid="filter-record"
            >
              <Icon icon="record" size={16} />
              Record
            </button>
            <button
              type="button"
              className={s.filterOption}
              onClick={() => setStep('participant')}
              data-testid="filter-participant"
            >
              <Icon icon="people" size={16} />
              Participant
            </button>
          </div>
        ) : (
          <>
            <button type="button" className={s.filterBack} onClick={() => setStep('fields')}>
              <Icon icon="chevronLeft" size={16} />
              {step === 'record' ? 'Record' : 'Participant'}
            </button>
            {step === 'record' ? (
              <RecordPicker
                entityDefinitionIds={null}
                selected={[]}
                placeholder="Search records..."
                label="Record"
                onSelect={(record) => add({ field: 'record', mode: 'must', value: record })}
              />
            ) : (
              <ParticipantPicker onPick={add} />
            )}
          </>
        )}
      </div>
    </Popover>
  );
}

const FIELD_LABEL = {
  record: { icon: 'record', label: 'Record' },
  participants: { icon: 'person', label: 'Participant' },
  'participants-teams': { icon: 'people', label: 'Team' },
} as const;

function ChipValue({ filter }: { filter: StoredFilter }) {
  const members = useMembers();
  const ws = useWsRef();
  const teams = useTeams(ws, filter.field === 'participants-teams').data ?? [];
  if (filter.field === 'participants-teams') {
    return <span className={s.chipValue}>{teams.find((t) => t.id === filter.value.teamId)?.name ?? 'Team'}</span>;
  }
  const value = filter.value;
  if ('memberId' in value) {
    const member = members.find((m) => m.id === value.memberId);
    return <span className={s.chipValue}>{member ? memberName(member) : 'Member'}</span>;
  }
  return (
    <span className={s.chipValue}>
      <RecordChip entityDefinitionId={value.entityDefinitionId} entityInstanceId={value.entityInstanceId} />
    </span>
  );
}

/** The chips of the active filters; `onChange` replaces the list. */
export function FilterChips({
  filters,
  onChange,
}: {
  filters: StoredFilter[];
  onChange: (filters: StoredFilter[]) => void;
}) {
  if (filters.length === 0) return null;
  return (
    <div className={s.chips} data-testid="calls-filter-chips">
      {filters.map((f) => (
        <span key={f.id} className={s.chip} data-testid="calls-filter-chip" data-field={f.field}>
          <span className={s.chipField}>
            <Icon icon={FIELD_LABEL[f.field].icon} size={14} />
            {FIELD_LABEL[f.field].label}
          </span>
          {f.field === 'participants-teams' ? (
            <span className={s.muted}>contains</span>
          ) : (
            <Tooltip content="Toggle between is and is not">
              <AriaButton
                className={s.chipOperator}
                onPress={() =>
                  onChange(
                    filters.map((x) =>
                      x.id === f.id && x.field !== 'participants-teams'
                        ? { ...x, mode: x.mode === 'must' ? 'must-not' : 'must' }
                        : x,
                    ),
                  )
                }
                data-testid="calls-filter-operator"
              >
                {f.mode === 'must' ? 'is' : 'is not'}
              </AriaButton>
            </Tooltip>
          )}
          <ChipValue filter={f} />
          <IconButton
            icon="close"
            size={20}
            aria-label="Remove filter"
            tooltip="Remove filter"
            onPress={() => onChange(filters.filter((x) => x.id !== f.id))}
          />
        </span>
      ))}
    </div>
  );
}
