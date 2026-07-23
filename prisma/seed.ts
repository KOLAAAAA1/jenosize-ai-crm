/**
 * Deterministic synthetic seed at the scenario's stated scale
 * (20-person team · ~2,000 contacts · ~300 active leads).
 *
 * Deterministic: a fixed faker seed + fixed date anchors mean every run
 * produces the same data, so the demo is reproducible. Run with:
 *   pnpm db:seed     (or `pnpm db:reset` to wipe + migrate + reseed)
 */
import 'dotenv/config';
import {
  PrismaClient,
  UserRole,
  Stage,
  Source,
  ActivityType,
  MessageDirection,
  MessageStatus,
  SuggestionType,
  SuggestionStatus,
  WebhookStatus,
  ConsentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
// Thai locale: person names + phone numbers come out in Thai. Fields with no
// `th` dataset (commerce/company catch-phrases/lorem/job titles) fall back to
// English automatically. Emails are the one exception — see cleanEmail below.
import { fakerTH as faker } from '@faker-js/faker';
import bcrypt from 'bcryptjs';
// Shared controlled vocabularies (relative import — tsx does not resolve the
// "@/" tsconfig alias). Using them here keeps seed values in lockstep with the
// CRM filter dropdowns.
import { INDUSTRIES, COMPANY_SIZES } from '../src/lib/crm';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// --- Determinism ------------------------------------------------------------
faker.seed(20260719);
const NOW = new Date('2026-07-19T00:00:00Z');
const ONE_YEAR_AGO = new Date('2025-07-19T00:00:00Z');
const DEMO_PASSWORD = 'Demo1234!';

// --- Scale ------------------------------------------------------------------
const N_USERS = 20;
const N_COMPANIES = 150;
const N_CONTACTS = 2000;
const N_LEADS = 300;
const LINE_CONTACT_RATIO = 0.08; // ~8% of contacts are linked to a LINE user

const id = (prefix: string, i: number) =>
  `${prefix}_${String(i).padStart(5, '0')}`;
const pick = <T>(arr: readonly T[]): T => faker.helpers.arrayElement(arr);
const dateBetween = (from: Date, to: Date) => faker.date.between({ from, to });

// fakerTH's internet.email() transliterates Thai names into unreadable ASCII
// (e.g. "2st2sh…@gmail.com"). Build a clean, deterministic, unique email from a
// romanized Thai-name pool instead — valid ASCII, still recognisably Thai.
const ROMAN_NAMES = [
  'somchai',
  'somsri',
  'nattapong',
  'pimchanok',
  'arthit',
  'kanya',
  'thanawat',
  'napaporn',
  'chatchai',
  'ratana',
  'worawut',
  'sunisa',
];
const EMAIL_DOMAINS = [
  'gmail.com',
  'hotmail.com',
  'outlook.co.th',
  'yahoo.co.th',
];
const cleanEmail = (i: number, domain: string) =>
  `${ROMAN_NAMES[i % ROMAN_NAMES.length]}.${i}@${domain}`;

// Natural Thai company name: "บริษัท <surname-core><business word> จำกัด" — the
// realistic Thai SME pattern (fakerTH's company.name() produces unnatural mixes
// like "วงศ์กระโทก and Sons"). The surname is stripped of hyphenated double
// forms for a cleaner core.
const COMPANY_WORDS = [
  'เทรดดิ้ง',
  'การช่าง',
  'พาณิชย์',
  'กรุ๊ป',
  'อุตสาหกรรม',
  'เทคโนโลยี',
  'อินเตอร์เนชั่นแนล',
  'โฮลดิ้ง',
];
const thaiCompanyName = () =>
  `บริษัท ${faker.person.lastName().split('-')[0]}${pick(COMPANY_WORDS)} จำกัด`;

// Marketing-consent mix. UNKNOWN dominates (the safe default); a realistic
// minority have explicitly opted in or out — the latter drives the AI skill's
// opt-out handling (SKILL Evaluation Case 3).
const consentBag: ConsentStatus[] = [
  ...Array(60).fill(ConsentStatus.UNKNOWN),
  ...Array(30).fill(ConsentStatus.OPTED_IN),
  ...Array(10).fill(ConsentStatus.OPTED_OUT),
];

async function main() {
  console.log('Resetting tables…');
  // Order respects FKs; onDelete cascades handle the children, but explicit
  // deletes keep reseed fast and predictable.
  await prisma.webhookEvent.deleteMany();
  await prisma.aiSuggestion.deleteMany();
  await prisma.message.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.user.deleteMany();

  // --- Users ----------------------------------------------------------------
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  // Fixed, documented demo logins for the first three users; the rest are faker.
  // Each of the three officer accounts carries a fixed first name and its own
  // role as the surname (e.g. "พนักงาน ADMIN"), so admin/manager/sales are
  // visually distinct at a glance.
  const fixedEmails = [
    'admin@jenosize.demo',
    'manager@jenosize.demo',
    'sales@jenosize.demo',
  ];
  const fixedRoles = [UserRole.ADMIN, UserRole.MANAGER, UserRole.SALES];
  const OFFICER_FIRST_NAME = 'พนักงาน';
  const users = Array.from({ length: N_USERS }, (_, i) => {
    const role = fixedRoles[i] ?? (i <= 3 ? UserRole.MANAGER : UserRole.SALES);
    return {
      id: id('usr', i),
      name:
        i < fixedRoles.length
          ? `${OFFICER_FIRST_NAME} ${role}`
          : faker.person.fullName(),
      email: fixedEmails[i] ?? cleanEmail(i, 'jenosize.demo'),
      role,
      passwordHash,
      createdAt: dateBetween(ONE_YEAR_AGO, NOW),
    };
  });
  await prisma.user.createMany({ data: users });
  const salesUsers = users.filter((u) => u.role !== UserRole.ADMIN);

  // --- Companies ------------------------------------------------------------
  const companies = Array.from({ length: N_COMPANIES }, (_, i) => ({
    id: id('cmp', i),
    name: thaiCompanyName(),
    industry: pick(INDUSTRIES),
    size: pick(COMPANY_SIZES),
    website: faker.internet.url(),
    notes:
      faker.helpers.maybe(() => faker.company.catchPhrase(), {
        probability: 0.5,
      }) ?? null,
    createdAt: dateBetween(ONE_YEAR_AGO, NOW),
  }));
  await prisma.company.createMany({ data: companies });

  // --- Contacts -------------------------------------------------------------
  const usedLineIds = new Set<string>();
  const makeLineId = () => {
    let v: string;
    do {
      v =
        'U' +
        faker.string.hexadecimal({ length: 32, casing: 'lower', prefix: '' });
    } while (usedLineIds.has(v));
    usedLineIds.add(v);
    return v;
  };
  const contacts = Array.from({ length: N_CONTACTS }, (_, i) => {
    const company = pick(companies);
    const hasLine = faker.datatype.boolean({ probability: LINE_CONTACT_RATIO });
    return {
      id: id('con', i),
      companyId: company.id,
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      email: cleanEmail(i, pick(EMAIL_DOMAINS)),
      phone: faker.phone.number({ style: 'international' }),
      title: faker.person.jobTitle(),
      lineUserId: hasLine ? makeLineId() : null,
      consentStatus: pick(consentBag),
      createdAt: dateBetween(company.createdAt, NOW),
    };
  });
  await prisma.contact.createMany({ data: contacts });
  const lineContacts = contacts.filter((c) => c.lineUserId);

  // --- Leads ----------------------------------------------------------------
  // Stage mix: majority active (NEW/QUALIFIED/PROPOSAL), some closed.
  const stageBag: Stage[] = [
    ...Array(90).fill(Stage.NEW),
    ...Array(80).fill(Stage.QUALIFIED),
    ...Array(70).fill(Stage.PROPOSAL),
    ...Array(35).fill(Stage.WON),
    ...Array(25).fill(Stage.LOST),
  ];
  const sourceBag: Source[] = [
    ...Array(5).fill(Source.WEBSITE),
    ...Array(3).fill(Source.MANUAL),
    ...Array(2).fill(Source.LINE_OA),
  ];
  const contactToLead = new Map<string, string>();
  const leads = Array.from({ length: N_LEADS }, (_, i) => {
    const contact = pick(contacts);
    const owner = pick(salesUsers);
    const stage = stageBag[i % stageBag.length];
    const scored = stage !== Stage.NEW;
    const probability = stage === Stage.WON
      ? 100
      : stage === Stage.LOST
        ? 0
        : stage === Stage.NEW
          ? null
          : faker.number.int({ min: 35, max: 90 });
    const createdAt = dateBetween(contact.createdAt, NOW);
    const leadId = id('led', i);
    contactToLead.set(contact.id, leadId);
    return {
      id: leadId,
      title: `${faker.commerce.productName()} — ${contact.firstName}`,
      companyId: contact.companyId,
      contactId: contact.id,
      ownerId: owner.id,
      stage,
      source: pick(sourceBag),
      valueTHB: faker.number.int({ min: 50_000, max: 2_000_000 }),
      probability,
      expectedCloseAt: stage === Stage.NEW || stage === Stage.WON || stage === Stage.LOST
        ? null
        : faker.date.between({ from: NOW, to: new Date('2026-12-31T00:00:00Z') }),
      score: scored ? faker.number.int({ min: 40, max: 95 }) : null,
      scoreReason: scored
        ? faker.helpers.arrayElement([
            'Strong budget + timeline fit',
            'Engaged decision maker',
            'Clear pain, mid-tier budget',
            'Warm inbound, needs nurture',
          ])
        : null,
      createdAt,
      updatedAt: dateBetween(createdAt, NOW),
    };
  });
  await prisma.lead.createMany({ data: leads });

  // --- Activities (immutable timeline) --------------------------------------
  const activities: Prisma.ActivityCreateManyInput[] = [];
  let actCounter = 0;
  for (const lead of leads) {
    const count = faker.number.int({ min: 2, max: 6 });
    let cursor = lead.createdAt;
    // Opening note
    activities.push({
      id: id('act', actCounter++),
      leadId: lead.id,
      userId: lead.ownerId,
      type: ActivityType.NOTE,
      body: `Lead created from ${lead.source.toLowerCase()} — ${faker.company.buzzPhrase()}.`,
      createdAt: cursor,
    });
    for (let k = 1; k < count; k++) {
      cursor = dateBetween(cursor, NOW);
      const type = pick([
        ActivityType.CALL,
        ActivityType.EMAIL,
        ActivityType.NOTE,
        ActivityType.STAGE_CHANGE,
      ]);
      activities.push({
        id: id('act', actCounter++),
        leadId: lead.id,
        userId:
          faker.helpers.maybe(() => lead.ownerId, { probability: 0.85 }) ??
          null,
        type,
        body:
          type === ActivityType.STAGE_CHANGE
            ? `Stage moved to ${lead.stage}.`
            : faker.lorem.sentence(),
        metadata:
          type === ActivityType.STAGE_CHANGE
            ? { to: lead.stage }
            : Prisma.JsonNull,
        createdAt: cursor,
      });
    }
  }
  await prisma.activity.createMany({ data: activities });

  // --- Messages (LINE) ------------------------------------------------------
  const messages: Prisma.MessageCreateManyInput[] = [];
  let msgCounter = 0;
  for (const contact of lineContacts) {
    if (!faker.datatype.boolean({ probability: 0.6 })) continue;
    const leadId = contactToLead.get(contact.id) ?? null;
    const turns = faker.number.int({ min: 1, max: 4 });
    let cursor = dateBetween(contact.createdAt, NOW);
    for (let t = 0; t < turns; t++) {
      cursor = dateBetween(cursor, NOW);
      const inbound = t % 2 === 0;
      messages.push({
        id: id('msg', msgCounter++),
        leadId,
        contactId: contact.id,
        direction: inbound ? MessageDirection.IN : MessageDirection.OUT,
        providerMessageId: inbound ? `line_${faker.string.numeric(18)}` : null,
        status: inbound
          ? MessageStatus.RECEIVED
          : pick([
              MessageStatus.SENT,
              MessageStatus.APPROVED,
              MessageStatus.DRAFT,
            ]),
        body: inbound
          ? faker.lorem.sentence()
          : `Thanks for reaching out! ${faker.lorem.sentence()}`,
        createdAt: cursor,
      });
    }
  }
  await prisma.message.createMany({ data: messages });

  // --- AI suggestions (SUGGESTED, awaiting human review) --------------------
  const suggestionLeads = faker.helpers.arrayElements(leads, 40);
  // Payload matches the copilot's CopilotSuggestion shape (src/lib/ai/schema.ts)
  // so seeded suggestions render through the same UI as freshly generated ones.
  const suggestions: Prisma.AiSuggestionCreateManyInput[] = suggestionLeads.map(
    (lead, i) => {
      const createdAt = dateBetween(lead.createdAt, NOW);
      return {
        id: id('sug', i),
        leadId: lead.id,
        type: SuggestionType.SUMMARY,
        payload: {
          status: 'success',
          summary: {
            overview: faker.lorem.sentences(2),
            keyFacts: [faker.company.buzzPhrase(), faker.company.buzzPhrase()],
            openQuestions: [],
          },
          qualification: {
            score: faker.number.int({ min: 40, max: 95 }),
            confidence: pick(['low', 'medium', 'high']),
            reasons: [faker.company.buzzPhrase(), faker.company.buzzPhrase()],
            recommendedStage: 'no_change',
          },
          nextAction: {
            action: pick([
              'Book a discovery call',
              'Send pricing proposal',
              'Follow up in 3 days',
            ]),
            reason: faker.lorem.sentence(),
            priority: pick(['low', 'medium', 'high']),
          },
          lineReply: null,
          warnings: [],
          source: 'ai',
          model: 'claude-haiku-4-5',
          generatedAt: createdAt.toISOString(),
        },
        model: 'claude-haiku-4-5',
        status: SuggestionStatus.SUGGESTED,
        createdBy: 'ai:claude-haiku-4-5',
        createdAt,
      };
    }
  );
  await prisma.aiSuggestion.createMany({ data: suggestions });

  // --- Webhook events (dedupe/audit trail) ----------------------------------
  const webhookEvents: Prisma.WebhookEventCreateManyInput[] = Array.from(
    { length: 30 },
    (_, i) => ({
      id: id('evt', i),
      provider: 'LINE',
      providerEventId: `wh_${faker.string.alphanumeric(24)}`,
      signatureValid: true,
      rawPayload: {
        events: [
          {
            type: 'message',
            message: { type: 'text', text: faker.lorem.sentence() },
          },
        ],
      },
      status: WebhookStatus.PROCESSED,
      processedAt: dateBetween(ONE_YEAR_AGO, NOW),
    })
  );
  await prisma.webhookEvent.createMany({ data: webhookEvents });

  console.log('Seed complete:');
  console.table({
    users: users.length,
    companies: companies.length,
    contacts: contacts.length,
    '  ↳ with LINE': lineContacts.length,
    leads: leads.length,
    activities: activities.length,
    messages: messages.length,
    aiSuggestions: suggestions.length,
    webhookEvents: webhookEvents.length,
  });
  console.log(`Demo login password for all seeded users: ${DEMO_PASSWORD}`);
  console.log(`Admin user email: ${users[0].email}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
