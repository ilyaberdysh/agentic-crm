// Team building blocks: the team tile (icon + colour), its picker, and the member picker dialog used by "Invite to team"
// and "Add to team" (J permissions §6: searchable multi-select list with checkboxes).
import type { TeamIcon } from '@agentic-crm/contracts';
import {
  Button,
  Checkbox,
  DialogFooter,
  Icon,
  type IconName,
  IconTile,
  iconNames,
  Modal,
  PopoverPanel,
} from '@agentic-crm/ui';
import { useRef, useState } from 'react';
import { Button as AriaButton, SearchField as AriaSearchField, Dialog, Input } from 'react-aria-components';
import * as s from '../admin/admin.css';
import { MemberAvatar, memberName } from '../admin/parts';
import { TEAM_COLORS, TEAM_ICONS } from './data';
import * as t from './teams.css';

type TileSize = 16 | 20 | 24 | 28 | 32 | 40 | 56;

function iconNameOf(id: string | undefined): IconName {
  return id && (iconNames as string[]).includes(id) ? (id as IconName) : 'bookmark';
}

/** The coloured tile of a team (observed: a purple tile with a white glyph). */
export function TeamTile({ icon, size = 16 }: { icon: TeamIcon | null | undefined; size?: TileSize }) {
  return <IconTile icon={iconNameOf(icon?.id)} color={icon?.color ?? 'purple'} size={size} />;
}

/** Square icon button of the "New team" dialog: opens the icon and colour grid. */
export function TeamIconPicker({ value, onChange }: { value: TeamIcon; onChange: (icon: TeamIcon) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <AriaButton
        ref={ref}
        className={t.iconButton}
        aria-label="Choose team icon"
        aria-expanded={open}
        onPress={() => setOpen(true)}
      >
        <TeamTile icon={value} size={20} />
      </AriaButton>
      {open && (
        <PopoverPanel triggerRef={ref} isOpen onOpenChange={setOpen} placement="bottom start" width={224} padding={8}>
          <Dialog aria-label="Team icon" className={t.iconPanel}>
            <div className={t.iconGrid}>
              {TEAM_ICONS.map((id) => (
                <AriaButton
                  key={id}
                  className={t.iconCell}
                  aria-label={id}
                  data-selected={id === value.id || undefined}
                  onPress={() => onChange({ ...value, id })}
                >
                  <Icon icon={iconNameOf(id)} size={16} />
                </AriaButton>
              ))}
            </div>
            <div className={t.swatchRow}>
              {TEAM_COLORS.map((color) => (
                <AriaButton
                  key={color}
                  className={t.swatch}
                  aria-label={color}
                  data-selected={color === value.color || undefined}
                  onPress={() => onChange({ ...value, color })}
                >
                  <TeamTile icon={{ id: 'bookmark', color }} size={20} />
                </AriaButton>
              ))}
            </div>
          </Dialog>
        </PopoverPanel>
      )}
    </>
  );
}

export interface PickableMember {
  id: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
  avatarFileId: string | null;
}

/** "Invite to team" / "Add to team": search users, tick the ones to add, Confirm. */
export function MemberPickerDialog({
  isOpen,
  onOpenChange,
  members,
  placeholder = 'Search users',
  label,
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  members: PickableMember[];
  placeholder?: string;
  label: string;
  onConfirm: (memberIds: string[]) => Promise<void> | void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const q = query.trim().toLowerCase();
  const visible = members.filter(
    (m) => !q || memberName(m).toLowerCase().includes(q) || m.emailAddress.toLowerCase().includes(q),
  );
  const close = () => {
    onOpenChange(false);
    setQuery('');
    setPicked(new Set());
  };
  const submit = async () => {
    setPending(true);
    try {
      await onConfirm([...picked]);
      close();
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      size="large"
      aria-label={label}
      overlay
    >
      <div className={t.pickerSearch}>
        <AriaSearchField aria-label={placeholder} autoFocus value={query} onChange={setQuery} style={{ width: '100%' }}>
          <Input placeholder={placeholder} className={t.pickerSearchInput} />
        </AriaSearchField>
      </div>
      <div className={t.pickerList} role="listbox" aria-label={label} aria-multiselectable="true">
        {visible.length === 0 && <div className={t.pickerEmpty}>No results found</div>}
        {visible.map((m) => (
          <label key={m.id} className={s.checkRow} role="option" aria-selected={picked.has(m.id)}>
            <MemberAvatar member={m} size={16} />
            <span className={s.rowName}>
              {memberName(m)} <span className={s.muted}>{m.emailAddress}</span>
            </span>
            <span style={{ marginLeft: 'auto' }}>
              <Checkbox
                aria-label={memberName(m)}
                isSelected={picked.has(m.id)}
                onChange={(on) =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(m.id);
                    else next.delete(m.id);
                    return next;
                  })
                }
              />
            </span>
          </label>
        ))}
      </div>
      <DialogFooter>
        <Button variant="secondary" size={28} shortcut={['esc']} onPress={close}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size={28}
          shortcut={['mod', 'enter']}
          isPending={pending}
          isDisabled={picked.size === 0}
          onPress={() => void submit()}
        >
          Confirm
        </Button>
      </DialogFooter>
    </Modal>
  );
}
