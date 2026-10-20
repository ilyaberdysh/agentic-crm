// Read rendering per attribute type (C1 cells.md §2; D §2.3 field rows). Every View draws into a ValueFrame for its
// density; cells clip multi-values, fields count overflow ("+N"), selected cells stack all values.
import { cx, Spinner } from '@agentic-crm/ui';
import type { FC } from 'react';
import { useMembers, useSelectOptions, useStages } from '../data/queries';
import { countryName, formatOne, formatRelativeTime, locationField, memberName } from '../format/formatValue';
import { useFormatSettings } from '../format/locale';
import type { AttributeValue, CommitInput, CommitMeta, ViewProps } from '../types';
import {
  ActorChip,
  CheckboxMark,
  ChipRow,
  MemberChip,
  OptionTag,
  RecordChip,
  Stars,
  StatusChip,
} from '../ui/primitives';
import * as s from '../ui/ui.css';
import { currentValues, read } from '../values/shapes';
import { setPlaceholder, ValueFrame } from './frame';

function useCurrent(values: AttributeValue[]): AttributeValue[] {
  return currentValues(values);
}

function placeholderOf(props: ViewProps): string {
  return props.placeholder ?? setPlaceholder(props.attribute.title);
}

/** Text-like Views: one formatted string, single line with ellipsis. */
function TextLike({ props, align = 'start' }: { props: ViewProps; align?: 'start' | 'end' }) {
  useFormatSettings(); // re-render when the locale is pinned/changed
  const list = useCurrent(props.values);
  const text = list
    .map((v) => formatOne(props.attribute, v.value, { field: props.field, format: props.format }))
    .filter(Boolean)
    .join(', ')
    .replace(/\s*\n+\s*/g, ' ');
  return (
    <ValueFrame
      density={props.density}
      align={align}
      isEmpty={!text}
      placeholder={placeholderOf(props)}
      title={text || undefined}
    >
      <span className={s.truncate}>{text}</span>
    </ValueFrame>
  );
}

export const TextView: FC<ViewProps> = (props) => <TextLike props={props} />;
export const NumberView: FC<ViewProps> = (props) => (
  <TextLike props={props} align={props.density === 'cell' ? 'end' : 'start'} />
);
export const CurrencyView: FC<ViewProps> = (props) => (
  <TextLike props={props} align={props.density === 'cell' ? 'end' : 'start'} />
);
export const DateView: FC<ViewProps> = (props) => <TextLike props={props} />;
export const TimestampView: FC<ViewProps> = (props) => <TextLike props={props} />;
export const PersonalNameView: FC<ViewProps> = (props) => <TextLike props={props} />;

export const LocationView: FC<ViewProps> = (props) => {
  const list = useCurrent(props.values);
  const loc = list[0] ? read.location(list[0].value) : null;
  const text = loc ? locationField(loc, props.field ?? (props.density === 'cell' ? 'locality' : '')) : '';
  // Full locations outside sub-field columns show the most specific parts (record page shows "London").
  const shown =
    props.field || props.density !== 'field' || !loc
      ? text
      : [loc.locality, loc.region, loc.countryCode && countryName(loc.countryCode)].filter(Boolean).join(', ') || text;
  return (
    <ValueFrame density={props.density} isEmpty={!shown} placeholder={placeholderOf(props)} title={shown || undefined}>
      <span className={s.truncate}>{shown}</span>
    </ValueFrame>
  );
};

function commitPick(onCommit: ((next: CommitInput, meta?: CommitMeta) => void) | undefined, next: CommitInput) {
  onCommit?.(next, { via: 'pick' });
}

