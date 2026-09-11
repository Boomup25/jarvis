/**
 * Optional starter data so the app isn't empty on first run.
 * Run with:  npm run db:seed
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // The multi-user migration creates the owner row; this just fills in a
  // profile and a couple of starter memories for it.
  const owner = await prisma.user.findFirst({ where: { role: "owner" } });
  if (!owner) {
    console.log("No owner user yet — run `prisma migrate deploy` first.");
    return;
  }

  await prisma.profile.upsert({
    where: { userId: owner.id },
    update: {},
    create: {
      userId: owner.id,
      displayName: process.env.OWNER_NAME || "Colin",
      assistantName: "JARVIS",
      timezone: process.env.TZ || "America/Chicago",
      bio: "",
      data: { units: "imperial", goals: [], equipment: [], dietary: [] },
    },
  });

  const starters = [
    { content: "Wants a JARVIS-style assistant that runs his day.", category: "goal", importance: 4 },
    { content: "Prefers short, direct answers over long explanations.", category: "preference", importance: 4 },
  ];

  for (const memory of starters) {
    const exists = await prisma.memory.findFirst({
      where: { userId: owner.id, content: memory.content },
    });
    if (!exists) {
      await prisma.memory.create({ data: { ...memory, userId: owner.id, source: "seed" } });
    }
  }

  console.log("Seeded profile and starter memories.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
