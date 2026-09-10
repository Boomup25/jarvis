/**
 * Optional starter data so the app isn't empty on first run.
 * Run with:  npm run db:seed
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.profile.upsert({
    where: { id: "me" },
    update: {},
    create: {
      id: "me",
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
    const exists = await prisma.memory.findFirst({ where: { content: memory.content } });
    if (!exists) await prisma.memory.create({ data: { ...memory, source: "seed" } });
  }

  console.log("Seeded profile and starter memories.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
