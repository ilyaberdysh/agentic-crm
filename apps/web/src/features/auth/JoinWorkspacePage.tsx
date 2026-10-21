// `/auth/join/$workspaceSlug` — invite acceptance (K legacy-welcome §9): "Almost there!", the invite card, then
// "Not yet" | "Accept". The invite token (invite id) comes from the link's `invite` parameter.
import { Avatar, Button, CheckCircleFilled, Icon, LoadingState, toast } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { acceptInvite, myInvitesQuery } from '../../data/invites';
import { errorEnvelopeOf } from '../../data/trpc';
import { useWorkspaces } from '../../data/workspaces';
import { brand } from '../../lib/brand';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { AuthLayout } from './AuthLayout';
import * as s from './auth.css';

export function JoinWorkspacePage({ workspaceSlug, inviteId }: { workspaceSlug: string; inviteId?: string }) {
  useDocumentTitle('Join workspace');
  const navigate = useNavigate();
  const invites = useQuery(myInvitesQuery());
  const workspaces = useWorkspaces();
  const [pending, setPending] = useState(false);
  const invite = invites.data?.find((i) => (inviteId ? i.id === inviteId : i.workspace.slug === workspaceSlug));
  const member = workspaces.find((w) => w.slug === workspaceSlug);

  // Already a member: straight into the workspace.
  useEffect(() => {
    if (!invite && member) void navigate({ to: '/$workspaceSlug', params: { workspaceSlug }, replace: true });
  }, [invite, member, navigate, workspaceSlug]);

  if (invites.isPending) {
    return (
      <AuthLayout signOut contentClassName={s.status}>
        <LoadingState />
      </AuthLayout>
    );
  }

  if (!invite) {
    return (
      <AuthLayout signOut contentClassName={s.status}>
        <Icon icon="warning" size={24} color="negative" />
        <div className={s.statusCritical}>We can't find that workspace</div>
      </AuthLayout>
    );
  }

  async function accept() {
    if (!invite) return;
    setPending(true);
    try {
      const workspace = await acceptInvite({ inviteId: invite.id });
      await navigate({ to: '/$workspaceSlug', params: { workspaceSlug: workspace.slug } });
    } catch (error) {
      setPending(false);
      toast.error({
        title: 'An error occurred while trying to join this workspace',
        description: errorEnvelopeOf(error).message,
      });
    }
  }

  return (
    <AuthLayout signOut wide>
      <h1 className={s.title}>Almost there!</h1>
      {brand.acceptableUseUrl && (
        <p className={s.subtitle}>
          By accepting this invite, you agree to
          <br />
          <a className={s.link} href={brand.acceptableUseUrl} target="_blank" rel="noreferrer">
            {brand.name}'s acceptable use terms
          </a>
        </p>
      )}
      <div className={s.inviteCard}>
        <Avatar
          kind="workspace"
          name={invite.workspace.name}
          src={invite.workspace.logoUrl}
          seed={invite.workspace.id}
          size={28}
        />
        <div className={s.inviteText}>
          <span className={s.inviteName}>{invite.workspace.name}</span>
          <span className={s.inviteUrl}>
            {window.location.host}/{invite.workspace.slug}
          </span>
        </div>
        <CheckCircleFilled size={16} style={{ color: 'var(--ar-color-content-accent)' }} />
      </div>
      <div className={s.buttonRow}>
        <Button variant="secondary" size={32} onPress={() => navigate({ to: '/workspaces' })}>
          Not yet
        </Button>
        <Button variant="primary" size={32} isPending={pending} onPress={accept}>
          {pending ? 'Joining workspace...' : 'Accept'}
        </Button>
      </div>
    </AuthLayout>
  );
}
