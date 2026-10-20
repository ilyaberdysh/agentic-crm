// The add row of the Share popover (H README §2.6): a "Search..." combobox over the members and teams that have no
// grant yet, the level for the new grant (default Full access) inside the same box, and "Add" (disabled until a
// target is picked). Adding creates the grant at once. The list is a plain ARIA combobox (↑ ↓ Enter Esc) rather than
// a react-aria collection: it sits inside a popover and stays out of the collection machinery.
import type { AccessScope } from '@agentic-crm/contracts';
import { Avatar, Button, PopoverPanel } from '@agentic-crm/ui';
import { useId, useMemo, useRef, useState } from 'react';
import { useWs } from '../data';
import { setGrantLevel, useGrantTargets } from './data';
import { TeamTile } from './GrantRow';
import { filterTargets, freeTargets, type Grants } from './grants';
import { PermissionLevelSelect } from './PermissionLevelSelect';
import * as s from './share.css';

interface Option {
  key: string;
  type: 'member' | 'team';
  id: string;
  name: string;
  /** Email of a member, "n members" of a team. */
  sub: string;
  /** What the new grant row shows until the server's list arrives (`targetDetail`). */
  detail: string;
}

export function TargetSearch({
  dashboardId,
  grants,
  disabled,
}: {
  dashboardId: string;
  grants: Grants | undefined;
  disabled: boolean;
}) {
  const ws = useWs();
  const listId = useId();
  const targets = useGrantTargets(!disabled);
  const boxRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<Option | null>(null);
  const [level, setLevel] = useState<AccessScope>('full-access');
  const [pending, setPending] = useState(false);

  const free = useMemo(
    () => freeTargets(grants, targets.members, targets.teams),
    [grants, targets.members, targets.teams],
  );
  const options = useMemo<Option[]>(() => {
    const found = filterTargets(free, picked ? '' : input);
    return [
      ...found.teams.map(
        (t): Option => ({
          key: `team:${t.id}`,
          type: 'team',
          id: t.id,
          name: t.name,
          sub: `${t.memberCount} ${t.memberCount === 1 ? 'member' : 'members'}`,
          detail: String(t.memberCount),
        }),
      ),
      ...found.members.map(
        (m): Option => ({
          key: `member:${m.id}`,
          type: 'member',
          id: m.id,
          name: m.name,
          sub: m.email,
          detail: m.email,
        }),
      ),
    ];
  }, [free, input, picked]);

  const pick = (option: Option) => {
    setPicked(option);
    setInput(option.name);
    setOpen(false);
  };

  const add = async () => {
    if (!picked || pending) return;
    setPending(true);
    const ok = await setGrantLevel(ws, dashboardId, { type: picked.type, id: picked.id }, level, {
      name: picked.name,
      detail: picked.detail,
    });
    setPending(false);
    if (ok) {
      setPicked(null);
      setInput('');
      setLevel('full-access');
    }
  };

  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  return (
    <div className={s.addRow} data-testid="share-add-row">
      <div ref={boxRef} className={s.addBox} data-disabled={disabled || undefined}>
        <input
          type="text"
          role="combobox"
          aria-label="Search members and teams"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search..."
          className={s.addInput}
          data-testid="share-search"
          disabled={disabled}
          value={input}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setInput(e.target.value);
            setPicked(null);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(options.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              const option = options[activeIndex];
              if (open && option) {
                e.preventDefault();
                pick(option);
              } else if (picked) {
                e.preventDefault();
                void add();
              }
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation();
              e.preventDefault();
              setOpen(false);
            }
          }}
        />
        <PermissionLevelSelect
          value={level}
          onChange={setLevel}
          isDisabled={disabled}
          aria-label="Access level for the new member or team"
          data-testid="share-add-level"
        />
      </div>
      <Button
        variant="primary"
        size={32}
        isDisabled={disabled || !picked}
        isPending={pending}
        onPress={() => void add()}
        data-testid="share-add"
      >
        Add
      </Button>
      <PopoverPanel
        isOpen={open && !disabled}
        onOpenChange={setOpen}
        triggerRef={boxRef}
        isNonModal
        shouldCloseOnInteractOutside={(el) => !boxRef.current?.contains(el)}
        placement="bottom start"
        offset={6}
        width={332}
      >
        <div id={listId} role="listbox" aria-label="Members and teams" className={s.optionList}>
          {options.length === 0 && <div className={s.optionEmpty}>No results found</div>}
          {options.map((o, i) => (
            <div
              key={o.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={picked?.key === o.key}
              data-active={i === activeIndex || undefined}
              className={s.option}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
            >
              {o.type === 'team' ? (
                <TeamTile size={16} />
              ) : (
                <Avatar kind="member" name={o.name} seed={o.id} size={16} />
              )}
              <span className={s.optionName}>{o.name}</span>
              <span className={s.optionSub}>{o.sub}</span>
            </div>
          ))}
        </div>
      </PopoverPanel>
    </div>
  );
}
