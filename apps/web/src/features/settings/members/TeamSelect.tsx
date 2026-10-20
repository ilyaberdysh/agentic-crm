// "Add to team (optional)" multi-select of the invite dialog (J workspace-admin §3.2): a select-style trigger showing the
// chosen teams as chips, a popover with a search box, a checklist of teams and "New team" creation from the query.
import { Checkbox, Icon, Popover } from '@agentic-crm/ui';
import { useMemo, useState } from 'react';
import { Button as AriaButton, Input } from 'react-aria-components';
import { errorEnvelopeOf } from '../../../data/trpc';
import { useWorkspace } from '../../shell/workspaceContext';
import * as a from '../admin/admin.css';
import { createTeam, randomTeamIcon, useTeams } from '../teams/data';
import { TeamTile } from '../teams/parts';
import * as m from './members.css';

export function TeamSelect({
  value,
  onChange,
  placeholder = 'Search or create a team',
  ariaLabel = 'Add to team',
}: {
  value: string[];
  onChange: (teamIds: string[]) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const { workspace } = useWorkspace();
  const teams = useTeams(workspace);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const all = teams.data ?? [];
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => all.filter((t) => !q || t.name.toLowerCase().includes(q)), [all, q]);
  const exact = all.some((t) => t.name.toLowerCase() === q);
  const chosen = value.map((id) => all.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => Boolean(t));

  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...new Set([...value, id])] : value.filter((v) => v !== id));

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const team = await createTeam(workspace, { name: query.trim(), description: '', icon: randomTeamIcon() });
      onChange([...value, team.id]);
      setQuery('');
    } catch (e) {
      setError(errorEnvelopeOf(e).message ?? 'Failed to create team');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popover
      aria-label={ariaLabel}
      width="trigger"
      padding={0}
      placement="bottom start"
      trigger={
        <AriaButton className={m.teamTrigger} aria-label={ariaLabel}>
          {chosen.length === 0 ? (
            <span className={m.teamPlaceholder}>{placeholder}</span>
          ) : (
            <span className={m.teamChips}>
              {chosen.map((t) => (
                <span key={t.id} className={a.chip}>
                  <TeamTile icon={t.icon} size={16} />
                  {t.name}
                </span>
              ))}
            </span>
          )}
          <Icon icon="chevronDown" size={16} style={{ color: 'var(--ar-color-content-tertiary)' }} />
        </AriaButton>
      }
    >
      <div className={m.teamPanel}>
        <div className={m.teamSearch}>
          <Icon icon="search" size={16} />
          <Input
            autoFocus
            aria-label="Search teams"
            className={m.teamSearchInput}
            placeholder="Search teams..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q && !exact && !creating) {
                e.preventDefault();
                void create();
              }
            }}
          />
        </div>
        <div className={m.teamList}>
          {visible.map((t) => (
            <label key={t.id} className={a.checkRow}>
              <Checkbox aria-label={t.name} isSelected={value.includes(t.id)} onChange={(on) => toggle(t.id, on)} />
              <TeamTile icon={t.icon} size={16} />
              <span className={a.rowName}>{t.name}</span>
            </label>
          ))}
          {visible.length === 0 && !q && <div className={a.checkRow}>No teams yet</div>}
          {q && !exact && (
            <AriaButton
              className={a.checkRow}
              isDisabled={creating}
              onPress={() => void create()}
              style={{ border: 'none', background: 'none', textAlign: 'left' }}
            >
              <Icon icon="add" size={16} />
              <span className={a.rowName}>New team “{query.trim()}”</span>
            </AriaButton>
          )}
          {error && <p className={m.errorLine}>{error}</p>}
        </div>
      </div>
    </Popover>
  );
}
