import type { TFunction } from 'i18next';
import type { RoleChoice } from '@ledgernest/shared';
import type { MemberRole } from './types';

export const memberRoleLabel = (r: MemberRole, t: TFunction) => (r.type === 'built_in' ? t(`roles.${r.key}`) : (r.name ?? t('team.roles.customRole')));

/** Translation key for a permission, e.g. users.invite → permissions.users_invite */
export const permissionKey = (p: string) => `permissions.${p.replace(/\./g, '_')}`;
export const areaKey = (area: string) => `permissions.areas.${area}`;

/** Encodes a role choice as a select value: "b:viewer" or "c:<uuid>". */
export const encodeChoice = (c: RoleChoice) => ('builtInRole' in c ? `b:${c.builtInRole}` : `c:${c.customRoleId}`);
export const decodeChoice = (v: string): RoleChoice => (v.startsWith('b:') ? { builtInRole: v.slice(2) as never } : { customRoleId: v.slice(2) });

/** The current role of a member as a select value. */
export const choiceOf = (r: MemberRole) => (r.type === 'built_in' ? `b:${r.key}` : `c:${r.id}`);
