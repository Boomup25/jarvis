import assert from "node:assert/strict";
import { routeVoiceInput, stripWakePhrase, transitionVoiceSession } from "../src/lib/voiceSession";
import { isFarewell } from "../src/lib/farewell";

let checks = 0;
function check(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label);
  checks++;
}

for (const text of ["Hey Jarvis", "HEY JARVIS!", "  Hey, Jarvis.  "]) {
  check(routeVoiceInput("waiting", text), { kind: "wake" }, text);
}
for (const text of ["How are you?", "Jarvis", "They said hey Jarvis yesterday", "Hey Jarvison", "Hey Jarvis's voice", "", "   "]) {
  check(routeVoiceInput("waiting", text), { kind: "ignore" }, `standby ignores ${text}`);
}
check(stripWakePhrase("Hey Jarvis, what is today's workout?"), "what is today's workout?", "preserve question");
check(routeVoiceInput("waiting", "Hey Jarvis, what is today's workout?"),
  { kind: "request", text: "what is today's workout?" }, "wake and question in one utterance");
check(routeVoiceInput("active", "What about tomorrow?"),
  { kind: "request", text: "What about tomorrow?" }, "follow-up needs no wake phrase");
check(routeVoiceInput("active", "Hey Jarvis, log that set."),
  { kind: "request", text: "log that set." }, "optional address in active conversation");
check(routeVoiceInput("off", "Hey Jarvis, wake up"), { kind: "ignore" }, "mic off cannot wake");

for (const text of ["Stop listening", "Stop listening, Jarvis.", "Please turn off the microphone", "Hey Jarvis, mute your mic"]) {
  check(routeVoiceInput("active", text), { kind: "stop" }, `explicit mic off: ${text}`);
}
check(routeVoiceInput("waiting", "Hey Jarvis, stop listening"), { kind: "stop" }, "wake can turn the mic off");
check(routeVoiceInput("active", "Stop listening to that advice"), { kind: "request", text: "Stop listening to that advice" }, "a mention is not a microphone command");
check(isFarewell("That’s all, Jarvis."), true, "typographic apostrophe in goodbye");

let session = transitionVoiceSession("off", "arm", true);
check(session, "waiting", "auto listen begins in standby");
session = transitionVoiceSession(session, "wake", true);
check(session, "active", "wake opens conversation");
check(isFarewell("thanks, can you also save that?"), false, "gratitude plus a request continues");
check(isFarewell("That will be all, Jarvis."), true, "explicit dismissal detected");
session = transitionVoiceSession(session, "finish", true);
check(session, "waiting", "goodbye or idle returns to standby");
check(routeVoiceInput(session, "Turn on the television"), { kind: "ignore" }, "next conversation needs wake phrase");
session = transitionVoiceSession(session, "wake", true);
check(session, "active", "second conversation can wake");
session = transitionVoiceSession(session, "stop", true);
check(session, "off", "Escape and mic button stop all listening");
check(transitionVoiceSession(session, "finish", true), "off", "late idle event cannot rearm a stopped mic");
check(transitionVoiceSession("off", "start", true), "active", "manual tap can bypass wake phrase");
check(transitionVoiceSession("off", "arm", false), "active", "legacy auto listen remains available");
check(transitionVoiceSession("active", "finish", false), "off", "wake disabled closes microphone on farewell");
console.log(`voice session: ${checks}/${checks} passed`);
