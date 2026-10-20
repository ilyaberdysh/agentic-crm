// Preset gallery of insight templates ("Start with a template", I calls §4.3, §10). Our own content: Attio ships 22
// presets across the same eight use cases; the methodology names (BANT, MEDDPICC, SPICED, ChAMP …) are industry
// terms, every description, section title and prompt here is written for this product (mymeet calls first).
import type { InsightPreset } from '@agentic-crm/contracts';

type Section = InsightPreset['sections'][number];
const text = (title: string, prompt: string): Section => ({ title, type: 'plaintext', prompt });
const list = (title: string, prompt: string): Section => ({ title, type: 'list', prompt });

const nextSteps = list(
  'Next steps',
  'List every follow-up that was agreed: what will happen, who owns it and by when, if a date was mentioned.',
);

export const INSIGHT_PRESETS: InsightPreset[] = [
  {
    id: 'general-discussion',
    title: 'General Discussion',
    description: 'A neutral recap for any meeting: what it was about, what was decided and what happens next.',
    categories: ['general'],
    sections: [
      text('Purpose', 'In two or three sentences, explain why this meeting took place and what it set out to achieve.'),
      list('Decisions', 'List the decisions the group reached. Skip topics that were discussed but left open.'),
      nextSteps,
    ],
  },
  {
    id: 'sales-discovery',
    title: 'Sales Discovery',
    description: "Capture the prospect's situation, pains and buying process from a first conversation.",
    categories: ['sales'],
    sections: [
      text(
        'Company context',
        'Describe the prospect: what they do, team size, and the part of the business we spoke about.',
      ),
      list(
        'Pain points',
        'List the problems the prospect described, in their words where possible, with any impact they quantified.',
      ),
      list(
        'Current solution',
        'List the tools, vendors or manual processes they use today for this problem and what they dislike about them.',
      ),
      text(
        'Buying process',
        'Summarise who decides, who else is involved, the budget situation and the expected timeline.',
      ),
      nextSteps,
    ],
  },
  {
    id: 'sales-follow-up',
    title: 'Sales Follow-up',
    description: 'Track how an open deal moved forward since the last conversation.',
    categories: ['sales'],
    sections: [
      text('Progress since last call', 'Summarise what changed on the prospect side since our previous conversation.'),
      list(
        'Open questions and objections',
        'List questions, concerns or objections the prospect raised and how we answered them.',
      ),
      text(
        'Deal temperature',
        'Judge, from what was said, whether the deal is heating up, stable or cooling down, and why.',
      ),
      nextSteps,
    ],
  },
  {
    id: 'bant',
    title: 'BANT',
    description: 'Qualify an opportunity on Budget, Authority, Need and Timeline.',
    categories: ['sales'],
    sections: [
      text(
        'Budget',
        'What did the prospect say about budget: amount, whether it is approved, and where it comes from?',
      ),
      text('Authority', 'Who makes the final decision and who influences it? Name people and roles mentioned.'),
      text('Need', 'Which business need drives this conversation and how urgent is it for them?'),
      text('Timeline', 'When do they want to decide and to go live? Note any events or deadlines driving the date.'),
    ],
  },
  {
    id: 'meddpicc',
    title: 'MEDDPICC',
    description: 'A full enterprise qualification: metrics, buyer, criteria, process, pain, champion and competition.',
    categories: ['sales'],
    sections: [
      list('Metrics', 'List the measurable outcomes the customer expects (numbers, percentages, savings, targets).'),
      text('Economic buyer', 'Who controls the budget for this purchase, and have we spoken to them?'),
      list('Decision criteria', 'List the criteria the customer will use to compare options.'),
      text(
        'Decision process',
        'Describe the steps, approvals and people involved between today and a signed decision.',
      ),
      text(
        'Paper process',
        'Describe legal, security, procurement or contract steps mentioned and their expected duration.',
      ),
      list('Identified pain', 'List the business pains behind the project and their consequences if nothing changes.'),
      text(
        'Champion and competition',
        'Who is advocating for us internally, and which alternatives or competitors are being considered?',
      ),
    ],
  },
  {
    id: 'spiced',
    title: 'SPICED',
    description: 'Situation, Pain, Impact, Critical event and Decision for value-based selling.',
    categories: ['sales'],
    sections: [
      text('Situation', 'Describe the facts of the customer’s current setup that matter for this deal.'),
      list('Pain', 'List the problems the customer is experiencing.'),
      text('Impact', 'What does the pain cost them, and what would solving it be worth? Quote figures when given.'),
      text('Critical event', 'Is there a date or event that forces a decision? What happens if they miss it?'),
      text('Decision', 'Summarise how and by whom the decision will be made.'),
    ],
  },
  {
    id: 'champ',
    title: 'ChAMP',
    description: 'Challenges first: qualify on Challenges, Authority, Money and Prioritisation.',
    categories: ['sales'],
    sections: [
      list('Challenges', 'List the challenges the customer wants to solve, most important first.'),
      text('Authority', 'Who owns the problem and who signs off on a solution?'),
      text('Money', 'What was said about available budget or how a purchase would be funded?'),
      text('Prioritisation', 'How high is this on their list compared with other initiatives, and why?'),
    ],
  },
  {
    id: 'product-demo',
    title: 'Product Demo',
    description: 'Record how a demo landed: what resonated, what raised questions, and the fit.',
    categories: ['sales', 'success', 'product'],
    sections: [
      list('What resonated', 'List the features or moments of the demo the audience reacted positively to.'),
      list(
        'Questions and concerns',
        'List questions asked during the demo and any concerns or missing capabilities raised.',
      ),
      text(
        'Fit assessment',
        'Based on the conversation, how well does the product fit their use case, and where are the gaps?',
      ),
      nextSteps,
    ],
  },
  {
    id: 'customer-onboarding',
    title: 'Customer Onboarding',
    description: 'Keep onboarding calls on track: goals, setup status, blockers and owners.',
    categories: ['success', 'product'],
    sections: [
      list('Customer goals', 'List what the customer wants to achieve with the product in the first months.'),
      text('Setup status', 'Summarise what is already configured or migrated and what remains.'),
      list('Blockers', 'List issues blocking adoption, with the owner of each if mentioned.'),
      nextSteps,
    ],
  },
  {
    id: 'product-feedback',
    title: 'Product Feedback',
    description: 'Turn a customer conversation into structured product feedback.',
    categories: ['success', 'product'],
    sections: [
      list('Feature requests', 'List the features or changes the customer asked for, with the reason they gave.'),
      list('Bugs and friction', 'List problems, errors or confusing parts of the product the customer described.'),
      list('What works well', 'List what the customer explicitly appreciates about the product.'),
      text('Use case', 'Describe how the customer uses the product day to day, as far as the call reveals.'),
      text(
        'Severity',
        'How strongly does this feedback affect their satisfaction or renewal, judging by what they said?',
      ),
    ],
  },
  {
    id: 'customer-case-study',
    title: 'Customer Case Study',
    description: 'Collect the story, numbers and quotes for a customer success story.',
    categories: ['marketing'],
    sections: [
      text('Before', 'Describe the customer’s situation and problem before they started using the product.'),
      text('Why they chose us', 'What made them pick this product over the alternatives?'),
      list('Results', 'List the concrete results and numbers the customer reported.'),
      list(
        'Quotable lines',
        'Quote, verbatim, up to five strong sentences the customer said that could be used in a case study.',
      ),
      text('Permissions', 'Note anything said about what may or may not be published, logos or names.'),
    ],
  },
  {
    id: 'partnership-kickoff',
    title: 'Partnership Kickoff',
    description: 'Align on goals, responsibilities and the first milestones of a new partnership.',
    categories: ['marketing'],
    sections: [
      text('Shared goals', 'What do both sides want to achieve with this partnership?'),
      list('Responsibilities', 'List what each party committed to do.'),
      list('Milestones', 'List the milestones and dates that were agreed.'),
      list('Risks', 'List risks, dependencies or open questions raised.'),
      nextSteps,
    ],
  },
  {
    id: 'candidate-screen',
    title: 'Candidate Screen',
    description: 'A structured summary of a first interview with any candidate.',
    categories: ['recruiting'],
    sections: [
      text('Background', 'Summarise the candidate’s current role, experience and relevant past roles.'),
      list('Strengths', 'List strengths that came through in the conversation, with evidence.'),
      list('Concerns', 'List concerns or gaps worth probing in the next round.'),
      text('Motivation', 'Why is the candidate looking, and why this role?'),
      text('Logistics', 'Note salary expectations, notice period, location or visa details if discussed.'),
      text('Recommendation', 'Based only on the conversation, should the candidate move forward? Explain briefly.'),
    ],
  },
  {
    id: 'engineering-candidate-screen',
    title: 'Engineering Candidate Screen',
    description: 'Assess an engineering candidate’s technical depth, ownership and team fit.',
    categories: ['recruiting'],
    sections: [
      list(
        'Tech stack',
        'List languages, frameworks and systems the candidate has worked with, noting depth where clear.',
      ),
      text('Technical depth', 'Summarise how deeply the candidate explained past technical decisions and trade-offs.'),
      list('Projects', 'List the most relevant projects the candidate described and their role in each.'),
      text('Ownership and collaboration', 'How does the candidate describe working with others and owning outcomes?'),
      list('Follow-up topics', 'List areas to test in the technical interview.'),
      text('Logistics', 'Note expectations on compensation, start date and location if discussed.'),
    ],
  },
  {
    id: 'design-candidate-screen',
    title: 'Design Candidate Screen',
    description: 'Evaluate a designer’s process, craft and collaboration from a screening call.',
    categories: ['recruiting'],
    sections: [
      text('Design focus', 'What kind of design work does the candidate do (product, brand, research, systems)?'),
      list('Portfolio highlights', 'List the projects the candidate walked through and the problem each solved.'),
      text('Process', 'How does the candidate go from problem to solution? Note research, iteration and validation.'),
      text('Collaboration', 'How does the candidate work with engineers, product managers and stakeholders?'),
      list('Concerns', 'List gaps or concerns to explore further.'),
      text('Logistics', 'Note expectations on compensation, start date and location if discussed.'),
    ],
  },
  {
    id: 'ae-candidate-screen',
    title: 'Sales Candidate Screen',
    description: 'Screen account executives on track record, sales motion and coachability.',
    categories: ['sales', 'recruiting'],
    sections: [
      text('Track record', 'Summarise quota, attainment and deal sizes the candidate mentioned.'),
      text('Sales motion', 'Which segments, cycle lengths and sales methodologies has the candidate worked with?'),
      list('Notable deals', 'List deals the candidate described and what they personally did to win them.'),
      text('Prospecting', 'How does the candidate build pipeline on their own?'),
      text('Coachability', 'How does the candidate talk about feedback, losses and learning?'),
      list('Concerns', 'List gaps or concerns to explore in the next round.'),
      text('Logistics', 'Note expectations on compensation, start date and location if discussed.'),
    ],
  },
  {
    id: 'behavioral-interview',
    title: 'Behavioral Interview',
    description: 'Capture situation–action–result stories and the competencies they show.',
    categories: ['recruiting'],
    sections: [
      list('Stories', 'For each example the candidate gave, summarise the situation, what they did and the result.'),
      list(
        'Competencies shown',
        'List competencies (e.g. ownership, communication, judgement) the stories demonstrate, with evidence.',
      ),
      list('Red flags', 'List answers that were vague, inconsistent or concerning.'),
      text('Self-awareness', 'How does the candidate reflect on mistakes and what they would do differently?'),
      text('Summary', 'Give a short overall impression grounded in the answers.'),
    ],
  },
  {
    id: 'investor-pitch',
    title: 'Investor Pitch',
    description: 'For founders: what an investor asked, liked and needs before deciding.',
    categories: ['fundraising'],
    sections: [
      list('Investor questions', 'List the questions the investor asked, grouped by topic if possible.'),
      list('Positive signals', 'List what the investor reacted well to.'),
      list('Concerns', 'List doubts or objections the investor raised.'),
      text(
        'Process and next steps',
        'What did the investor say about their process, timing and what they need from us next?',
      ),
    ],
  },
  {
    id: 'due-diligence',
    title: 'Due Diligence',
    description: 'Track diligence requests and answers during a financing round.',
    categories: ['fundraising'],
    sections: [
      list('Requests', 'List the documents, data or introductions requested.'),
      list('Answers given', 'List the questions we answered during the call and the key facts stated.'),
      list('Open issues', 'List topics that remain unresolved or need follow-up evidence.'),
      text('Timeline', 'What was said about the timeline to a term sheet or close?'),
    ],
  },
  {
    id: 'founder-pitch',
    title: 'Founder Pitch',
    description: 'For investors: evaluate a startup pitch on team, market, product and traction.',
    categories: ['investing'],
    sections: [
      text('Company', 'In two sentences, what does the company do and for whom?'),
      text('Team', 'Who are the founders and what relevant experience did they describe?'),
      text('Market', 'How big is the market they target and how do they reach it?'),
      list('Traction', 'List traction figures mentioned: revenue, growth, users, retention, pilots.'),
      text('The round', 'How much are they raising, at what terms if stated, and what is the money for?'),
      list('Risks and questions', 'List the main risks and the questions to ask in a follow-up.'),
    ],
  },
  {
    id: 'portfolio-company-update',
    title: 'Portfolio Company Update',
    description: 'A board-style update from a portfolio company check-in.',
    categories: ['investing'],
    sections: [
      list('Key metrics', 'List the metrics shared and how they moved since the last update.'),
      list('Wins', 'List the main wins since the last check-in.'),
      list('Challenges', 'List the problems the company is facing.'),
      list('Asks', 'List what the founders asked investors for (introductions, hiring help, advice).'),
      text('Runway', 'What was said about cash, burn and runway?'),
    ],
  },
  {
    id: 'lp-prospecting',
    title: 'LP Prospecting',
    description: 'For fund managers: qualify a potential limited partner.',
    categories: ['investing'],
    sections: [
      text('Investor profile', 'Describe the LP: type, size, and current allocation to venture or similar funds.'),
      text('Interest', 'How interested did they sound, and what about our fund appealed to them?'),
      list('Requirements', 'List their requirements: ticket size, terms, reporting, timing.'),
      nextSteps,
    ],
  },
];

const BY_ID = new Map(INSIGHT_PRESETS.map((p) => [p.id, p]));

export function insightPreset(id: string): InsightPreset | null {
  return BY_ID.get(id) ?? null;
}
