// Boot / loading states (a): while the session and workspaces load, workspace URLs paint the shell
// frame with skeleton rows (sidebar sections use a 16 px circle + 80–160 px bar); other pages show a spinner.
import { Skeleton, Spinner } from '@agentic-crm/ui';
import * as s from './shell.css';

export function BootScreen() {
  return (
    <div className={s.bootCenter} role="status" aria-label="Loading">
      <Spinner size={20} />
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className={s.root} role="status" aria-label="Loading">
      <div className={s.row}>
        <div className={s.dock} style={{ width: 275 }}>
          <aside className={`${s.sidebar} ${s.sidebarVariant.docked}`}>
            <div className={s.header} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
              <Skeleton width={24} height={24} />
              <Skeleton width={120} height={12} />
            </div>
            <div className={s.searchRow}>
              <Skeleton width="100%" height={28} />
            </div>
            <div className={s.scroll}>
              {[88, 64, 72, 80, 96, 70].map((w) => (
                <div key={w} className={s.rowSkeleton}>
                  <Skeleton shape="circle" width={16} />
                  <Skeleton width={w} height={10} />
                </div>
              ))}
            </div>
          </aside>
        </div>
        <main className={s.main}>
          <div className={s.pageHeader} />
        </main>
      </div>
    </div>
  );
}
