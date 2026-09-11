/**
 * Speaking, on this machine.
 *
 * Synthesises to a WAV and hands the bytes back, rather than playing them
 * here. That costs a round trip but keeps one audio path for everything: the
 * browser still plays it, the reactor still pulses to the real waveform, and
 * it works the same from a phone as it does sitting at this desk.
 *
 * The text being spoken comes from a model that reads the web, so it is
 * treated as hostile input throughout. It is NEVER interpolated into a command
 * line or a script — it goes to disk as UTF-8 and the engine is pointed at the
 * file, or it goes over stdin. That is the difference between "say this" and
 * "run this".
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";

const MAX_TEXT = 1500;
const MAX_AUDIO_BYTES = 6_000_000;
const TIMEOUT_MS = 45_000;

/** A voice name from config, kept to something that can't be a script. */
const SAFE_VOICE = /^[A-Za-z0-9 ._-]{1,64}$/;

function run(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20, ...opts },
      (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message).slice(0, 300)));
        else resolve({ stdout, stderr });
      }
    );
    if (opts.stdin != null) {
      child.stdin.end(opts.stdin, "utf8");
    }
  });
}

/* ---- engines --------------------------------------------------------- */

/**
 * Windows' built-in synthesiser. Robotic, but it is already installed on every
 * Windows machine, so the pipeline can be proven before anything is downloaded.
 */
