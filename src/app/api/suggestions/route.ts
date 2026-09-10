import { guard } from "@/lib/session";
import { getProfile } from "@/lib/db";
import { buildInsights } from "@/lib/insights";

export const dynamic = "force-dynamic";

/**
 * Context-aware prompt chips for the chat screen.
 *
 * Derived from real state — time of day, days since training, what's missing
 * from the library — so the shortcuts change as the day and the data do,
 * rather than being a fixed list that stops being useful.
 */
export async function GET() {
  const denied = await guard();
  if (denied) return denied;

  const [profile, insights] = await Promise.all([getProfile(), buildInsights()]);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: profile.timezone,
    }).format(new Date())
  );

  const chips: { label: string; prompt: string }[] = [];

  if (insights.daysSinceWorkout !== 0) {
    chips.push({
      label: "Today's session",
      prompt: "What should I train today? Take into account what I've done recently.",
    });
  } else {
    chips.push({ label: "Log a set", prompt: "I just finished my workout. Log it." });
  }

  if (hour >= 15 && hour <= 21) {
    chips.push({ label: "Dinner", prompt: "What should I eat tonight? Something high protein." });
  } else if (hour < 11) {
    chips.push({ label: "Breakfast", prompt: "Quick high-protein breakfast before I head out." });
  }

  if (insights.totals.tasks > 0) {
    chips.push({ label: "My tasks", prompt: "What's on my list right now?" });
  } else {
    chips.push({ label: "Add a task", prompt: "Add a task: " });
  }

  chips.push({ label: "This week", prompt: "How has my week actually gone? Be honest." });

  if (insights.totals.memories < 10) {
    chips.push({ label: "Teach me about you", prompt: "Here's something you should know about me: " });
  }

  // Whatever the insights engine already decided was worth suggesting.
  for (const rec of insights.recommendations.slice(0, 2)) {
    chips.push({ label: rec.title, prompt: rec.prompt });
  }

  return Response.json({ chips: chips.slice(0, 6) });
}
