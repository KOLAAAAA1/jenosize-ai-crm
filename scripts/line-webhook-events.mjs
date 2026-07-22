import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const LOCAL_DOCKER_URL = "postgresql://crm:crm@localhost:5432/crm?schema=public";
const limit = Number(process.env.LINE_EVENTS_LIMIT || 20);
const includeEmpty = process.env.LINE_EVENTS_INCLUDE_EMPTY === "true";
const connectionString = process.env.DATABASE_URL?.trim() || LOCAL_DOCKER_URL;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

function eventsFrom(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object") return [];
  const events = rawPayload.events;
  return Array.isArray(events) ? events : [];
}

function text(value, max = 64) {
  if (typeof value !== "string") return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function eventRows(webhookEvents, contactByLineId) {
  return webhookEvents.flatMap((row) => {
    const events = eventsFrom(row.rawPayload);
    if (events.length === 0) {
      return [
        {
          createdAt: row.createdAt.toISOString(),
          status: row.status,
          webhookEventId: row.providerEventId,
          lineUserId: "",
          messageId: "",
          text: "",
          mappedContact: "",
          leadId: "",
        },
      ];
    }

    return events.map((event) => {
      const lineUserId = typeof event?.source?.userId === "string" ? event.source.userId : "";
      const contact = lineUserId ? contactByLineId.get(lineUserId) : null;
      return {
        createdAt: row.createdAt.toISOString(),
        status: row.status,
        webhookEventId: typeof event?.webhookEventId === "string" ? event.webhookEventId : row.providerEventId,
        lineUserId,
        messageId: typeof event?.message?.id === "string" ? event.message.id : "",
        text: text(event?.message?.text),
        mappedContact: contact ? `${contact.name} (${contact.id})` : "",
        leadId: contact?.leads?.[0]?.id ?? "",
      };
    });
  });
}

async function main() {
  const webhookEvents = await prisma.webhookEvent.findMany({
    where: { provider: "LINE", signatureValid: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const lineUserIds = [
    ...new Set(
      webhookEvents
        .flatMap((row) => eventsFrom(row.rawPayload))
        .map((event) => event?.source?.userId)
        .filter((id) => typeof id === "string" && id.length > 0),
    ),
  ];

  const contacts = lineUserIds.length
    ? await prisma.contact.findMany({
        where: { lineUserId: { in: lineUserIds } },
        select: {
          id: true,
          name: true,
          lineUserId: true,
          leads: { select: { id: true }, orderBy: { updatedAt: "desc" }, take: 1 },
        },
      })
    : [];

  const contactByLineId = new Map(contacts.map((contact) => [contact.lineUserId, contact]));
  const rows = eventRows(webhookEvents, contactByLineId).filter((row) => includeEmpty || row.lineUserId);

  if (rows.length === 0) {
    console.log("No signed LINE webhook source user IDs found.");
    console.log("Send a LINE OA message to the deployed webhook, then rerun this command.");
    console.log("Set LINE_EVENTS_INCLUDE_EMPTY=true to inspect signed webhook rows without source user IDs.");
    return;
  }

  console.table(rows);
  console.log("Use a row's lineUserId in the CRM contact edit form, then rerun `pnpm smoke:deploy` with SMOKE_LINE_USER_ID set.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
