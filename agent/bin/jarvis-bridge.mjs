#!/usr/bin/env node
/**
 * The JARVIS bridge agent.
 *
 *   npm run pair     register this machine and store its token
 *   npm start        connect and stay connected
 *
 * It dials OUT to your JARVIS and holds the connection open. Nothing on this
 * machine listens on a port, so there is no firewall hole and nothing for the
 * internet to find.
 */

import { existsSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, exit, env } from "node:process";
import { hostname, platform } from "node:os";
import {
  CONFIG_DIR,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  loadConfig,
  openToken,
  saveConfig,
  sealToken,
  isDenied,
  serverUrlProblem,
} from "../src/config.mjs";
import { SUPPORTED, execute } from "../src/capabilities.mjs";
import { speak as synthesise, availableEngines, defaultEngine } from "../src/speech.mjs";

const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);

const HELP = `
JARVIS bridge commands

  npm run pair
      Pair this computer with a JARVIS account and save its encrypted token.
      The live URL, device token, and bridge passphrase are entered privately
      at prompts; do not put passwords or tokens in the command itself.

  npm start
      Start the bridge and keep it connected to JARVIS.

  npm start -- help
  npm start -- /help
  npm run help
      Show this help.

  npm start -- url <address>
      Change the saved JARVIS URL without pairing again.
      Example: npm start -- url https://your-live-jarvis.example.com

      This changes only the address. It does not take a password or create a
      new token.

  npm start -- folder add <path>
      Add another shared folder after setup. Use an absolute path.
      Example: npm start -- folder add "C:\\Users\\Kerry\\Documents\\Projects"

  npm start -- folder list
      Show the folders currently shared by this bridge.

  npm start -- folder remove <path>
      Stop sharing one folder. The token and pairing stay unchanged.

  npm start -- say "<text>" [output.wav]
      Test the configured voice and write a WAV file.
      Example: npm start -- say "At your service, sir."

  npm test
      Run the bridge safety and voice regression tests.

Configuration
  Saved at: %s
  Edit speech, folders, and capabilities there when needed.

Machine capabilities offered by the bridge
  %s

Typical live setup
  1. In JARVIS: Settings → Bridge → unlock → Pair a machine.
  2. On this computer: npm run pair
  3. Start the voice server if using LuxTTS, then run: npm start
`;

