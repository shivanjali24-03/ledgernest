import AuditLog from './AuditLog';

/** An organisation's own audit log (Owners, Admins and Auditors). */
export default function OrganizationAudit() {
  return <AuditLog scope="organization" />;
}
