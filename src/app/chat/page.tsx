import { ChatView } from "@/components/ChatView";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string }>;
}) {
  const { c, q } = await searchParams;
  return <ChatView initialConversationId={c} initialPrompt={q} />;
}