async function ask(question, { silent = false } = {}) {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  if (!silent) {
    const answer = await rl.question(question);
    rl.close();
    return answer.trim();
  }

  // Hide the passphrase as it's typed.
  stdout.write(question);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  let value = "";
  await new Promise((resolve) => {
    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode?.(wasRaw ?? false);
          stdout.write("\n");
          resolve();
          return;
        }
        if (ch === "") {
          stdout.write("\n");
          exit(130);
        }
        if (ch === "" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
  rl.close();
  return value.trim();
}

/* ---- pairing --------------------------------------------------------- */

async function pair() {
  console.log("\nPairing this machine with JARVIS.\n");

  const existing = loadConfig() ?? { ...DEFAULT_CONFIG };

  // Keep asking until it's actually a URL. Saving a bad one here is how you
  // end up with a reconnect loop that only says "Invalid URL".
  let serverUrl = "";
  for (;;) {
    const answer = (await ask(`JARVIS URL [${existing.serverUrl}]: `)) || existing.serverUrl;
    const problem = serverUrlProblem(answer);
    if (!problem) {
      serverUrl = answer;
      break;
    }
    console.log(`  ${problem}\n`);
  }
  const name = (await ask(`Name for this machine [${hostname()}]: `)) || hostname();

  console.log(
    "\nIn JARVIS: Settings → Bridge → unlock, then 'Pair a machine'. Copy the token it shows once."
  );
  const token = await ask("Device token: ");
  if (!token.startsWith("jbr_")) {
    console.error("\nThat doesn't look like a device token (they start with jbr_).");
    exit(1);
  }

  const passphrase = await ask("Your bridge passphrase: ", { silent: true });
  if (!passphrase) {
    console.error("\nA passphrase is required — it's what encrypts the token on this disk.");
    exit(1);
  }
  const again = await ask("Confirm passphrase: ", { silent: true });
  if (passphrase !== again) {
    console.error("\nThose didn't match.");
    exit(1);
  }

  console.log(
    "\nWhich folders may JARVIS see? One absolute path per line, blank line when done."
  );
  console.log("Nothing outside these is reachable, ever.\n");
  const roots = [];
  for (;;) {
    const line = await ask("  folder: ");
    if (!line) break;
    roots.push(line);
  }

  saveConfig({
    ...existing,
    serverUrl: serverUrl.replace(/\/+$/, ""),
    name,
    roots,
    sealed: sealToken(token, passphrase),
  });

  console.log(`\nSaved to ${CONFIG_PATH}`);
  console.log("The token is encrypted with your passphrase — a copy of this file is useless without it.");
  console.log(`Folders shared: ${roots.length ? roots.join(", ") : "none yet (edit the config to add some)"}`);
  console.log("\nStart it with:  npm start\n");
}

/* ---- running --------------------------------------------------------- */

async function start() {
  const config = loadConfig();
  if (!config?.sealed) {
    console.error(`No pairing found at ${CONFIG_PATH}. Run:  npm run pair`);
    exit(1);
  }

  // Allow an unattended start for a service wrapper, but never default to it.
  const fromEnv = env.JARVIS_BRIDGE_PASSPHRASE;
  const passphrase = fromEnv || (await ask("Bridge passphrase: ", { silent: true }));

  const token = openToken(config.sealed, passphrase);
  if (!token) {
    console.error("\nWrong passphrase — the stored token could not be decrypted.");
    exit(1);
  }

  // A malformed serverUrl is a configuration error, not a network blip — there
  // is nothing to retry, so say exactly what's wrong and where to fix it.
  const urlProblem = serverUrlProblem(config.serverUrl);
  if (urlProblem) {
    console.error(`\nThe saved JARVIS URL is unusable.\n  ${urlProblem}`);
    console.error(`\nFix the "serverUrl" line in:\n  ${CONFIG_PATH}`);
    console.error(`\nOr set it without re-pairing:\n  npm start -- url http://localhost:3000\n`);
    exit(1);
  }

  const capabilities = config.capabilities.filter((c) => SUPPORTED.includes(c));
  if (!config.roots.length) {
    log("No folders configured. File capabilities will refuse everything until you add some.");
  }

  log(`Connecting to ${config.serverUrl} as "${config.name}"`);
  log(`Offering: ${capabilities.join(", ") || "nothing"}`);
  log(`Folders:  ${config.roots.join(", ") || "none"}`);

  let backoff = RECONNECT_MIN_MS;

  for (;;) {
    try {
      const outcome = await connect(config, token, capabilities);
      if (outcome?.replaced) {
        console.error(
          "\nThis bridge connection was replaced by another copy using the same device token.\n" +
            "Close the other JARVIS Bridge window or terminal, then start only one bridge.\n"
        );
        return;
      }
      backoff = RECONNECT_MIN_MS; // a clean close means the server is fine
      log("Disconnected. Reconnecting…");
    } catch (err) {
      log(`Connection failed: ${err?.message ?? err}`);
      if (String(err?.message ?? "").includes("401")) {
        console.error("\nThis machine has been revoked in JARVIS. Run `npm run pair` again.");
        exit(1);
      }
    }
    await new Promise((r) => setTimeout(r, backoff));
    // Back off so a server that's down doesn't get hammered, but cap it so a
    // machine that wakes from sleep reconnects within the minute.
    backoff = Math.min(RECONNECT_MAX_MS, Math.round(backoff * 1.7));
  }
}

async function connect(config, token, capabilities) {
  const url = new URL(`${config.serverUrl}/api/bridge/stream`);
  url.searchParams.set("capabilities", capabilities.join(","));
  url.searchParams.set("roots", config.roots.join("|"));
  url.searchParams.set("platform", `${platform()}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
  });

  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  log("Connected.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      if (!frame.trim() || frame.startsWith(":")) continue; // comment = heartbeat

      let event = "message";
      const dataLines = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;

      let payload;
      try {
        payload = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }

      if (event === "ready") log(`Registered as ${payload.name}`);
      else if (event === "closed") {
        log(`Server closed this connection: ${payload.reason}`);
        if (payload.reason === "replaced") return { replaced: true };
      }
      else if (event === "command") void handle(payload, config, token);
    }
  }
}

async function handle(command, config, token) {
  const started = Date.now();
  log(`→ ${command.capability} ${JSON.stringify(command.args ?? {}).slice(0, 120)}`);

  const outcome = await execute(command.capability, command.args, config);
  const ms = Date.now() - started;
  log(`← ${command.capability} ${outcome.ok ? "ok" : `refused: ${outcome.error}`} (${ms}ms)`);

  try {
    await fetch(`${config.serverUrl}/api/bridge/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: command.id, ...outcome }),
    });
  } catch (err) {
    log(`Couldn't report the result: ${err?.message ?? err}`);
  }
}

/* ---- entry ----------------------------------------------------------- */

/**
 * Change the server URL in place.
 *
 * Re-pairing would mean minting a new token and revoking the old one, which is
 * far too much ceremony for a typo in one field.
 */
async function setUrl(value) {
  const config = loadConfig();
  if (!config) {
    console.error(`No pairing found at ${CONFIG_PATH}. Run:  npm run pair`);
    exit(1);
  }
  const problem = serverUrlProblem(value);
  if (problem) {
    console.error(`\n${problem}\n`);
    exit(1);
  }
  saveConfig({ ...config, serverUrl: String(value).trim().replace(/\/+$/, "") });
  console.log(`\nJARVIS URL set to ${String(value).trim()}`);
  console.log("Your device token is untouched. Start it with:  npm start\n");
}

