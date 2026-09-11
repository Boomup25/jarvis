/**
 * The containment tests.
 *
 * Everything else in the bridge is plumbing; this is the part that decides
 * whether "JARVIS can see my Projects folder" also means "JARVIS can see my
 * SSH keys". The escape attempts below matter more than the happy paths.
 *
 *   npm test
 */

import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { execute } from "../src/capabilities.mjs";
import { openToken, sealToken, resolveWithinRoots, serverUrlProblem } from "../src/config.mjs";

const results = [];
const check = (name, pass, extra = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};

/* ---- a small world to test against ---------------------------------- */

const base = mkdtempSync(join(tmpdir(), "bridge-test-"));
const shared = join(base, "Shared");
const secret = join(base, "Secret");
const lookalike = join(base, "SharedPrivate"); // the prefix-confusion trap

mkdirSync(shared, { recursive: true });
mkdirSync(secret, { recursive: true });
mkdirSync(lookalike, { recursive: true });
mkdirSync(join(shared, ".ssh"), { recursive: true });

writeFileSync(join(shared, "notes.txt"), "hello from the shared folder");
writeFileSync(join(shared, "workout.md"), "# Push day");
writeFileSync(join(secret, "passwords.txt"), "SUPER SECRET");
writeFileSync(join(lookalike, "alsosecret.txt"), "ALSO SECRET");
writeFileSync(join(shared, ".ssh", "id_rsa"), "PRIVATE KEY");

// A symlink inside the shared folder that points out of it.
let symlinkWorked = true;
try {
  symlinkSync(secret, join(shared, "escape-hatch"), "junction");
} catch {
  try {
    symlinkSync(secret, join(shared, "escape-hatch"));
  } catch {
    symlinkWorked = false;
  }
}

const config = {
  roots: [shared],
  denyNames: [".git", ".ssh", "node_modules", ".env"],
  capabilities: ["system.info", "files.list", "files.read", "files.write", "files.search"],
  maxReadBytes: 512_000,
};

const ok = (r) => r.ok === true;
const refused = (r) => r.ok === false;

/* ---- the happy paths, so a refusal isn't just "everything fails" ----- */

{
  const r = await execute("files.list", { path: shared }, config);
  check("lists a shared folder", ok(r) && r.result.entries.length >= 2);

  const read = await execute("files.read", { path: join(shared, "notes.txt") }, config);
  check("reads a file inside a root", ok(read) && read.result.content.includes("hello from"));

  const search = await execute("files.search", { query: "workout" }, config);
  check("finds files by name", ok(search) && search.result.matches.length === 1);

  const write = await execute("files.write", { path: join(shared, "new", "out.txt"), content: "written" }, config);
  check("writes inside a root (creating folders)", ok(write));

  const info = await execute("system.info", {}, config);
  check("reports machine info", ok(info) && typeof info.result.hostname === "string");
  check("detects GPU presence without crashing", ok(info) && typeof info.result.gpu.cuda === "boolean");
}

/* ---- the escapes, which are the actual point ------------------------ */

{
  const r = await execute("files.read", { path: join(secret, "passwords.txt") }, config);
  check("refuses a sibling folder outside the roots", refused(r), r.error);

  const dots = await execute("files.read", { path: join(shared, "..", "Secret", "passwords.txt") }, config);
  check("refuses ../ traversal out of a root", refused(dots), dots.error);

  const deeper = await execute(
    "files.read",
    { path: join(shared, "..", "..", "..", "etc", "passwd") },
    config
  );
  check("refuses a deep ../ climb", refused(deeper), deeper.error);

  // The classic: a root of .../Shared must NOT match .../SharedPrivate
  const prefix = await execute("files.read", { path: join(lookalike, "alsosecret.txt") }, config);
  check("refuses a folder that merely shares a name prefix", refused(prefix), prefix.error);

  const denied = await execute("files.read", { path: join(shared, ".ssh", "id_rsa") }, config);
  check("refuses a deny-listed folder inside a root", refused(denied), denied.error);

  const listDenied = await execute("files.list", { path: join(shared, ".ssh") }, config);
  check("refuses to list a deny-listed folder", refused(listDenied), listDenied.error);

  if (symlinkWorked) {
    const link = await execute("files.read", { path: join(shared, "escape-hatch", "passwords.txt") }, config);
    check("refuses a symlink that points outside a root", refused(link), link.error);
  } else {
    check("refuses a symlink that points outside a root", true, "skipped: no symlink permission");
  }

  const writeOut = await execute(
    "files.write",
    { path: join(secret, "planted.txt"), content: "should never land" },
    config
  );
  check("refuses a write outside the roots", refused(writeOut), writeOut.error);

  const absolute = await execute("files.read", { path: "/etc/passwd" }, config);
  check("refuses an absolute path outside the roots", refused(absolute), absolute.error);

  // Writes resolve their nearest EXISTING ancestor, so a symlinked one must
  // not become a way to create files outside the sandbox.
  if (symlinkWorked) {
    const throughLink = await execute(
      "files.write",
      { path: join(shared, "escape-hatch", "planted.txt"), content: "nope" },
      config
    );
    check("refuses a write through a symlinked ancestor", refused(throughLink), throughLink.error);

    const deepThroughLink = await execute(
      "files.write",
      { path: join(shared, "escape-hatch", "a", "b", "planted.txt"), content: "nope" },
      config
    );
    check("refuses a deep write through a symlinked ancestor", refused(deepThroughLink), deepThroughLink.error);
  } else {
    check("refuses a write through a symlinked ancestor", true, "skipped: no symlink permission");
    check("refuses a deep write through a symlinked ancestor", true, "skipped");
  }

  const denyWrite = await execute(
    "files.write",
    { path: join(shared, ".ssh", "authorized_keys"), content: "nope" },
    config
  );
  check("refuses a write into a deny-listed folder", refused(denyWrite), denyWrite.error);
}

