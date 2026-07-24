import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { assignLeadOwner, updateLeadDealFields } from "@/lib/leads-service";

const ids = {
  admin: "test_usr_p1_admin",
  manager: "test_usr_p1_manager",
  sales: "test_usr_p1_sales",
  company: "test_cmp_p1",
  contact: "test_con_p1",
  lead: "test_led_p1",
};
let dbOk = false;

async function cleanup() {
  await prisma.lead.deleteMany({ where: { id: ids.lead } }).catch(() => {});
  await prisma.contact.deleteMany({ where: { id: ids.contact } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: ids.company } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.manager, ids.sales] } } }).catch(() => {});
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`select 1`;
    dbOk = true;
  } catch {
    return;
  }
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ids.admin, name: "P1 Admin", email: "p1-admin@test.local", passwordHash: "x", role: "ADMIN" },
      { id: ids.manager, name: "P1 Manager", email: "p1-manager@test.local", passwordHash: "x", role: "MANAGER" },
      { id: ids.sales, name: "P1 Sales", email: "p1-sales@test.local", passwordHash: "x", role: "SALES" },
    ],
  });
  await prisma.company.create({ data: { id: ids.company, name: "P1 Co" } });
  await prisma.contact.create({ data: { id: ids.contact, companyId: ids.company, firstName: "P1", lastName: "Contact" } });
  await prisma.lead.create({
    data: { id: ids.lead, title: "P1 Lead", companyId: ids.company, contactId: ids.contact, ownerId: ids.sales },
  });
});

afterAll(async () => {
  if (dbOk) await cleanup();
  await prisma.$disconnect();
});

describe("P1 deal fields and manual assignment", () => {
  it("records a value/probability/close-date change in the immutable timeline", async (ctx) => {
    if (!dbOk) ctx.skip();
    const expectedCloseAt = new Date("2026-09-30T00:00:00.000Z");
    await expect(updateLeadDealFields(prisma, {
      leadId: ids.lead,
      userId: ids.sales,
      valueTHB: 1_000_000,
      probability: 65,
      expectedCloseAt,
    })).resolves.toEqual({ ok: true, changed: true });

    await expect(prisma.lead.findUniqueOrThrow({ where: { id: ids.lead } })).resolves.toMatchObject({ valueTHB: 1_000_000, probability: 65, expectedCloseAt });
    const activity = await prisma.activity.findFirstOrThrow({
      where: { leadId: ids.lead, body: "Deal details updated." },
      orderBy: { createdAt: "desc" },
    });
    expect(activity.metadata).toMatchObject({ kind: "DEAL_FIELDS_UPDATED", to: { valueTHB: 1_000_000, probability: 65 } });
  });

  it("moves ownership only to an assignable manager or sales user and logs it", async (ctx) => {
    if (!dbOk) ctx.skip();
    await expect(assignLeadOwner(prisma, {
      leadId: ids.lead,
      userId: ids.admin,
      nextOwnerId: ids.manager,
    })).resolves.toEqual({ ok: true, changed: true });
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: ids.lead } })).resolves.toMatchObject({ ownerId: ids.manager });
    expect(await prisma.activity.count({ where: { leadId: ids.lead, body: "Lead owner changed from P1 Sales to P1 Manager." } })).toBe(1);

    await expect(assignLeadOwner(prisma, {
      leadId: ids.lead,
      userId: ids.admin,
      nextOwnerId: ids.admin,
    })).resolves.toEqual({ ok: false, error: "Select an active sales or manager user" });
  });
});
