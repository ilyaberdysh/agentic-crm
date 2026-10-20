// "Manage teams" of a member row (J workspace-admin §3.1): a team multi-select ("Search teams...") that adds and removes
// the member's team memberships in one Confirm.
import type { MemberSummary } from '@agentic-crm/contracts';
import { Button, Checkbox, DialogBody, DialogFooter, DialogHeader, Modal, SearchField, toast } from '@agentic-crm/ui';
import { useState } from 'react';
import { errorEnvelopeOf } from '../../../data/trpc';
import { useWorkspace } from '../../shell/workspaceContext';
import * as a from '../admin/admin.css';
import { addTeamMembers, removeTeamMembers, useTeams } from '../teams/data';
import { TeamTile } from '../teams/parts';

export function ManageTeamsDialog({ member, onClose }: { member: MemberSummary | null; onClose: () => void }) {
  return member ? <Body key={member.id} member={member} onClose={onClose} /> : null;
}

function Body({ member, onClose }: { member: MemberSummary; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const teams = useTeams(workspace);
  const [selected, setSelected] = useState<Set<string>>(new Set(member.teamIds));
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const q = query.trim().toLowerCase();
  const visible = (teams.data ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));

  async function save() {
    setPending(true);
    const before = new Set(member.teamIds);
    try {
      for (const t of teams.data ?? []) {
        if (selected.has(t.id) && !before.has(t.id)) await addTeamMembers(workspace, t.id, [member.id]);
        if (!selected.has(t.id) && before.has(t.id)) await removeTeamMembers(workspace, t.id, [member.id]);
      }
      onClose();
    } catch (e) {
      toast.error({ title: 'Failed to update teams', description: errorEnvelopeOf(e).message });
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} size="small" aria-label="Manage teams" overlay>
      <DialogHeader title="Manage teams" onClose={onClose} />
      <DialogBody className={a.dialogBody}>
        <SearchField
          aria-label="Search teams"
          placeholder="Search teams..."
          size={32}
          autoFocus
          value={query}
          onChange={setQuery}
        />
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 240, overflowY: 'auto' }}>
          {visible.map((t) => (
            <label key={t.id} className={a.checkRow}>
              <Checkbox
                aria-label={t.name}
                isSelected={selected.has(t.id)}
                onChange={(on) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(t.id);
                    else next.delete(t.id);
                    return next;
                  })
                }
              />
              <TeamTile icon={t.icon} size={16} />
              <span className={a.rowName}>{t.name}</span>
            </label>
          ))}
          {teams.data && visible.length === 0 && <div className={a.checkRow}>No teams</div>}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" size={28} shortcut={['esc']} onPress={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size={28} shortcut={['mod', 'enter']} isPending={pending} onPress={() => void save()}>
          Confirm
        </Button>
      </DialogFooter>
    </Modal>
  );
}
