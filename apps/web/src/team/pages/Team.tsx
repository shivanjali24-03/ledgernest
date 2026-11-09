import { useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import { Building2 } from 'lucide-react';
import { Card, EmptyState, PageHeader } from '../../ui/Kit';
import { useTeamApi } from '../useTeamApi';
import Tabs from '../../ui/Tabs';
import { useInvitations, useMembers } from '../queries';
import InvitationsPanel from './InvitationsPanel';
import MembersPanel from './MembersPanel';
import RolesPanel from './RolesPanel';

type Tab = 'members' | 'invitations' | 'roles';

/** Users & roles: an organisation's own team management. */
export default function Team() {
  const { t } = useTranslation();
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const canInvite = session.permissions.has('users.invite');
  const canViewRoles = session.permissions.has('roles.view');
  const tab = (params.get('tab') as Tab | null) ?? 'members';
  const api = useTeamApi();
  const members = useMembers();
  const invitations = useInvitations();

  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('team.title')}
          description={t('team.description')}
          actions={
            canInvite ? (
              <Button icon={<UserPlus className="size-4" />} onClick={() => set({ tab: 'invitations', invite: '1' })}>
                {t('team.invite.button')}
              </Button>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Tabs<Tab>
          label={t('team.title')}
          value={tab}
          onChange={(v) => set({ tab: v === 'members' ? null : v, invite: null })}
          tabs={[
            { value: 'members', label: t('team.tabs.members'), count: members.data?.length },
            { value: 'invitations', label: t('team.tabs.invitations'), count: invitations.data?.filter((i) => !i.expired).length },
            ...(canViewRoles ? [{ value: 'roles' as const, label: t('team.tabs.roles') }] : []),
          ]}
        />
      </motion.div>
      <motion.div variants={fadeUp} role="tabpanel">
        {tab === 'members' && <MembersPanel />}
        {tab === 'invitations' && <InvitationsPanel inviteOpen={params.get('invite') === '1'} onInviteOpen={(open) => set({ invite: open ? '1' : null })} />}
        {tab === 'roles' && canViewRoles && <RolesPanel />}
      </motion.div>
    </motion.div>
  );
}
