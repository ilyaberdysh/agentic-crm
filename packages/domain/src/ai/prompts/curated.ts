// Curated prompts (ask-agentic §2.3: 17 prompts, Context / Task / Constraints). The catalogue is ours — titles and
// categories follow the observed gallery, every body is written for this product. Ids are the system prompt types.
export interface CuratedPrompt {
  id: string;
  title: string;
  summary: string;
  iconId: string;
  iconColor: string;
  categories: ('sales' | 'success' | 'product' | 'marketing')[];
  targets: string[];
  featured: boolean;
  prompt: string;
}

const ALL: CuratedPrompt['categories'] = ['sales', 'success', 'product', 'marketing'];

const body = (context: string, task: string, constraints: string[]) =>
  `**Context**\n${context}\n\n**Task**\n${task}\n\n**Constraints**\n${constraints.map((c) => `- ${c}`).join('\n')}`;

export const CURATED_PROMPTS: readonly CuratedPrompt[] = [
  {
    id: 'account-research',
    title: 'Run account research',
    summary: 'Pull together everything we know about an account and what to look into next.',
    iconId: 'search',
    iconColor: 'purple',
    categories: ['sales', 'success', 'product'],
    targets: ['entity-instance'],
    featured: true,
    prompt: body(
      'I am preparing to work on the account I mention or the record I have open.',
      'Collect the account profile, the people we know there, open deals, recent emails, meetings and notes, and the ' +
        'open tasks. Then list the gaps in what we know and the questions worth answering next.',
      ['Cite the records you used as links', 'Keep the profile under 200 words', 'End with 3–5 open questions'],
    ),
  },
  {
    id: 'sales-coach',
    title: 'Sales coach',
    summary: 'Get candid feedback on a deal or a call and how to move it forward.',
    iconId: 'student-hat',
    iconColor: 'orange',
    categories: ['sales'],
    targets: ['entity-instance', 'call-recording'],
    featured: false,
    prompt: body(
      'Act as an experienced sales coach reviewing my work on this deal or call.',
      'Assess what went well, what was missed (pain, decision process, budget, timeline, champion) and the single ' +
        'most important next move.',
      ['Be direct and specific', 'Quote the transcript or notes when you can', 'No more than 5 recommendations'],
    ),
  },
  {
    id: 'update-deal',
    title: 'Update deal',
    summary: 'Propose updates to a deal from the latest emails, calls and notes.',
    iconId: 'dollar-circle',
    iconColor: 'green',
    categories: ['sales'],
    targets: ['entity-instance'],
    featured: false,
    prompt: body(
      'The deal I mention may be out of date compared with our latest conversations.',
      'Read the recent emails, meetings, call transcripts and notes linked to the deal and propose updates to its ' +
        'stage, value, close date and next step.',
      ['Only propose changes supported by evidence', 'Explain each change in one sentence', 'Ask before writing'],
    ),
  },
  {
    id: 'deal-brief',
    title: 'Deal brief',
    summary: 'A one-page brief of a deal: status, stakeholders, risks and next steps.',
    iconId: 'suitcase',
    iconColor: 'blue',
    categories: ['sales'],
    targets: ['entity-instance'],
    featured: true,
    prompt: body(
      'I need a quick, complete picture of a deal before a conversation about it.',
      'Summarise the deal status, value and stage history, key stakeholders and their stance, recent activity, ' +
        'risks and the agreed next steps.',
      ['Use short sections with bold headings', 'Flag anything older than 30 days as stale', 'Link every record'],
    ),
  },
  {
    id: 'suggest-next-steps',
    title: 'Suggest next steps',
    summary: 'Recommend concrete next actions for a customer or deal.',
    iconId: 'checkbox',
    iconColor: 'blue',
    categories: ['success', 'product'],
    targets: ['entity-instance', 'meeting', 'call-recording'],
    featured: false,
    prompt: body(
      'I want to keep momentum with the customer or deal in context.',
      'Based on the latest activity, recommend the next 3 actions with an owner and a due date, and offer to create ' +
        'them as tasks.',
      ['Each action must be specific and verifiable', 'Prefer actions that unblock the customer'],
    ),
  },
  {
    id: 'recap-call',
    title: 'Recap call',
    summary: 'Summarise a call: decisions, open questions, action items.',
    iconId: 'mic',
    iconColor: 'pink',
    categories: ['sales', 'success', 'product'],
    targets: ['call-recording', 'meeting'],
    featured: true,
    prompt: body(
      'I just finished the call in context (or my latest call).',
      'Write a recap with the purpose of the call, the key points discussed, decisions, open questions and action ' +
        'items with owners. Add call snippets for the most important moments.',
      ['Under 250 words', 'Attribute statements to speakers', 'List action items as a checklist'],
    ),
  },
  {
    id: 'objection-handling',
    title: 'Objection handling',
    summary: 'Find the objections raised and suggest how to answer them.',
    iconId: 'sign-left-right',
    iconColor: 'red',
    categories: ['sales'],
    targets: ['call-recording', 'entity-instance'],
    featured: false,
    prompt: body(
      'Prospects raised concerns in recent conversations about the account or deal in context.',
      'List each objection with where it came up, the underlying concern, and a suggested response backed by ' +
        'what we know about the customer.',
      ['Quote the objection verbatim when possible', 'Keep each suggested response under 60 words'],
    ),
  },
  {
    id: 'product-feedback',
    title: 'Product feedback',
    summary: 'Extract product feedback and feature requests from conversations.',
    iconId: 'bubble',
    iconColor: 'purple',
    categories: ['sales', 'success', 'product'],
    targets: ['call-recording', 'entity-instance'],
    featured: false,
    prompt: body(
      'Customers share product feedback in calls, emails and notes.',
      'Find the feedback in the context (or recent conversations), group it by theme, and note who said it and how ' +
        'strongly.',
      ['Separate bugs, requests and praise', 'Include a short quote for each item'],
    ),
  },
  {
    id: 'onboarding-prep',
    title: 'Onboarding prep',
    summary: 'Prepare a customer onboarding: goals, stakeholders, risks, plan.',
    iconId: 'handshake',
    iconColor: 'green',
    categories: ['success'],
    targets: ['entity-instance'],
    featured: false,
    prompt: body(
      'A new customer is about to start onboarding.',
      'From the sales history, list the customer goals, success criteria, stakeholders, promises made during the ' +
        'sale and risks, then draft a 30-day onboarding plan.',
      ['Flag promises that need confirmation', 'Plan in weekly milestones'],
    ),
  },
  {
    id: 'meeting-catch-up',
    title: 'What did I miss?',
    summary: 'Catch up on what happened while you were away.',
    iconId: 'lightning',
    iconColor: 'yellow',
    categories: ALL,
    targets: ['entity-instance', 'entity-instance-list'],
    featured: false,
    prompt: body(
      'I have been away and need to catch up quickly.',
      'Summarise what changed in the last 7 days on the records in context (or my records): new emails, meetings, ' +
        'notes, completed and overdue tasks, and stage changes.',
      ['Most important first', 'One line per item with a link'],
    ),
  },
  {
    id: 'shipped-feature-outreach',
    title: 'Shipped feature outreach',
    summary: 'Find customers who asked for a feature and draft the follow-up.',
    iconId: 'rocket',
    iconColor: 'green',
    categories: ['success', 'product'],
    targets: ['entity-instance-list'],
    featured: false,
    prompt: body(
      'We just shipped a feature that customers asked for.',
      'Find the customers who requested it in notes, emails or calls, and draft a short personal follow-up for each.',
      ['Reference what each customer actually said', 'Under 90 words per message'],
    ),
  },
  {
    id: 'qbr-prep',
    title: 'QBR Prep',
    summary: 'Prepare a quarterly business review for a customer.',
    iconId: 'calendar',
    iconColor: 'cyan',
    categories: ['success'],
    targets: ['entity-instance'],
    featured: false,
    prompt: body(
      'A quarterly business review with the customer in context is coming up.',
      'Summarise the quarter: goals and outcomes, usage and engagement signals, support topics, wins, risks and the ' +
        'proposed priorities for next quarter.',
      ['Back statements with records', 'End with 3 discussion topics'],
    ),
  },
  {
    id: 'product-engagement',
    title: 'Product engagement',
    summary: 'Assess how engaged an account is and where it is at risk.',
    iconId: 'chart-arrow-up',
    iconColor: 'cyan',
    categories: ['success', 'product'],
    targets: ['entity-instance'],
    featured: false,
    prompt: body(
      'I want to understand how engaged the account in context is.',
      'Look at interaction recency, meeting cadence, email activity and open issues, then rate engagement as high, ' +
        'medium or low with reasons and suggested actions.',
      ['Say which signals are missing', 'Keep it under 200 words'],
    ),
  },
  {
    id: 'quick-clarification',
    title: 'What did that mean?',
    summary: 'Explain a term, acronym or moment from a conversation.',
    iconId: 'bubble',
    iconColor: 'blue',
    categories: ALL,
    targets: ['call-recording', 'email'],
    featured: false,
    prompt: body(
      'Something in the conversation in context was unclear to me.',
      'Explain what was meant, using the surrounding conversation and what we know about the customer.',
      ['Answer in 3 sentences or fewer', 'Say when you are unsure'],
    ),
  },
  {
    id: 'daily-brief',
    title: 'Daily brief',
    summary: 'Start the day with your meetings, tasks and what needs attention.',
    iconId: 'sun',
    iconColor: 'yellow',
    categories: ALL,
    targets: [],
    featured: true,
    prompt: body(
      'It is the start of my working day.',
      "List today's meetings with a one-line prep note each, my tasks due today or overdue, and the records that " +
        'need my attention (unanswered emails, stalled deals).',
      ['Order by time, then urgency', 'Keep the whole brief scannable in a minute'],
    ),
  },
  {
    id: 'follow-up-email',
    title: 'Follow-up email',
    summary: 'Draft a follow-up email after a meeting or call.',
    iconId: 'email',
    iconColor: 'green',
    categories: ALL,
    targets: ['meeting', 'call-recording', 'entity-instance'],
    featured: true,
    prompt: body(
      'I need to follow up after the meeting or call in context (or my latest one).',
      'Draft a follow-up email that thanks the attendees, recaps the key points and decisions, and confirms the next ' +
        'steps with dates.',
      ['Under 150 words', 'Plain, friendly tone', 'Use the attendees’ names'],
    ),
  },
  {
    id: 'meeting-prep',
    title: 'Meeting prep',
    summary: 'Prepare for an upcoming meeting with the people and history.',
    iconId: 'calendar',
    iconColor: 'blue',
    categories: ALL,
    targets: ['meeting', 'entity-instance'],
    featured: true,
    prompt: body(
      'I have the meeting in context (or my next meeting) coming up.',
      'Brief me on the attendees and their companies, our history with them (emails, past meetings, notes, deals), ' +
        'open items and suggested talking points.',
      ['One short section per attendee company', 'End with 3 talking points'],
    ),
  },
];

/** Saved for every member on first use ("Daily brief, Follow-up email, Meeting prep"). */
export const DEFAULT_SAVED_CURATED = ['daily-brief', 'follow-up-email', 'meeting-prep'] as const;

export function curatedPrompt(id: string): CuratedPrompt | undefined {
  return CURATED_PROMPTS.find((p) => p.id === id);
}