export const CheckboxView: FC<ViewProps> = ({ values, density, onCommit, attribute }) => {
  const list = useCurrent(values);
  const checked = list[0] ? read.checkbox(list[0].value) === true : false;
  const mark = <CheckboxMark checked={checked} />;
  return (
    <ValueFrame density={density} kind={density === 'cell' ? 'checkbox' : 'text'}>
      {onCommit ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={attribute.title}
          className={s.checkboxButton}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            commitPick(onCommit, [{ value: !checked }]);
          }}
        >
          {mark}
        </button>
      ) : (
        <span role="img" aria-label={checked ? 'Checked' : 'Unchecked'} style={{ display: 'inline-flex' }}>
          {mark}
        </span>
      )}
    </ValueFrame>
  );
};

export const RatingView: FC<ViewProps> = ({ values, density, onCommit, attribute }) => {
  const list = useCurrent(values);
  const rating = list[0] ? (read.rating(list[0].value) ?? 0) : 0;
  return (
    <ValueFrame density={density}>
      <Stars
        value={rating}
        label={attribute.title}
        onChange={onCommit ? (n) => commitPick(onCommit, n > 0 ? [{ value: n }] : []) : undefined}
      />
    </ValueFrame>
  );
};

export const StatusView: FC<ViewProps> = (props) => {
  const stages = useStages(props.attribute);
  const list = useCurrent(props.values);
  const id = list[0] ? read.pipeline(list[0].value) : null;
  const stage = id ? stages.find((st) => st.id === id) : undefined;
  return (
    <ValueFrame
      density={props.density}
      kind="chips"
      isEmpty={!id}
      placeholder={placeholderOf(props)}
      title={stage?.title}
    >
      <StatusChip stage={stage} style={props.density === 'chip' ? { paddingLeft: 0 } : undefined} />
    </ValueFrame>
  );
};

export const SelectView: FC<ViewProps> = (props) => {
  const options = useSelectOptions(props.attribute);
  const list = useCurrent(props.values);
  const ids = list.map((v) => read.select(v.value)).filter((x): x is string => Boolean(x));
  const tags = ids.map((id) => <OptionTag key={id} option={options.find((o) => o.id === id)} />);
  return (
    <ValueFrame
      density={props.density}
      kind="chips"
      expanded={props.expanded}
      isEmpty={ids.length === 0}
      placeholder={placeholderOf(props)}
    >
      {props.expanded || ids.length <= 1 ? (
        tags
      ) : (
        <ChipRow overflow={props.density === 'cell' ? 'clip' : 'count'}>{tags}</ChipRow>
      )}
    </ValueFrame>
  );
};