async function speakSapi(text, out, config) {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-say-"));
  const textFile = join(dir, "say.txt");
  await writeFile(textFile, text, "utf8");

  const voice = config.speech?.voice;
  const selectVoice =
    voice && SAFE_VOICE.test(voice) ? `try { $s.SelectVoice('${voice}') } catch {}` : "";
  const rate = Number.isFinite(config.speech?.rate) ? Math.max(-10, Math.min(10, config.speech.rate)) : 0;

  // The text is read from a file, never embedded in this script — a reply
  // containing a quote would otherwise be a command injection.
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Speech",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    selectVoice,
    `$s.Rate = ${rate}`,
    `$s.SetOutputToWaveFile(${psLiteral(out)})`,
    `$t = Get-Content -Raw -Encoding UTF8 ${psLiteral(textFile)}`,
    "$s.Speak($t)",
    "$s.Dispose()",
  ]
    .filter(Boolean)
    .join("; ");

  try {
    await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Single-quoted PowerShell literal. Our own paths, but quoted properly anyway. */
function psLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** macOS. Present on every Mac, same role as SAPI above. */
async function speakSay(text, out, config) {
  const voice = config.speech?.voice;
  const args = ["-o", out, "--data-format=LEI16@22050"];
  if (voice && SAFE_VOICE.test(voice)) args.unshift("-v", voice);
  // Text on stdin, so it is never part of the command line.
  args.push("-f", "-");
  await run("say", args, { stdin: text });
}

/** Linux fallback, mostly so the agent is testable off Windows. */
async function speakEspeak(text, out) {
  await run("espeak-ng", ["-w", out, "--stdin"], { stdin: text });
}

/**
 * Any external synthesiser you point it at — Piper, a Kokoro wrapper, a script
 * that drives a GPU model. Configured on this machine, like the shared folders:
 * JARVIS can ask for speech, it cannot choose what produces it.
 *
 *   "speech": {
 *     "engine": "command",
 *     "command": "piper",
 *     "args": ["-m", "C:\\voices\\en_GB-alan-medium.onnx", "-f", "{out}"],
 *     "textVia": "stdin"
 *   }
 */
async function speakCommand(text, out, config) {
  const spec = config.speech ?? {};
  if (!spec.command) throw new Error('speech.engine is "command" but speech.command is not set.');

  const dir = await mkdtemp(join(tmpdir(), "jarvis-say-"));
  const textFile = join(dir, "say.txt");
  await writeFile(textFile, text, "utf8");

  // Placeholders are substituted into ARGV entries, never into a shell string,
  // so nothing in the text can become a separate argument or a command.
  const args = (spec.args ?? []).map((arg) =>
    String(arg).replace("{out}", out).replace("{textfile}", textFile)
  );

  const via = spec.textVia ?? "stdin";
  try {
    if (via === "stdin") await run(spec.command, args, { stdin: text });
    else await run(spec.command, args); // the text reached it via {textfile}
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * A synthesiser running as a local HTTP service.
 *
 * This is how any heavy model has to be wired. Spawning a process per sentence
 * would reload PyTorch and the weights every time — tens of seconds for each
 * utterance, which is not a voice, it's a wait. A resident server loads once
 * and answers in milliseconds.
 *
 *   "speech": {
 *     "engine": "http",
 *     "url": "http://127.0.0.1:5111/speak"
 *   }
 *
 * It POSTs {"text": "..."} and expects audio bytes back. Bound to loopback, so
 * nothing is exposed beyond this machine.
 */
async function speakHttp(text, out, config) {
  const url = config.speech?.url;
  if (!url) throw new Error('speech.engine is "http" but speech.url is not set.');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`speech.url is not a valid URL: ${url}`);
  }
  // A local model server has no business being remote — that would send every
  // sentence JARVIS says to a third party without you choosing it.
  if (!["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(parsed.hostname)) {
    throw new Error(`speech.url must point at this machine, not ${parsed.hostname}.`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: config.speech?.voice ?? null }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      err?.name === "AbortError"
        ? `${url} didn't answer within ${TIMEOUT_MS / 1000}s.`
        : `Couldn't reach ${url} — is the voice server running?`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Voice server returned ${res.status}. ${detail.slice(0, 200)}`);
  }

  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length === 0) throw new Error("Voice server returned no audio.");
  await writeFile(out, audio);
}

const ENGINES = {
  sapi: speakSapi,
  say: speakSay,
  espeak: speakEspeak,
  command: speakCommand,
  http: speakHttp,
};

/** What this machine could plausibly use, in preference order. */
export function defaultEngine() {
  if (platform() === "win32") return "sapi";
  if (platform() === "darwin") return "say";
  return "espeak";
}

/** Reports which engines are actually present, for system.info. */
export async function availableEngines(config) {
  const found = [];
  const probe = async (name, file, args) => {
    try {
      await run(file, args, { timeout: 5000 });
      found.push(name);
    } catch {
      /* not installed */
    }
  };

  if (platform() === "win32") found.push("sapi"); // always present on Windows
  if (platform() === "darwin") await probe("say", "say", ["-v", "?"]);
  await probe("espeak", "espeak-ng", ["--version"]);
  if (config?.speech?.command) found.push("command");
  if (config?.speech?.url) found.push("http");
  return found;
}

/**
 * Synthesise one utterance.
 *
 * Returns base64 WAV. The caller strips it before writing the audit row —
 * there is no reason to keep a copy of every sentence JARVIS has ever said.
 */
export async function speak(args, config) {
  const text = String(args?.text ?? "").trim().slice(0, MAX_TEXT);
  if (!text) throw new Error("Nothing to say.");

  const engineName = config.speech?.engine ?? defaultEngine();
  const engine = ENGINES[engineName];
  if (!engine) throw new Error(`Unknown speech engine "${engineName}".`);

  const dir = await mkdtemp(join(tmpdir(), "jarvis-wav-"));
  const out = join(dir, "speech.wav");
  const started = Date.now();

  try {
    await engine(text, out, config);

    const info = await stat(out).catch(() => null);
    if (!info || info.size === 0) {
      throw new Error(`${engineName} produced no audio.`);
    }
    if (info.size > MAX_AUDIO_BYTES) {
      throw new Error(`That came out as ${Math.round(info.size / 1024)}KB, which is too large to send.`);
    }

    const audio = await readFile(out);
    return {
      audio: audio.toString("base64"),
      format: "wav",
      bytes: info.size,
      ms: Date.now() - started,
      engine: engineName,
      summary: `${text.length} chars via ${engineName} in ${Date.now() - started}ms`,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
