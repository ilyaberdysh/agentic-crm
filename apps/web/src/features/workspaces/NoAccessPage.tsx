// Unknown or inaccessible workspace slug: standalone page, no
// sidebar — logo, red warning triangle + "You don't have access to this workspace!", footer with Sign out.
import { Icon } from '@agentic-crm/ui';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { AuthLayout } from '../auth/AuthLayout';
import * as s from '../auth/auth.css';

export function NoAccessPage() {
  useDocumentTitle(null);
  return (
    <AuthLayout signOut contentClassName={s.status}>
      <Icon icon="warning" size={24} color="negative" />
      <div className={s.statusCritical}>You don't have access to this workspace!</div>
    </AuthLayout>
  );
}
