//  seed smoke test: the support helpers create mailboxes and mail that the record threads can see.
import { expect, test } from '@playwright/test';
import { trpc } from './slice3-support.ts';
import { signedInAs } from './slice5-support.ts';
import { janeId, seedSlice7 } from './slice7-support.ts';

test('seeds mailboxes and threads for two members', async ({ browser }) => {
  const seed = await seedSlice7(browser);
  const { context, page } = await signedInAs(browser, seed.ada, '/mymeet/home');
  const jane = await janeId(page);
  const out = await trpc<{ threads: { subject: string | null; access: string }[]; total: number }>(
    page,
    'email.threads',
    {
      record: { entityDefinitionId: 'people', entityInstanceId: jane },
    },
  );
  console.log(JSON.stringify(out.threads.map((t) => [t.subject, t.access])));
  expect(out.threads.find((t) => t.subject === 'Pilot for Northwind')?.access).toBe('full-access');
  // Grace's thread is visible to Ada at the subject-line level only.
  expect(out.threads.find((t) => t.subject === 'Secret pricing')?.access).toBe('subject-line');
  await context.close();
});
