/** Conversation state is separate from whether recognition is temporarily paused. */
export type VoiceSession = "off" | "waiting" | "active";
export type VoiceEvent = "arm" | "start" | "wake" | "finish" | "stop";

export function transitionVoiceSession(
  state: VoiceSession, event: VoiceEvent, wakeWordEnabled: boolean,
): VoiceSession {
  switch (event) {
    case "stop": return "off";
    case "start": return "active"; // A deliberate tap also opens a conversation.
    case "arm": return wakeWordEnabled ? "waiting" : "active";
    case "wake": return state === "waiting" ? "active" : state;
    case "finish": return state !== "off" && wakeWordEnabled ? "waiting" : "off";
  }
}

/** Match an address at the beginning, never a mention buried in other speech. */
export function stripWakePhrase(raw: string): string | null {
  const match = raw.trim().match(/^hey[\s,!.:;—–-]+jarvis(?=$|[\s,!.?:;—–-])[\s,!.?:;—–-]*/i);
  return match ? raw.trim().slice(match[0].length).trim() : null;
}

export function routeVoiceInput(state: VoiceSession, raw: string):
  | { kind: "ignore" }
  | { kind: "wake" }
  | { kind: "stop" }
  | { kind: "request"; text: string } {
  const text = raw.trim();
  if (state === "off" || !text) return { kind: "ignore" };
  const addressed = stripWakePhrase(text);
  if (state === "waiting" && addressed === null) return { kind: "ignore" };
  if (addressed === "") return { kind: "wake" };
  const request = addressed ?? text;
  const command = request.toLowerCase().replace(/[.,!?;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:jarvis )?(?:please )?(?:stop listening(?: completely)?|(?:turn|switch) off (?:the |your )?(?:mic|microphone)|mute (?:the |your )?(?:mic|microphone))(?: please)?(?: jarvis)?$/.test(command)) {
    return { kind: "stop" };
  }
  return { kind: "request", text: request };
}
