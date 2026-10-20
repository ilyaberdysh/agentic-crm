// Home page data (BACKLOG 5.07; B-shell/home.md §2): the greeting, the Tasks block (open tasks assigned to me, at
// most 5, ordered by bucket: today, tomorrow, overdue, later, no due date) and recently updated records. The Meetings
// block arrives with slice 7 and the Ask Agentic block with slice 10.
import { z } from 'zod';
import { taskSchema } from './collab.ts';
import { timestampSchema, uuidSchema } from './common.ts';

export const homeSummaryInputSchema = z.object({
  /** The viewer's IANA time zone: greeting and task buckets are local (home §2.1, X-09). */
  timeZone: z.string().min(1).max(64),
  /** "Now" override (tests, previews); defaults to the transaction time. */
  now: timestampSchema.optional(),
  taskLimit: z.number().int().min(1).max(20).default(5),
  recentLimit: z.number().int().min(0).max(50).default(8),
});
export type HomeSummaryInput = z.input<typeof homeSummaryInputSchema>;

export const homeTaskBuckets = ['today', 'tomorrow', 'overdue', 'later', 'no-date'] as const;
export const homeTaskBucketSchema = z.enum(homeTaskBuckets);
export type HomeTaskBucket = z.infer<typeof homeTaskBucketSchema>;

export const partOfDaySchema = z.enum(['morning', 'afternoon', 'evening']);
export type PartOfDay = z.infer<typeof partOfDaySchema>;

export const homeSummarySchema = z.object({
  greeting: z.object({
    /** Morning before 12:00, afternoon before 18:00, evening otherwise (local time). */
    partOfDay: partOfDaySchema,
    firstName: z.string(),
    /** "Good morning, Ada." */
    text: z.string(),
  }),
  tasks: z.object({
    /** Open tasks assigned to me (the header count). */
    total: z.number().int(),
    today: z.number().int(),
    tomorrow: z.number().int(),
    overdue: z.number().int(),
    /** Due after tomorrow. */
    later: z.number().int(),
    noDueDate: z.number().int(),
    /** Top items in bucket order; deadlines ascending inside a bucket. */
    items: z.array(z.object({ bucket: homeTaskBucketSchema, task: taskSchema })),
  }),
  /** Most recently updated records of objects I can read. */
  recentRecords: z.array(
    z.object({
      entityDefinitionId: uuidSchema,
      entityInstanceId: uuidSchema,
      title: z.string().nullable(),
      subtitle: z.string().nullable(),
      avatar: z.string().nullable(),
      updatedAt: timestampSchema,
    }),
  ),
  /** Local date of "now" in the viewer's zone (YYYY-MM-DD). */
  localDate: z.string(),
  accurateAt: timestampSchema,
});
export type HomeSummary = z.infer<typeof homeSummarySchema>;
