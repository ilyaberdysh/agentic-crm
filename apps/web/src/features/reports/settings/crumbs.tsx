// Page-header crumb of Settings → Dashboards: the dashboards glyph (four tiles, as on the index rows) and the label.
import { Icon } from '@agentic-crm/ui';
import * as shell from '../../shell/shell.css';
import { DashboardTileIcon } from '../icons';

export const dashboardsCrumbIcon = <Icon icon={DashboardTileIcon} size={16} className={shell.crumbIcon} />;
