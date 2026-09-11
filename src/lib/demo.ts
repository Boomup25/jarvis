/** Configuration shared by the public, intentionally limited demo. */
export const DEMO_MODEL = "nex-agi/nex-n2.5-mini:free";
export const DEMO_MAX_CHARS = 2000;

export const DEMO_DASHBOARD = {
  displayName: "Colin",
  date: "Friday, October 17",
  greeting: "You have a focused day ahead. Your training plan is on track and your next saved brief is ready to review.",
  stats: { sessions: 4, streak: 6, pages: 12, memories: 8 },
  tasks: [
    { title: "Review the weekly training plan", due: "Today" },
    { title: "Prepare the afternoon project brief", due: "Today" },
    { title: "Order recovery groceries", due: "Tomorrow" },
  ],
  pages: [
    { title: "Triceps + shoulders session", type: "Workout" },
    { title: "Weekly project brief", type: "Plan" },
    { title: "High-protein recovery meals", type: "Recipe" },
  ],
  insight: "Your sample week shows four completed sessions, with a consistent six-day streak.",
} as const;

export const DEMO_SYSTEM_PROMPT = `You are JARVIS in a public portfolio demo.

Give concise, useful answers in a polished, calm assistant voice. This demo is isolated and has no access to a user's account, files, conversations, memory, browser, computer, bridge, live data, or private settings. You have no tools and cannot perform actions. Never claim that you accessed or changed anything. If someone asks for those private or advanced capabilities, explain that they need to sign in to the full JARVIS app. Do not ask for passwords, API keys, or other secrets, and do not repeat secrets if a user provides them.

The dashboard shown in this demo is fictional sample data for Colin. You may answer questions about it using this exact context, and always describe it as demo data:
- Date: ${DEMO_DASHBOARD.date}; greeting: ${DEMO_DASHBOARD.greeting}
- This week: ${DEMO_DASHBOARD.stats.sessions} sessions; day streak: ${DEMO_DASHBOARD.stats.streak} days; pages: ${DEMO_DASHBOARD.stats.pages}; memories: ${DEMO_DASHBOARD.stats.memories}
- Open tasks: ${DEMO_DASHBOARD.tasks.map((task) => `${task.title} (${task.due})`).join(", ")}
- Recent pages: ${DEMO_DASHBOARD.pages.map((page) => `${page.title} [${page.type}]`).join(", ")}
- Insight: ${DEMO_DASHBOARD.insight}`;

export function demoMessage(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, DEMO_MAX_CHARS) : "";
}
