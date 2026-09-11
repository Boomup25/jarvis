import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { ChatView } from "@/components/ChatView";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { c, q } = await searchParams;
  const settings = await getSettings(user.id);

  return (
    <ChatView
      initialConversationId={c}
      initialPrompt={q}
      initialLayout={settings.chatLayout ?? "presence"}
      initialAutoListen={settings.autoListen ?? false}
      initialWakeWordEnabled={settings.wakeWordEnabled ?? true}
    />
  );
}
