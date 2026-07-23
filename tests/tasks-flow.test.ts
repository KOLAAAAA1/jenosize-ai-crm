import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { createTaskForLead, toggleTask } from "@/lib/tasks-service";

// PLAN §11.2 — Tasks & follow-up reminders. Integration test against local
// Postgres; skips gracefully if the DB is unreachable.
const ids = {
  user: "test_usr_task",
  user2: "test_usr_task2",
  company: "test_cmp_task",
  contact: "test_con_task",
  lead: "test_led_task",
};

let dbOk = false;

async function cleanup() {
  await prisma.task.deleteMany({ where: { leadId: ids.lead } }).catch(() => {});
  await prisma.lead.deleteMany({ where: { id: ids.lead } }).catch(() => {});
  await prisma.contact.deleteMany({ where: { id: ids.contact } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: ids.company } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [ids.user, ids.user2] } } }).catch(() => {});
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`select 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  if (!dbOk) return;
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ids.user, name: "Task Owner", email: "task-owner@test.local", passwordHash: "x", role: "SALES" },
      { id: ids.user2, name: "Other User", email: "task-other@test.local", passwordHash: "x", role: "SALES" },
    ],
  });
  await prisma.company.create({ data: { id: ids.company, name: "Task Co" } });
  await prisma.contact.create({ data: { id: ids.contact, companyId: ids.company, firstName: "Task", lastName: "Contact" } });
  await prisma.lead.create({
    data: { id: ids.lead, title: "Task Lead", companyId: ids.company, contactId: ids.contact, ownerId: ids.user },
  });
});

afterAll(async () => {
  if (dbOk) await cleanup();
});

describe("tasks-service", () => {
  it("creates an OPEN task on a lead", async (ctx) => {
    if (!dbOk) ctx.skip();
    const res = await createTaskForLead(prisma, { leadId: ids.lead, ownerId: ids.user, title: "Call back Friday", dueAt: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = await prisma.task.findUnique({ where: { id: res.taskId } });
    expect(t?.status).toBe("OPEN");
    expect(t?.completedAt).toBeNull();
    expect(t?.ownerId).toBe(ids.user);
  });

  it("toggles a task DONE (sets completedAt) then back to OPEN (clears it)", async (ctx) => {
    if (!dbOk) ctx.skip();
    const created = await createTaskForLead(prisma, { leadId: ids.lead, ownerId: ids.user, title: "Send quote", dueAt: null });
    if (!created.ok) throw new Error("setup failed");

    const done = await toggleTask(prisma, { taskId: created.taskId, userId: ids.user });
    expect(done).toMatchObject({ ok: true, status: "DONE", leadId: ids.lead });
    let row = await prisma.task.findUnique({ where: { id: created.taskId } });
    expect(row?.status).toBe("DONE");
    expect(row?.completedAt).not.toBeNull();

    const reopened = await toggleTask(prisma, { taskId: created.taskId, userId: ids.user });
    expect(reopened).toMatchObject({ ok: true, status: "OPEN" });
    row = await prisma.task.findUnique({ where: { id: created.taskId } });
    expect(row?.completedAt).toBeNull();
  });

  it("refuses to toggle another user's task (owner guard)", async (ctx) => {
    if (!dbOk) ctx.skip();
    const created = await createTaskForLead(prisma, { leadId: ids.lead, ownerId: ids.user, title: "Private task", dueAt: null });
    if (!created.ok) throw new Error("setup failed");

    const res = await toggleTask(prisma, { taskId: created.taskId, userId: ids.user2 });
    expect(res.ok).toBe(false);
    const row = await prisma.task.findUnique({ where: { id: created.taskId } });
    expect(row?.status).toBe("OPEN"); // unchanged
  });

  it("rejects a task on a non-existent lead", async (ctx) => {
    if (!dbOk) ctx.skip();
    const res = await createTaskForLead(prisma, { leadId: "no_such_lead", ownerId: ids.user, title: "Orphan", dueAt: null });
    expect(res.ok).toBe(false);
  });
});
