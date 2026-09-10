export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "page";
}

/** Cheap bag-of-words similarity used for "do I already have this page?". */
const STOP = new Set([
  "a","an","the","and","or","of","for","to","in","on","with","my","me","i",
  "how","what","do","does","make","made","give","get","can","you","is","are",
  "please","today","some","that","this","it","its","about","tell","show","again",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.endsWith("s") && w.length > 3 ? w.slice(0, -1) : w));
}

/** 0..1 — overlap of query tokens found in the candidate text. */
export function similarity(query: string, candidate: string): number {
  const q = tokenize(query);
  if (q.length === 0) return 0;
  const c = new Set(tokenize(candidate));
  let hits = 0;
  for (const t of q) if (c.has(t)) hits++;
  return hits / q.length;
}
