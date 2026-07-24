import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { connectLineUserToContact } from "./liff-connect";
import { SELF_REGISTERED_COMPANY } from "./liff-register";

const NAME = "ZZ_ConnTest";
const TEST_CO = "ZZ Conn Test Co";
const U = (s: string) => `Utest_connect_${s}`;

let dbOk = false;
let companyId = "";

async function makeContact(firstName: string, coId: string, lineUserId: string | null) {
  return prisma.contact.create({ data: { companyId: coId, firstName, lastName: "x", lineUserId }, select: { id: true } });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`select 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  if (!dbOk) return;
  const co = await prisma.company.create({ data: { name: TEST_CO }, select: { id: true } });
  companyId = co.id;
});

afterAll(async () => {
  if (!dbOk) return;
  await prisma.contact.deleteMany({ where: { OR: [{ lineUserId: { startsWith: "Utest_connect_" } }, { firstName: NAME }] } }).catch(() => {});
  await prisma.company.deleteMany({ where: { name: TEST_CO } }).catch(() => {});
});

describe("connectLineUserToContact", () => {
  it("links a free LINE user to the target contact and sets consent", async (ctx) => {
    if (!dbOk) ctx.skip();
    const target = await makeContact(NAME, companyId, null);
    const res = await connectLineUserToContact(prisma, { lineUserId: U("free"), contactId: target.id, consent: true });
    expect(res).toEqual({ ok: true, contactId: target.id, outcome: "linked" });
    const row = await prisma.contact.findUnique({ where: { id: target.id } });
    expect(row?.lineUserId).toBe(U("free"));
    expect(row?.consentStatus).toBe("OPTED_IN");
  });

  it("is idempotent when already linked to the same contact", async (ctx) => {
    if (!dbOk) ctx.skip();
    const target = await makeContact(NAME, companyId, U("idem"));
    const res = await connectLineUserToContact(prisma, { lineUserId: U("idem"), contactId: target.id, consent: true });
    expect(res.ok && res.outcome).toBe("already_linked");
  });

  it("folds a leadless sentinel self-registration into the real contact (moves messages, drops sentinel)", async (ctx) => {
    if (!dbOk) ctx.skip();
    // Sentinel company name is not unique → find-or-create, mirroring the service.
    const sentinelCo =
      (await prisma.company.findFirst({ where: { name: SELF_REGISTERED_COMPANY }, select: { id: true } })) ??
      (await prisma.company.create({ data: { name: SELF_REGISTERED_COMPANY }, select: { id: true } }));

    const sentinel = await makeContact(NAME, sentinelCo.id, U("relink"));
    await prisma.message.create({ data: { contactId: sentinel.id, direction: "IN", status: "RECEIVED", body: "hi from line" } });
    const target = await makeContact(NAME, companyId, null);

    const res = await connectLineUserToContact(prisma, { lineUserId: U("relink"), contactId: target.id, consent: true });
    expect(res.ok && res.outcome).toBe("relinked_from_sentinel");

    expect(await prisma.contact.findUnique({ where: { id: sentinel.id } })).toBeNull(); // sentinel dropped
    const row = await prisma.contact.findUnique({ where: { id: target.id }, include: { messages: true } });
    expect(row?.lineUserId).toBe(U("relink"));
    expect(row?.messages.map((m) => m.body)).toContain("hi from line"); // message moved over
  });

  it("rejects when the LINE user is already linked to a different real contact", async (ctx) => {
    if (!dbOk) ctx.skip();
    await makeContact(NAME, companyId, U("other")); // a real contact already holds it
    const target = await makeContact(NAME, companyId, null);
    const res = await connectLineUserToContact(prisma, { lineUserId: U("other"), contactId: target.id, consent: true });
    expect(res).toEqual({ ok: false, reason: "line_linked_to_other" });
  });

  it("refuses to overwrite a contact already linked to a different LINE user (replayable-link guard)", async (ctx) => {
    if (!dbOk) ctx.skip();
    const target = await makeContact(NAME, companyId, U("owned")); // already linked to one user
    const res = await connectLineUserToContact(prisma, { lineUserId: U("intruder"), contactId: target.id, consent: true });
    expect(res).toEqual({ ok: false, reason: "contact_already_linked" });
    const row = await prisma.contact.findUnique({ where: { id: target.id } });
    expect(row?.lineUserId).toBe(U("owned")); // unchanged
  });

  it("rejects when the target contact does not exist", async (ctx) => {
    if (!dbOk) ctx.skip();
    const res = await connectLineUserToContact(prisma, { lineUserId: U("nope"), contactId: "con_does_not_exist", consent: true });
    expect(res).toEqual({ ok: false, reason: "contact_not_found" });
  });
});
