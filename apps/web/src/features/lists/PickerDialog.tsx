// Command-palette dialog frame of the add-to-list flows:
// add-to-list-duplicates.png, D/choose-list): header (title or breadcrumb with ‹ back) + ×, optional search row,
// sections of keyboard-navigable rows (↑ / ↓ move, ↵ picks; hover moves the highlight), footer "↑ ↓ Navigate" and
// the primary action acting on the highlighted row.
import { Button, IconButton, Kbd, Modal } from '@agentic-crm/ui';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Heading } from 'react-aria-components';
import * as s from './lists.css';

export interface PickerItem {
  key: string;
  icon: ReactNode;
  label: ReactNode;
  /** Secondary text after the label ("Stage: ● Lead"). */
  detail?: ReactNode;
  trailing?: ReactNode;
  onSelect: () => void;
  testId?: string;
}

export interface PickerSection {
  key: string;
  label: string;
  /** "RECORDS" / "ACTIONS" in the record picker; "Lists" / "Duplicates" elsewhere. */
  uppercase?: boolean;
  items: PickerItem[];
  /** Shown under the label when the section has no items. */
  empty?: string;
}

export interface PickerDialogProps {
  label: string;
  title: ReactNode;
  onBack?: () => void;
  onClose: () => void;
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  sections: PickerSection[];
  primaryLabel: string;
  /** Fixed panel height (Choose record: 528 frame); default grows with the content. */
  height?: number;
  testId?: string;
}

export function PickerDialog({
  label,
  title,
  onBack,
  onClose,
  search,
  sections,
  primaryLabel,
  height,
  testId,
}: PickerDialogProps) {
  const items = useMemo(() => sections.flatMap((sec) => sec.items), [sections]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchValue = search?.value ?? '';
  useEffect(() => setActive(0), [searchValue]);
  useEffect(() => {
    if (active >= items.length) setActive(Math.max(0, items.length - 1));
  }, [active, items.length]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = () => items[active]?.onSelect();
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      if (n === 0) return;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      pick();
    }
  };

  let index = -1;
  return (
    <Modal
      isOpen
      onOpenChange={(open) => !open && onClose()}
      size={808}
      aria-label={label}
      style={height ? { height } : undefined}
    >
      <div className={s.picker} onKeyDown={onKeyDown} data-testid={testId}>
        <div className={s.pickerHeader}>
          {onBack && <IconButton icon="chevronLeft" aria-label="Back" size={20} variant="ghost" onPress={onBack} />}
          <Heading slot="title" className={s.crumbs}>
            {title}
          </Heading>
          <IconButton icon="close" aria-label="Close" size={28} onPress={onClose} />
        </div>
        {search && (
          <div className={s.searchRow}>
            <input
              className={s.searchInput}
              role="combobox"
              aria-expanded
              aria-controls="lists-picker-list"
              aria-label={search.placeholder.replace(/…|\.\.\.$/, '')}
              placeholder={search.placeholder}
              value={search.value}
              autoFocus
              onChange={(e) => search.onChange(e.target.value)}
            />
          </div>
        )}
        <div
          className={s.pickerList}
          id="lists-picker-list"
          role="listbox"
          aria-label={label}
          ref={listRef}
          // Without a search field the list itself takes the keyboard.
          tabIndex={search ? -1 : 0}
          autoFocus={!search}
        >
          {sections.map((section, sectionIndex) => (
            <div key={section.key} role="group" aria-label={section.label} style={{ display: 'contents' }}>
              <div
                className={`${s.pickerLabel} ${section.uppercase ? s.pickerLabelUpper : s.pickerLabelTitle}`}
                data-later={sectionIndex > 0 || undefined}
              >
                {section.label}
              </div>
              {section.items.length === 0 && section.empty && <div className={s.pickerEmpty}>{section.empty}</div>}
              {section.items.map((item) => {
                index += 1;
                const i = index;
                const isActive = i === active;
                return (
                  <div
                    key={item.key}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={-1}
                    className={s.pickerRow}
                    data-active={isActive || undefined}
                    data-testid={item.testId}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => item.onSelect()}
                    onKeyDown={() => undefined}
                  >
                    {item.icon}
                    <span className={s.rowTitle}>{item.label}</span>
                    {item.detail && <span className={s.rowMuted}>{item.detail}</span>}
                    {item.trailing && <span className={s.rowTrailing}>{item.trailing}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className={s.pickerFooter}>
          <span className={s.navHint}>
            <Kbd keys={['up']} size={18} />
            <Kbd keys={['down']} size={18} />
            Navigate
          </span>
          <Button variant="primary" size={28} shortcut={['enter']} isDisabled={items.length === 0} onPress={pick}>
            {primaryLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Breadcrumb pieces for picker / form headers: "Choose record / <record>". */
export function Crumbs({ parts }: { parts: ReactNode[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span className={s.crumbSep}>/</span>}
          {part}
        </span>
      ))}
    </>
  );
}