/* ---- capability gating ---------------------------------------------- */

{
  const noCaps = { ...config, capabilities: ["system.info"] };
  const r = await execute("files.read", { path: join(shared, "notes.txt") }, noCaps);
  check("refuses a capability this machine doesn't offer", refused(r) && r.error === "denied");

  const unknown = await execute("shell.exec", { cmd: "rm -rf /" }, config);
  check("has no arbitrary shell capability at all", refused(unknown), unknown.error);

  const noRoots = { ...config, roots: [] };
  const r2 = await execute("files.list", { path: shared }, noRoots);
  check("refuses everything when no folders are configured", refused(r2), r2.error);
}

/* ---- the encrypted token store -------------------------------------- */

{
  const sealed = sealToken("jbr_abc.def", "correct horse battery staple");
  check("sealed token isn't stored in the clear", !JSON.stringify(sealed).includes("jbr_abc"));
  check("opens with the right passphrase", openToken(sealed, "correct horse battery staple") === "jbr_abc.def");
  check("returns null for a wrong passphrase", openToken(sealed, "wrong passphrase here") === null);
  check("returns null for tampered ciphertext", openToken({ ...sealed, data: "AAAA" }, "correct horse battery staple") === null);
}

/* ---- the resolver on its own ----------------------------------------- */

{
  check(
    "root itself resolves",
    resolveWithinRoots(shared, [shared]).ok
  );
  check(
    "prefix sibling refused at resolver level",
    !resolveWithinRoots(shared + "Private", [shared]).ok
  );
  check(
    "empty path refused",
    !resolveWithinRoots("", [shared]).ok
  );
  check(
    "trailing-separator root still contains its children",
    resolveWithinRoots(join(shared, "notes.txt"), [shared + sep]).ok
  );
}

/* ---- the server URL ---------------------------------------------------
 *
 * A bad URL used to be accepted at pair time and only surface later as a bare
 * "Invalid URL" in a reconnect loop. These are the shapes people actually type.
 */
{
  const good = ["http://localhost:3000", "https://jarvis.up.railway.app", "http://192.168.1.4:3000"];
  const bad = [
    ["npm start", "a command typed at the URL prompt"],
    ["", "empty"],
    ["localhost:3000", "no scheme"],
    ["jarvis.up.railway.app", "bare hostname"],
    ["ftp://somewhere", "wrong scheme"],
    ["http://", "no host"],
  ];

  check("accepts real URLs", good.every((u) => serverUrlProblem(u) === null));
  for (const [value, why] of bad) {
    check(`rejects ${why}`, serverUrlProblem(value) !== null, JSON.stringify(value));
  }
  check(
    "explains a command typed at the URL prompt",
    /looks like a command/.test(serverUrlProblem("npm start") ?? "")
  );
}

/* ---- the resident voice server ---------------------------------------
 *
 * A heavy model has to run as a service, so the failure modes are "not
 * running", "misconfigured", and "pointed somewhere it shouldn't be". The last
 * one matters most: a remote speech URL would ship every sentence JARVIS says
 * to a third party.
 */
{
  const { speak: synth } = await import("../src/speech.mjs");

  const remote = await synth({ text: "hello" }, {
    speech: { engine: "http", url: "https://someone-else.example.com/speak" },
  }).then(() => null).catch((e) => e.message);
  check("refuses a voice server that isn't on this machine", /must point at this machine/.test(remote ?? ""), remote ?? "no error");

  const noUrl = await synth({ text: "hello" }, { speech: { engine: "http" } })
    .then(() => null).catch((e) => e.message);
  check("explains a missing speech.url", /speech.url is not set/.test(noUrl ?? ""), noUrl ?? "no error");

  const dead = await synth({ text: "hello" }, {
    speech: { engine: "http", url: "http://127.0.0.1:5999/speak" },
  }).then(() => null).catch((e) => e.message);
  check("explains an unreachable voice server", /voice server running/.test(dead ?? ""), dead ?? "no error");

  const unknown = await synth({ text: "hello" }, { speech: { engine: "nonsense" } })
    .then(() => null).catch((e) => e.message);
  check("rejects an unknown engine", /Unknown speech engine/.test(unknown ?? ""), unknown ?? "no error");

  const empty = await synth({ text: "   " }, { speech: {} })
    .then(() => null).catch((e) => e.message);
  check("refuses empty text", /Nothing to say/.test(empty ?? ""), empty ?? "no error");
}

rmSync(base, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log("  " + f.name);
  process.exit(1);
}
