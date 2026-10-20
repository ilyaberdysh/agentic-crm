// Relationship layout (J attribute-dialogs §6; raw J s12-dlg-relationship, s24-dd-rel_cardinality, c-rel-error,
// s31-edit-…Gadgets): info banner, "Configure relationship", two cards joined by a line with the cardinality select
// in the middle. Left = this object (fixed) + the name of its attribute; right = the other object (picker; any active
// object incl. this one) + the name of the reverse attribute. Placeholders follow the cardinality (plural on a
// "many" side). In edit mode the far-side object is fixed.
import type { EntityDefinition } from '@agentic-crm/contracts';
import { Icon, Menu, MenuItem, MenuList, MenuTrigger, PopoverPanel, TextInput } from '@agentic-crm/ui';
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { brand } from '../../../../lib/brand';
import { ObjectTile } from '../parts';
import * as s from './attributes.css';
import { CARDINALITIES, type Cardinality, cardinalityFlags } from './formModel';

export interface RelationshipValue {
  targetObjectId: string | null;
  cardinality: Cardinality;
  thisTitle: string;
  otherTitle: string;
}

export function RelationshipForm({
  object,
  objects,
  value,
  onChange,
  mode,
  errors,
  cardinalityLocked,
}: {
  object: EntityDefinition;
  objects: readonly EntityDefinition[];
  value: RelationshipValue;
  onChange: (next: RelationshipValue) => void;
  mode: 'create' | 'edit';
  errors: { thisTitle?: boolean; otherTitle?: boolean; targetObject?: boolean };
  /** The server cannot change cardinality after creation yet. */
  cardinalityLocked?: boolean;
}) {
  const target = objects.find((o) => o.id === value.targetObjectId) ?? null;
  const flags = cardinalityFlags(value.cardinality);
  const leftPlaceholder = target ? `E.g. ${flags.thisMulti ? target.pluralNoun : target.singularNoun}` : '';
  const rightPlaceholder = `E.g. ${flags.otherMulti ? object.pluralNoun : object.singularNoun}`;
  const [initialCardinality] = useState(value.cardinality);
  const [hinted, setHinted] = useState<Cardinality | null>(null);

  return (
    <>
      {mode === 'create' && (
        <div className={s.infoBanner}>
          <Icon icon="info" size={14} className={s.bannerIcon} />
          <span>
            Changes on one side of the relationship will be reflected on the other side as well.{' '}
            <a className={s.bannerLink} href={brand.supportUrl} target="_blank" rel="noreferrer">
              Learn more about attributes
            </a>
          </span>
        </div>
      )}
      <div className={mode === 'create' ? `${s.field} ${s.relConfigure}` : s.field}>
        <span className={`${s.fieldLabel} ${s.relConfigureLabel}`}>Configure relationship</span>
        <div className={s.relLayout}>
          <div className={s.relCard}>
            <div className={s.relCardHeader}>
              <ObjectTile object={object} />
              <span className={s.fieldButtonValue}>{object.pluralNoun}</span>
            </div>
            <div className={s.relCardBody}>
              <TextInput
                label="Associated attribute name"
                size={34}
                placeholder={leftPlaceholder}
                value={value.thisTitle}
                autoFocus={mode === 'create'}
                onChange={(thisTitle) => onChange({ ...value, thisTitle })}
                isInvalid={errors.thisTitle}
              />
            </div>
          </div>
          <div className={s.relCenter}>
            <div className={s.relLine} />
            <MenuTrigger>
              <AriaButton
                className={`${s.cardinalityButton} ${s.relSelect}`}
                aria-label="Relationship type"
                isDisabled={cardinalityLocked}
              >
                {CARDINALITIES.find((c) => c.id === value.cardinality)?.label}
                <Icon icon="info" size={12} style={{ color: 'var(--ar-color-content-tertiary)' }} />
                <Icon icon="chevronDown" size={14} className={s.chevron} />
              </AriaButton>
              <PopoverPanel placement="bottom start" offset={4} className={s.hintPopover}>
                <div className={s.hintRow}>
                  <div className={s.hintMenu}>
                    <MenuList
                      aria-label="Relationship type"
                      selectionMode="single"
                      selectedKeys={[value.cardinality]}
                      onAction={(k) => onChange({ ...value, cardinality: k as Cardinality })}
                    >
                      {CARDINALITIES.map((c) => (
                        <MenuItem
                          key={c.id}
                          id={c.id}
                          onHoverStart={() => setHinted(c.id)}
                          onFocus={() => setHinted(c.id)}
                        >
                          {c.label}
                        </MenuItem>
                      ))}
                    </MenuList>
                  </div>
                  <CardinalityHint cardinality={hinted ?? value.cardinality} />
                </div>
              </PopoverPanel>
            </MenuTrigger>
          </div>
          <div className={s.relCard}>
            {mode === 'create' ? (
              <MenuTrigger>
                <AriaButton
                  className={s.relCardPicker}
                  aria-label="Related object"
                  data-invalid={errors.targetObject || undefined}
                >
                  {target ? <ObjectTile object={target} /> : null}
                  <span className={s.fieldButtonValue}>{target?.pluralNoun ?? 'Select an object'}</span>
                  <Icon icon="chevronDown" size={14} className={s.chevron} />
                </AriaButton>
                <Menu
                  aria-label="Related object"
                  width={260}
                  placement="bottom end"
                  selectionMode="single"
                  selectedKeys={value.targetObjectId ? [value.targetObjectId] : []}
                  onAction={(k) => onChange({ ...value, targetObjectId: String(k) })}
                >
                  {objects.map((o) => (
                    <MenuItem key={o.id} id={o.id} icon={<ObjectTile object={o} />}>
                      {o.pluralNoun}
                    </MenuItem>
                  ))}
                </Menu>
              </MenuTrigger>
            ) : (
              <AriaButton className={s.relCardPicker} isDisabled aria-label="Related object">
                {target ? <ObjectTile object={target} /> : null}
                <span className={s.fieldButtonValue}>{target?.pluralNoun ?? 'Unknown object'}</span>
                <Icon icon="chevronDown" size={14} className={s.chevron} />
              </AriaButton>
            )}
            <div className={s.relCardBody}>
              <TextInput
                label="Associated attribute name"
                size={34}
                placeholder={rightPlaceholder}
                value={value.otherTitle}
                onChange={(otherTitle) => onChange({ ...value, otherTitle })}
                isInvalid={errors.otherTitle}
              />
            </div>
          </div>
        </div>
        {mode === 'edit' && value.cardinality !== initialCardinality && (
          <p className={s.warning}>
            Changing the relationship type is a one-way operation and may require API integrations to be updated.
          </p>
        )}
      </div>
    </>
  );
}

/** Dark side card next to the cardinality menu: a two-box diagram, the name and the explanation (s24-dd-rel_cardinality). */
function CardinalityHint({ cardinality }: { cardinality: Cardinality }) {
  const def = CARDINALITIES.find((c) => c.id === cardinality) ?? CARDINALITIES[1];
  if (!def) return null;
  const flags = cardinalityFlags(cardinality);
  return (
    <div className={s.hintCard} aria-hidden="true">
      <div className={s.hintDiagram}>
        <div className={s.hintStack} data-many={flags.otherMulti || undefined}>
          <span className={s.hintBox}>{def.example[0]}</span>
        </div>
        <span className={s.hintLine} />
        <div className={s.hintStack} data-many={flags.thisMulti || undefined}>
          <span className={s.hintBox}>{def.example[1]}</span>
        </div>
      </div>
      <div className={s.hintTitle}>{def.label}</div>
      <div className={s.hintText}>{def.description}</div>
    </div>
  );
}
