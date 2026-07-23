import "dotenv/config";
import { prisma } from "../src/lib/db";

// Seeds a coherent Thai buy/sell LINE conversation onto one lead, so the lead's
// "LINE Chat History" panel demonstrates realistically. Idempotent: replaces any
// existing LINE messages on the target lead.
//
//   tsx scripts/seed-demo-chat.ts [leadId]     (default led_00113; deterministic across local/prod)
const LEAD_ID = process.argv[2] ?? "led_00113";

async function main() {
  const lead = await prisma.lead.findUnique({
    where: { id: LEAD_ID },
    select: { id: true, contactId: true, title: true, contact: { select: { firstName: true } } },
  });
  if (!lead) {
    console.log(`lead ${LEAD_ID} not found`);
    process.exit(1);
  }
  const name = lead.contact.firstName;

  const script: { dir: "IN" | "OUT"; text: string }[] = [
    { dir: "IN", text: "สวัสดีครับ สนใจสินค้าที่ทางบริษัทนำเสนอครับ ขอรายละเอียดเพิ่มเติมได้ไหมครับ" },
    { dir: "OUT", text: `สวัสดีครับ คุณ${name} ยินดีให้บริการครับ 🙏 ทางเรามีทั้งรุ่นมาตรฐานและรุ่นพรีเมียม ไม่ทราบว่าสนใจใช้งานประมาณกี่ชุดครับ` },
    { dir: "IN", text: "ประมาณ 50 ชุดครับ อยากได้ใบเสนอราคาด้วยครับ" },
    { dir: "OUT", text: "รับทราบครับ สำหรับ 50 ชุด ราคาประมาณ 1,428,770 บาท (รวม VAT) และมีส่วนลดพิเศษหากยืนยันภายในเดือนนี้ เดี๋ยวผมส่งใบเสนอราคาให้ทางอีเมลนะครับ" },
    { dir: "IN", text: "ขอบคุณครับ รบกวนส่งมาที่อีเมลบริษัทได้เลยครับ จะนำเสนอผู้บริหารต่อ" },
    { dir: "OUT", text: "ส่งให้แล้วนะครับ หากมีข้อสงสัยเรื่องสเปกหรือเงื่อนไขการชำระเงิน แจ้งได้ตลอดครับ" },
    { dir: "IN", text: "โอเคครับ ผู้บริหารน่าจะพิจารณาสัปดาห์หน้า เดี๋ยวอัปเดตให้นะครับ" },
  ];

  await prisma.message.deleteMany({ where: { leadId: LEAD_ID, channel: "LINE" } });

  const start = Date.now() - 2 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < script.length; i++) {
    const m = script[i];
    await prisma.message.create({
      data: {
        leadId: LEAD_ID,
        contactId: lead.contactId,
        channel: "LINE",
        direction: m.dir,
        status: m.dir === "IN" ? "RECEIVED" : "SENT",
        providerMessageId: `demo:chat:${LEAD_ID}:${i}`,
        body: m.text,
        createdAt: new Date(start + i * 18 * 60 * 1000),
      },
    });
  }

  console.log(`Seeded ${script.length} demo LINE messages onto ${LEAD_ID} ("${lead.title}").`);
  await prisma.$disconnect();
}

main();
