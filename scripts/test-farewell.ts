/**
 * The farewell table.
 *
 * Sign-off detection is a pile of regexes, which is exactly the kind of code
 * that quietly rots — one over-eager pattern and JARVIS hangs up mid-sentence.
 * The negatives below matter more than the positives.
 *
 *   npm test
 */
import { isFarewell } from "../src/lib/farewell";

/** Utterances that MUST close the conversation. */
const ENDS = [
  "bye",
  "Bye!",
  "byeee",
  "bye bye",
  "goodbye",
  "Goodbye, JARVIS.",
  "good night",
  "Goodnight JARVIS",
  "night",
  "see you later",
  "See ya!",
  "see you tomorrow",
  "talk to you later",
  "Talk to you later, JARVIS.",
  "catch you later",
  "speak to you soon",
  "later",
  "peace out",
  "cheers",
  "thanks",
  "Thanks!",
  "thank you",
  "Thank you, JARVIS.",
  "thanks a lot",
  "thanks so much",
  "thanks for the help",
  "thank you for that",
  "appreciate it",
  "much appreciated",
  "that's all",
  "That's all, JARVIS.",
  "that's it",
  "no that's it thank you",
  "No, that's all, thank you.",
  "that's everything, thanks",
  "that's everything",
  "that's perfect",
  "that'll be all",
  "that'll do",
  "that will be all",
  "I'm done",
  "we're done",
  "all done",
  "I'm good",
  "nothing else",
  "no that's all",
  "dismissed",
  "stand down",
  "stop listening",
  "go to sleep",
  "end the conversation",
  // filler in front
  "ok thanks",
  "okay, that's all",
  "alright, thanks JARVIS",
  "cool, thanks",
  "great, that's everything",
  "ok bye",
  "alright well that's all",
  "yeah that's it",
];

/** Utterances that MUST NOT close it — these are still the conversation. */
const CONTINUES = [
  "thanks, now what about legs",
  "thanks for that, can you also save it",
  "thank you but I wanted the other one",
  "that's all the equipment I have",
  "that's it for chest, what about back",
  "bye week is coming up, remind me",
  "see you later means what in Spanish",
  "I'm done with the warm up, what's next",
  "we're done with chest, move to triceps",
  "later today I need a meal plan",
  "good night's sleep is important right",
  "tell me about the night shift",
  "done three sets, log it",
  "I appreciate you explaining but give me more detail",
  "stop listening to that advice about cardio",
  "give me a push day",
  "what did I train this week",
  "log a set of eight",
  "no",
  "yes",
  "",
  "   ",
  "can you make that a page",
  "add milk to my tasks",
  "that's all good but change the rest times",
  "thanks that's all I need for now but tomorrow remind me to do legs and also book the squat rack",
];

let pass = 0;
const failures = [];

for (const text of ENDS) {
  if (isFarewell(text)) pass++;
  else failures.push(`should END but did not: ${JSON.stringify(text)}`);
}
for (const text of CONTINUES) {
  if (!isFarewell(text)) pass++;
  else failures.push(`should CONTINUE but ended: ${JSON.stringify(text)}`);
}

const total = ENDS.length + CONTINUES.length;
console.log(`farewell: ${pass}/${total} passed  (${ENDS.length} sign-offs, ${CONTINUES.length} non-sign-offs)`);
for (const f of failures) console.log("  " + f);
process.exit(failures.length ? 1 : 0);
