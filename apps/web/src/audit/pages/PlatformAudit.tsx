import AuditLog from './AuditLog';

/** The whole platform's audit log (Super Admins). */
export default function PlatformAudit() {
  return <AuditLog scope="platform" />;
}
