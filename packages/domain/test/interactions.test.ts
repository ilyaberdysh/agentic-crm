// Interaction attributes and connection strength (BACKLOG 7.05; A README §4.14, attribute-types §3.16; decision C.4
// #12): first / last email, first / last / next calendar and the combined first / last / next interaction written as
// read-only system values through the write path (with history), the roll-forward when a meeting starts, and the
// per-member connection strength with its record attributes.
import { describe, expect, it } from 'vitest';
import { bucketOf, HALF_LIFE_DAYS } from '../src/index.ts';
import {
  type EmailFixture,
  emailFixture,
  injectEvent,
  injectMessage,
  iso,
  memberWithMailbox,
  recordsByValue,
  valuesOf,
} from './email-fixtures.ts';
import { domain, expectCode } from './support/harness.ts';

async function interaction(f: EmailFixture, object: string, id: string, slug: string) {
  const values = await valuesOf(f, object, id, slug);
  return (values[0]?.value ?? null) as {
    interactionType: string;
    interactedAt: string;
    interactionHeaderId: string;
    ownerMembershipId: string | null;
    mailboxId: string | null;
  } | null;
}

describe('interaction attributes', () => {
  it('maintains first / last / next email, calendar and combined interactions', async () => {
    const f = await emailFixture({ recordCreation: 'all' });
    const jane = `jane@northwind-${f.tag}.com`;
    await injectMessage(f.ada, {
      subject: 'First',
      from: { emailAddress: jane },
      to: [{ emailAddress: f.ada.address }],
      sentAt: iso(-100),
    });
    const [person] = await recordsByValue(f, 'people', jane);
    const [company] = await recordsByValue(f, 'companies', `northwind-${f.tag}.com`);
    const id = person as string;
    const firstEmail = await interaction(f, 'people', id, 'first_email_interaction');
    expect(firstEmail).toMatchObject({
      interactionType: 'email',
      ownerMembershipId: f.memberId,
      mailboxId: f.ada.mailboxId,
    });
    expect(Date.parse(firstEmail?.interactedAt as string)).toBeCloseTo(Date.parse(iso(-100)), -4);
    await injectMessage(f.ada, {
      subject: 'Second',
      from: { emailAddress: f.ada.address },
      to: [{ emailAddress: jane }],
      sentAt: iso(-50),
    });
    await injectEvent(f.ada, {
      icalUid: `past-${f.tag}`,
      title: 'Call',
      start: { dateTime: iso(-70) },
      end: { dateTime: iso(-69) },
      attendees: [
        { emailAddress: f.ada.address, status: 'accepted', isOrganizer: true },
        { emailAddress: jane, status: 'accepted' },
      ],
    });
    await injectEvent(f.ada, {
      icalUid: `next-${f.tag}`,
      title: 'Next call',
      start: { dateTime: iso(30) },
      end: { dateTime: iso(31) },
      attendees: [
        { emailAddress: f.ada.address, status: 'accepted', isOrganizer: true },
        { emailAddress: jane, status: 'pending' },
      ],
    });
    const at = async (slug: string) => {
      const v = await interaction(f, 'people', id, slug);
      return v
        ? { type: v.interactionType, hours: Math.round((Date.parse(v.interactedAt) - Date.now()) / 3_600_000) }
        : null;
    };
    expect(await at('first_email_interaction')).toEqual({ type: 'email', hours: -100 });
    expect(await at('last_email_interaction')).toEqual({ type: 'email', hours: -50 });
    expect(await at('first_calendar_interaction')).toEqual({ type: 'meeting', hours: -70 });
    expect(await at('last_calendar_interaction')).toEqual({ type: 'meeting', hours: -70 });
    expect(await at('next_calendar_interaction')).toEqual({ type: 'meeting', hours: 30 });
    expect(await at('first_interaction')).toEqual({ type: 'email', hours: -100 });
    expect(await at('last_interaction')).toEqual({ type: 'email', hours: -50 });
    expect(await at('next_interaction')).toEqual({ type: 'meeting', hours: 30 });
    // Companies get them too (participants' companies).
    expect((await interaction(f, 'companies', company as string, 'next_interaction'))?.interactionType).toBe('meeting');
    // Read-only for members.
    await expectCode(
      domain.records.update(f.ctx, {
        entityDefinitionId: 'people',
        entityInstanceId: id,
        values: { last_interaction: [{ value: { interactionType: 'email', interactedAt: iso(0) } }] },
      }),
      'ATTRIBUTE_READ_ONLY',
      400,
    );

    // When the next meeting has started it becomes the last calendar interaction (roll-forward job).
    const record = { entityDefinitionId: f.people, entityInstanceId: id };
    await domain.interactions.refresh(f.sys, [record], iso(32));
    expect(await interaction(f, 'people', id, 'next_calendar_interaction')).toBeNull();
    expect(
      Math.round(
        (Date.parse((await interaction(f, 'people', id, 'last_interaction'))?.interactedAt as string) - Date.now()) /
          3_600_000,
      ),
    ).toBe(30);
    // Values are history: the previous last interaction was retired, not overwritten.
    const history = await domain.values.history(f.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: id,
      attributeDefinitionId: 'last_interaction',
    });
    expect(history.values.length).toBeGreaterThan(1);
  });

  it('removing the mailbox clears interactions that came from it', async () => {
    const f = await emailFixture({ recordCreation: 'all' });
    const jane = `jane@northwind-${f.tag}.com`;
    await injectMessage(f.ada, {
      subject: 'Hi',
      from: { emailAddress: jane },
      to: [{ emailAddress: f.ada.address }],
      sentAt: iso(-1),
    });
    const [person] = await recordsByValue(f, 'people', jane);
    expect(await interaction(f, 'people', person as string, 'last_email_interaction')).not.toBeNull();
    await domain.mailboxes.disconnect(f.ctx, f.ada.mailboxId);
    expect(await interaction(f, 'people', person as string, 'last_email_interaction')).toBeNull();
    expect(await interaction(f, 'people', person as string, 'first_interaction')).toBeNull();
  });
});

