// "Invite members" dialog (J workspace-admin): "Send Invite to..." email
// chips, "Invite as" (Member — can edit / Admin — full access), "Add to team (optional)", "Send Invites ⌘↵". Client
// checks: at least one and at most 10 addresses, valid, unique; the server rejects members and pending invites.
import { Button, DialogFooter, DialogHeader, Icon, Modal, Select, SelectItem, toast } from '@agentic-crm/ui';
import { useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { errorEnvelopeOf, httpStatusOf } from '../../../data/trpc';
import { useWorkspace } from '../../shell/workspaceContext';
import { submitOnModEnter } from '../objects/parts';
import { EMAIL_PATTERN, inviteMembers, splitEmails } from './data';
import * as m from './members.css';
import { TeamSelect } from './TeamSelect';

type Role = 'member' | 'admin';
const ROLES: { id: Role; label: string; detail: string }[] = [
  { id: 'member', label: 'Member', detail: 'can edit' },
  { id: 'admin', label: 'Admin', detail: 'full access' },
];

/** Error copy of the invite flow (client checks and server codes). Null = valid. */
export function inviteProblem(emails: string[]): string | null {
  if (emails.length === 0) return 'Provide at least one email to invite';
  if (emails.length > 10) return 'Provide at most 10 emails to invite';
  const seen = new Set<string>();
  for (const e of emails) {
    if (!EMAIL_PATTERN.test(e)) return 'This email looks invalid';
    if (seen.has(e.toLowerCase())) return 'This email is already in the list';
    seen.add(e.toLowerCase());
  }
  return null;
}

export function InviteDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const { workspace } = useWorkspace();
  const [chips, setChips] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    onOpenChange(false);
    setChips([]);
    setText('');
    setRole('member');
    setTeamIds([]);
    setError(null);
  };

  const commit = (raw: string) => {
    const parts = splitEmails(raw);
    if (parts.length === 0) return chips;
    const next = [...chips, ...parts];
    setChips(next);
    setText('');
    setError(null);
    return next;
  };

  async function submit() {
    const emails = [...chips, ...splitEmails(text)];
    const problem = inviteProblem(emails);
    if (problem) {
      if (text) commit(text);
      setError(problem);
      return;
    }
    setPending(true);
    try {
      await inviteMembers(workspace, {
        invites: emails.map((emailAddress) => ({
          emailAddress,
          accessLevel: role,
          ...(teamIds.length > 0 ? { teamIds } : {}),
        })),
      });
      const [first, ...rest] = emails;
      toast.success({
        title: (
          <>
            <b>{first}</b>
            {rest.length > 0 ? ` +${rest.length}` : ''} {emails.length === 1 ? 'was' : 'were'} invited
          </>
        ),
      });
      close();
    } catch (e) {
      const { code, message } = errorEnvelopeOf(e);
      if (code === 'ALREADY_A_MEMBER') setError('This email is already in your workspace');
      else if (code === 'INVITE_ALREADY_EXISTS') setError('This email has already been invited');
      else if (httpStatusOf(e) === 400 && message) setError(message);
      else setError(message ?? 'Failed to send invites');
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      size={708}
      aria-label="Invite members"
      overlay
    >
      <DialogHeader title="Invite members" icon={<Icon icon="invite" size={16} />} onClose={close} />
      <div className={m.inviteBody} onKeyDown={submitOnModEnter(() => void submit())}>
        <div>
          <span className={m.fieldLabel} id="invite-to-label">
            Send Invite to ...
          </span>
          <div
            className={m.emailBox}
            data-invalid={error ? true : undefined}
            onClick={() => inputRef.current?.focus()}
            onKeyDown={() => undefined}
          >
            {chips.map((email, i) => (
              <span
                key={`${email}:${i}`}
                className={m.emailChip}
                data-invalid={!EMAIL_PATTERN.test(email) || undefined}
              >
                {email}
                <AriaButton
                  className={m.chipRemove}
                  aria-label={`Remove ${email}`}
                  onPress={() => setChips((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Icon icon="close" size={12} />
                </AriaButton>
              </span>
            ))}
            <input
              ref={inputRef}
              autoFocus
              className={m.emailInput}
              aria-labelledby="invite-to-label"
              placeholder={chips.length === 0 ? 'example@email.com' : ''}
              value={text}
              onChange={(e) => {
                const v = e.target.value;
                if (/[\s,;]$/.test(v) && v.trim()) commit(v);
                else {
                  setText(v);
                  setError(null);
                }
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                if (/[\s,;]/.test(pasted.trim())) {
                  e.preventDefault();
                  commit(text + pasted);
                }
              }}
              onBlur={() => text.trim() && commit(text)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey) && text.trim()) {
                  e.preventDefault();
                  commit(text);
                } else if (e.key === 'Backspace' && !text && chips.length > 0) {
                  setChips((prev) => prev.slice(0, -1));
                }
              }}
            />
          </div>
          {error && (
            <p className={m.errorLine} role="alert">
              {error}
            </p>
          )}
        </div>
        <Select<(typeof ROLES)[number]>
          label="Invite as"
          aria-label="Invite as"
          size={32}
          items={ROLES}
          selectedKey={role}
          onSelectionChange={(k) => setRole(String(k) as Role)}
          renderValue={(item) => item.label}
          menuWidth="trigger"
        >
          {(item) => (
            <SelectItem id={item.id} textValue={item.label}>
              <span className={m.roleOption}>{item.label}</span> <span className={m.roleDetail}>• {item.detail}</span>
            </SelectItem>
          )}
        </Select>
        <div>
          <span className={m.fieldLabel}>
            Add to team <span className={m.optionalHint}>(optional)</span>
          </span>
          <TeamSelect value={teamIds} onChange={setTeamIds} />
        </div>
      </div>
      <DialogFooter>
        <Button
          variant="primary"
          size={28}
          shortcut={['mod', 'enter']}
          isPending={pending}
          onPress={() => void submit()}
        >
          {pending ? 'Sending invites...' : 'Send Invites'}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
