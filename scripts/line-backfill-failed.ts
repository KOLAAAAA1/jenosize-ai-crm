import "dotenv/config";
import { prisma } from "../src/lib/db";
import { reprocessFailedLineWebhook } from "../src/lib/line/service";

const limit = Number(process.env.LINE_BACKFILL_LIMIT || 20);
const onlyEventId = process.env.LINE_BACKFILL_EVENT_ID?.trim();

async function candidateEventIds(): Promise<string[]> {
  if (onlyEventId) return [onlyEventId];

  const rows = await prisma.webhookEvent.findMany({
    where: { provider: "LINE", signatureValid: true, status: "FAILED" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { providerEventId: true },
  });
  return rows.map((row) => row.providerEventId);
}

async function main() {
  const eventIds = await candidateEventIds();
  if (eventIds.length === 0) {
    console.log("No signed FAILED LINE webhook events found.");
    return;
  }

  let processed = 0;
  let stillUnmapped = 0;
  let duplicates = 0;

  for (const eventId of eventIds) {
    const res = await reprocessFailedLineWebhook(prisma, eventId);
    if (!res.ok) {
      console.log(`FAIL ${eventId} - ${res.error}`);
      continue;
    }

    processed += res.processed;
    stillUnmapped += res.unmapped;
    duplicates += res.duplicates;
    console.log(
      `OK ${eventId} - processed=${res.processed} duplicates=${res.duplicates} unmapped=${res.unmapped} ignored=${res.ignored} alreadyProcessed=${res.alreadyProcessed}`,
    );
  }

  console.log(`Backfill complete: processed=${processed}, duplicates=${duplicates}, stillUnmapped=${stillUnmapped}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