describe('connection strength', () => {
  it('buckets', () => {
    expect([0, 0.5, 1, 3, 8, 20, 100].map(bucketOf)).toEqual([
      null,
      'Very weak',
      'Weak',
      'Good',
      'Strong',
      'Very strong',
      'Very strong',
    ]);
    expect(HALF_LIFE_DAYS).toBe(60);
  });

  it('scores two-way exchanges and meetings per member; the strongest member is written on the record', async () => {
    const f = await emailFixture({ recordCreation: 'all' });
    const bob = await memberWithMailbox(f, 'Bob');
    const jane = `jane@northwind-${f.tag}.com`;
    // Bob: one inbound email (weight 1).
    await injectMessage(bob, {
      subject: 'FYI',
      from: { emailAddress: jane },
      to: [{ emailAddress: bob.address }],
      sentAt: iso(-2),
    });
    const [person] = await recordsByValue(f, 'people', jane);
    const id = person as string;
    expect((await valuesOf(f, 'people', id, 'strongest_connection_user'))[0]?.value).toEqual({
      referencedActorType: 'workspace-member',
      referencedActorId: bob.memberId,
    });
    // Ada: a two-way exchange (2 × 3) and a meeting (5) → strongest, "Strong".
    await injectMessage(f.ada, {
      providerThreadId: 't1',
      subject: 'Question',
      from: { emailAddress: jane },
      to: [{ emailAddress: f.ada.address }],
      sentAt: iso(-3),
    });
    await injectMessage(f.ada, {
      providerThreadId: 't1',
      subject: 'Re: Question',
      from: { emailAddress: f.ada.address },
      to: [{ emailAddress: jane }],
      sentAt: iso(-2),
    });
    await injectEvent(f.ada, {
      icalUid: `cs-${f.tag}`,
      title: 'Sync',
      start: { dateTime: iso(-1) },
      end: { dateTime: iso(-0.5) },
      attendees: [
        { emailAddress: f.ada.address, status: 'accepted', isOrganizer: true },
        { emailAddress: jane, status: 'accepted' },
      ],
    });
    const user = (await valuesOf(f, 'people', id, 'strongest_connection_user'))[0]?.value;
    expect(user).toEqual({ referencedActorType: 'workspace-member', referencedActorId: f.memberId });
    const legacy = (await valuesOf(f, 'people', id, 'strongest_connection_strength_legacy'))[0]?.value as number;
    expect(legacy).toBeGreaterThan(10.9);
    expect(legacy).toBeLessThanOrEqual(11);
    const option = (await valuesOf(f, 'people', id, 'strongest_connection_strength'))[0]?.value as {
      selectOptionId: string;
    };
    const options = await domain.schema.listOptions(f.ctx, {
      entityDefinitionId: 'people',
      attributeDefinitionId: 'strongest_connection_strength',
    });
    expect(options.find((o) => o.id === option.selectOptionId)?.title).toBe('Strong');

    // Nothing left → values cleared.
    await domain.mailboxes.disconnect(f.ctx, f.ada.mailboxId);
    await domain.mailboxes.disconnect(bob.ctx, bob.mailboxId);
    expect(await valuesOf(f, 'people', id, 'strongest_connection_strength')).toEqual([]);
    expect(await valuesOf(f, 'people', id, 'strongest_connection_user')).toEqual([]);
  });
});
