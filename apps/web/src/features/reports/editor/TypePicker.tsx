// Step 1 of a new report (H README §2.3; evidence editor-type-picker.png): "What do you want to report on?" with the
// five types in two groups and the documentation card at the bottom.

import type { ReportType } from '@agentic-crm/contracts';
import { Icon } from '@agentic-crm/ui';
import { brand } from '../../../lib/brand';
import { DocumentIcon } from '../icons';
import { REPORT_TYPES } from '../reportModel';
import * as e from './editor.css';

export function TypePicker({ onPick }: { onPick: (type: ReportType) => void }) {
  const groups = [
    { title: 'Create your own', items: REPORT_TYPES.filter((t) => t.group === 'own') },
    { title: 'Pipeline reports', items: REPORT_TYPES.filter((t) => t.group === 'pipeline') },
  ];
  return (
    <div className={e.pickerWrap} data-testid="type-picker">
      <h2 className={e.pickerHeading}>What do you want to report on?</h2>
      <p className={e.pickerSub}>Select the type of report you want to build</p>
      {groups.map((g) => (
        <div key={g.title}>
          <p className={e.pickerGroup}>{g.title}</p>
          {g.items.map((t) => (
            <button
              key={t.id}
              type="button"
              className={e.typeCard}
              onClick={() => onPick(t.id)}
              data-testid={`type-card-${t.id}`}
            >
              <span className={e.typeCardIcon}>
                <Icon icon={t.icon} size={16} />
              </span>
              <span className={e.typeCardText}>
                <span className={e.typeCardTitle}>{t.title}</span>
                <span className={e.typeCardDescription}>{t.description}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
      <div className={e.resources}>
        <p className={e.pickerGroup}>Helpful resources</p>
        <a className={e.resourceCard} href={brand.supportUrl} target="_blank" rel="noreferrer">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={e.typeCardIcon} style={{ width: 24, height: 24 }}>
              <Icon icon={DocumentIcon} size={14} />
            </span>
            Documentation
          </span>
          <span className={e.typeCardDescription}>Learn to build powerful reports</span>
        </a>
      </div>
    </div>
  );
}