/* ---- shared folders -------------------------------------------------- */

function folderPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { error: "Enter an absolute folder path." };
  if (!isAbsolute(raw)) {
    return { error: "Folder paths must be absolute, for example C:\\Users\\Kerry\\Documents." };
  }

  const resolved = resolve(raw);
  if (!existsSync(resolved)) return { error: "That folder does not exist." };
  try {
    if (!statSync(resolved).isDirectory()) return { error: "That path is not a folder." };
    // Store the real path so a symlink cannot make the configured root mean
    // something different on the next start.
    return { path: realpathSync.native(resolved) };
  } catch {
    return { error: "That folder could not be inspected." };
  }
}

async function folders(action, value) {
  const config = loadConfig();
  if (!config?.sealed) {
    console.error(`No pairing found at ${CONFIG_PATH}. Run:  npm run pair`);
    exit(1);
  }

  const command = String(action ?? "list").toLowerCase();
  if (command === "list") {
    console.log(`\nShared folders (${config.roots.length}):`);
    console.log(config.roots.length ? config.roots.map((root, i) => `  ${i + 1}. ${root}`).join("\n") : "  none");
    console.log();
    return;
  }

  const checked = folderPath(value);
  if (checked.error) {
    console.error(`\n${checked.error}\n`);
    exit(1);
  }
  const root = checked.path;
  if (isDenied(root, config.denyNames)) {
    console.error("\nThat folder is on this machine's deny list.\n");
    exit(1);
  }
  const existing = config.roots.map((item) => resolve(item));

  if (command === "add") {
    if (existing.includes(root)) {
      console.log(`\nThat folder is already shared:\n  ${root}\n`);
      return;
    }
    saveConfig({ ...config, roots: [...config.roots, root] });
    console.log(`\nAdded shared folder:\n  ${root}`);
    console.log("Restart the bridge for the new folder to be offered to JARVIS.\n");
    return;
  }

  if (command === "remove" || command === "rm") {
    const index = existing.indexOf(root);
    if (index < 0) {
      console.error(`\nThat folder is not currently shared:\n  ${root}\n`);
      exit(1);
    }
    saveConfig({ ...config, roots: config.roots.filter((_, i) => i !== index) });
    console.log(`\nStopped sharing:\n  ${root}`);
    console.log("Restart the bridge for the change to take effect.\n");
    return;
  }

  console.error(`\nUnknown folder action "${command}". Use add, list, or remove.\n`);
  exit(1);
}

function showHelp() {
  console.log(HELP, CONFIG_PATH, SUPPORTED.join(", "));
}

/**
 * Try the configured voice without touching JARVIS.
 *
 *   npm start -- say "At your service, sir."
 *
 * Writes a WAV next to you and reports which engine produced it. This exists
 * because tuning a voice otherwise means editing config, restarting the agent,
 * and prodding the app — three steps to hear one sentence.
 */
async function say(text, outPath) {
  const config = loadConfig() ?? DEFAULT_CONFIG;
  const engine = config.speech?.engine ?? defaultEngine();

  console.log(`\nEngine:    ${engine}`);
  console.log(`Available: ${(await availableEngines(config)).join(", ") || "none detected"}`);
  if (config.speech?.command) console.log(`Command:   ${config.speech.command}`);

  const phrase = text || "At your service, sir. Three sets of eight, two minutes rest.";
  console.log(`Saying:    "${phrase}"\n`);

  try {
    const out = await synthesise({ text: phrase }, config);
    const file = outPath || join(CONFIG_DIR, "voice-test.wav");
    writeFileSync(file, Buffer.from(out.audio, "base64"));
    console.log(`Wrote ${out.bytes} bytes in ${out.ms}ms to:\n  ${file}\n`);
    console.log("Open that file to hear it. Happy with the voice? It's the one JARVIS will use.\n");
  } catch (err) {
    console.error(`\nThat engine failed: ${err?.message ?? err}\n`);
    console.error(`Check the "speech" block in:\n  ${CONFIG_PATH}\n`);
    exit(1);
  }
}

const mode = (argv[2] ?? "start").toLowerCase();
if (mode === "pair") await pair();
else if (mode === "url") await setUrl(argv[3]);
else if (mode === "folder" || mode === "folders") await folders(argv[3], argv.slice(4).join(" "));
else if (mode === "say") await say(argv[3], argv[4]);
else if (mode === "help" || mode === "/help" || mode === "--help" || mode === "-h") showHelp();
else if (mode === "start") await start();
else {
  console.log('Unknown command. Run `npm start -- help` to see all commands.');
  exit(1);
}