export const RecordReferenceView: FC<ViewProps> = (props) => {
  const list = useCurrent(props.values);
  const refs = list.map((v) => read.reference(v.value)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const shrink = props.density === 'cell' && !props.expanded && refs.length > 1;
  const chips = refs.map((r) => (
    <RecordChip
      key={r.entityInstanceId}
      entityDefinitionId={r.entityDefinitionId}
      entityInstanceId={r.entityInstanceId}
      className={shrink ? s.shrinkChip : undefined}
    />
  ));
  return (
    <ValueFrame
      density={props.density}
      kind="chips"
      expanded={props.expanded}
      isEmpty={refs.length === 0}
      placeholder={placeholderOf(props)}
    >
      {props.density === 'field' && refs.length > 1 ? <ChipRow overflow="count">{chips}</ChipRow> : chips}
    </ValueFrame>
  );
};

export const ActorReferenceView: FC<ViewProps> = (props) => {
  const list = useCurrent(props.values);
  const actors = list.map((v) => read.actor(v.value)).filter((a): a is NonNullable<typeof a> => Boolean(a));
  const members = useMembers(actors.some((a) => a.referencedActorType === 'workspace-member'));
  const chips = actors.map((a) =>
    a.referencedActorType === 'workspace-member' ? (
      <MemberChip key={a.referencedActorId} member={members.find((m) => m.id === a.referencedActorId)} />
    ) : (
      <ActorChip key={a.referencedActorId} type={a.referencedActorType} />
    ),
  );
  return (
    <ValueFrame
      density={props.density}
      kind="chips"
      expanded={props.expanded}
      isEmpty={actors.length === 0}
      placeholder={placeholderOf(props)}
    >
      {props.density === 'field' && chips.length > 1 ? <ChipRow overflow="count">{chips}</ChipRow> : chips}
    </ValueFrame>
  );
};

type LinkKind = 'email' | 'domain' | 'phone';

function hrefOf(kind: LinkKind, text: string): string {
  if (kind === 'email') return `mailto:${text}`;
  if (kind === 'phone') return `tel:${text.replace(/[^\d+]/g, '')}`;
  return `https://${text}`;
}

function LinkListView({ props, kind }: { props: ViewProps; kind: LinkKind }) {
  const list = useCurrent(props.values);
  const texts = list
    .map((v) =>
      kind === 'email'
        ? read.email(v.value)?.originalEmailAddress
        : kind === 'domain'
          ? read.domain(v.value)?.normalizedDomain
          : read.phone(v.value)?.originalPhoneNumber,
    )
    .filter((t): t is string => Boolean(t));
  const shrink = props.density === 'cell' && !props.expanded && texts.length > 1;
  // Table cells draw phone numbers as plain text (C1 cells.md §2); record fields as links (D overview).
  const plain = kind === 'phone' && props.density === 'cell';
  const chips = texts.map((t) =>
    plain ? (
      <span key={t} className={cx(s.truncate, shrink && s.shrinkChip)} style={{ paddingInline: 4, lineHeight: '22px' }}>
        {t}
      </span>
    ) : (
      <a
        key={t}
        href={hrefOf(kind, t)}
        target={kind === 'domain' ? '_blank' : undefined}
        rel={kind === 'domain' ? 'noreferrer noopener' : undefined}
        className={cx(s.linkChip, shrink && s.shrinkChip)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <span className={s.linkChipText}>{t}</span>
      </a>
    ),
  );
  return (
    <ValueFrame
      density={props.density}
      kind="chips"
      expanded={props.expanded}
      isEmpty={texts.length === 0}
      placeholder={placeholderOf(props)}
      title={texts.join(', ') || undefined}
    >
      {props.density === 'field' && chips.length > 1 ? <ChipRow overflow="count">{chips}</ChipRow> : chips}
    </ValueFrame>
  );
}

export const EmailView: FC<ViewProps> = (props) => <LinkListView props={props} kind="email" />;
export const DomainView: FC<ViewProps> = (props) => <LinkListView props={props} kind="domain" />;
export const PhoneView: FC<ViewProps> = (props) => <LinkListView props={props} kind="phone" />;

/** Read-only computed interactions: relative "When" (default) or the "With" member; empty → "No contact". */
export const InteractionView: FC<ViewProps> = (props) => {
  const list = useCurrent(props.values);
  const value = list[0] ? read.interaction(list[0].value) : null;
  const members = useMembers(props.field === 'owner_membership_id');
  if (props.field === 'owner_membership_id') {
    const member = value?.ownerMembershipId ? members.find((m) => m.id === value.ownerMembershipId) : undefined;
    return (
      <ValueFrame density={props.density} kind="chips" isEmpty={!member} emptyText="No contact">
        <MemberChip member={member} />
      </ValueFrame>
    );
  }
  const text = value
    ? props.format?.datetimeConfiguration?.displayType === 'absolute'
      ? formatOne(props.attribute, value, { field: 'interacted_at', format: props.format })
      : formatRelativeTime(value.interactedAt)
    : '';
  return (
    <ValueFrame density={props.density} isEmpty={!value} emptyText="No contact" title={value?.interactedAt}>
      <span className={s.truncate}>{text}</span>
    </ValueFrame>
  );
};

/** Small pending indicator for field rows ("Validating change", D §2.3). */
export function PendingIndicator({ isPending }: { isPending: boolean }) {
  if (!isPending) return null;
  return (
    <span className={s.pendingSpinner} title="Validating change">
      <Spinner size={12} />
    </span>
  );
}

export { memberName };
