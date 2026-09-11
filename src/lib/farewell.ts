/**
 * Recognising when you've said goodbye.
 *
 * In a hands-free conversation there's no obvious moment to close the
 * microphone. Waiting for the idle timeout means it sits open for another half
 * minute after you've clearly finished, which is both wasteful and a little
 * unnerving.
 *
 * The rule is deliberately strict: the sign-off has to be the WHOLE utterance,
 * not something buried in it. "Thanks, that's perfect" ends the conversation.
 * "Thanks, now what about legs?" does not — and getting that wrong in the
 * permissive direction would cut you off mid-thought, which is far more
 * annoying than the mic staying open a few seconds too long.
 */

/** Filler that can sit around a sign-off without changing what it means. */
const FILLER =
  /^(ok|okay|alright|all ?right|right|well|so|and|um|uh|yeah|yep|yes|no|oh|hey|cool|nice|great|perfect|awesome|good)\b/;

/** Trailing address: "…, JARVIS", "…, mate", "…, buddy". */
const ADDRESS = /\b(jarvis|mate|buddy|pal|man|dude|sir)\b/g;

/**
 * Phrases that end a conversation, matched against the whole utterance once
 * filler and address have been stripped.
 */
const FAREWELLS: RegExp[] = [
  // straightforward goodbyes
  /^bye+$/,
  /^bye bye$/,
  /^goodbye$/,
  /^good ?night$/,
  /^night$/,
  /^see (you|ya)( later| soon| tomorrow| then)?$/,
  /^(catch|talk to|speak to|talk|speak) (you|ya)( later| soon| tomorrow| then)?$/,
  /^later$/,
  /^(i'?m )?(gonna |going to )?(head|take) off$/,
  /^peace( out)?$/,
  /^cheers$/,
  /^adios$/,
  /^ciao$/,

  // gratitude used as a closing move
  /^thanks?$/,
  /^thanks? (a lot|so much|very much|again|for that|for (the )?help)$/,
  /^thank you( so much| very much| again| for that| for (the )?help)?$/,
  /^(much )?appreciated$/,
  /^(i )?appreciate (it|that|you)$/,

  // explicit "we're finished"
  /^that'?s (all|it|everything|enough|great|perfect|good|fine|brilliant|lovely)$/,
  /^that'?ll (be all|do)$/,
  /^that is all$/,
  /^(i'?m|we'?re) (all )?(done|good|set|finished)$/,
  /^all (done|good|set)$/,
  /^nothing else$/,
  /^no(thing)?,? that'?s (all|it|everything)$/,
  /^(that'?s )?everything$/,
  /^we'?re finished$/,
  /^(i'?m )?finished$/,
  /^done$/,

  // dismissals, which is how you'd actually talk to JARVIS
  /^(that will be all|that would be all)$/,
  /^dismissed$/,
  /^stand down$/,
  /^(power|shut) down$/,
  /^stop listening$/,
  /^(go to )?sleep$/,
  /^end (the )?conversation$/,
  /^(you can )?go$/,
];

/**
 * Normalise an utterance for matching: lowercase, strip punctuation and the
 * name, collapse whitespace, then peel off leading filler words.
 */
function normalise(raw: string): string {
  let text = raw
    .toLowerCase()
    .replace(/[.,!?;:—–-]+/g, " ")
    .replace(ADDRESS, " ")
    .replace(/\s+/g, " ")
    .trim();

  // "ok thanks", "alright well that's all" — peel filler until nothing left to peel.
  let peeled = true;
  while (peeled && text) {
    peeled = false;
    const match = text.match(FILLER);
    if (match) {
      const rest = text.slice(match[0].length).trim();
      // Only peel if something survives; "no" on its own isn't a sign-off,
      // but it also isn't worth turning into an empty string.
      if (rest) {
        text = rest;
        peeled = true;
      }
    }
  }

  return text;
}

/**
 * True when the utterance is nothing but a sign-off.
 *
 * Length is a guard as much as the patterns are: anything long enough to carry
 * a real request alongside the thanks is left alone on purpose.
 */
export function isFarewell(raw: string): boolean {
  if (!raw) return false;
  const text = normalise(raw);
  if (!text || text.length > 40) return false;
  return FAREWELLS.some((pattern) => pattern.test(text));
}
