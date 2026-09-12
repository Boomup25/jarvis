/**
 * What the agent will actually do.
 *
 * An allowlist of named operations, not a shell. There is deliberately no
 * "run this command" capability: an assistant that reads the web and then
 * executes arbitrary strings on your machine is one prompt injection away from
 * a very bad afternoon. Adding one would be a decision to make on purpose.
 *
 * Every filesystem operation resolves its path against the configured roots
 * first, then re-checks after following symlinks, because a link inside an
 * allowed folder can still point outside it.
 */

import { execFile } from "node:child_process";
import { readdir, readFile, realpath, stat, writeFile, mkdir } from "node:fs/promises";
import { arch, cpus, homedir, hostname, platform, totalmem, release } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { isDenied, resolveWithinRoots } from "./config.mjs";
import { speak, availableEngines, defaultEngine } from "./speech.mjs";

const run = promisify(execFile);

// Launching an app by name is useful, but an unrestricted command runner would
// turn a prompt into arbitrary code execution. Keep this list explicit and
// require a shared absolute path for anything outside it.
const APP_ALIASES = {
  calculator: "calc.exe",
  chrome: "chrome.exe",
  discord: "discord.exe",
  edge: "msedge.exe",
  explorer: "explorer.exe",
  "file explorer": "explorer.exe",
  notepad: "notepad.exe",
  outlook: "outlook.exe",
  paint: "mspaint.exe",
  powershell: "powershell.exe",
  settings: "ms-settings:",
  spotify: "spotify:",
  steam: "steam.exe",
  teams: "msteams:",
  terminal: "wt.exe",
  "task manager": "taskmgr.exe",
  "visual studio code": "code.exe",
  vscode: "code.exe",
  word: "winword.exe",
};

function appAlias(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizedName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function launchIsAllowed(config, key) {
  const access = config.launchApps;
  if (!access || typeof access !== "object" || !Object.keys(access).length) return true;
  return access[key] !== false;
}

/** Find a game executable under a shared Steam common folder. */
async function findSteamGame(gameName, config) {
  if (platform() !== "win32") throw new Refused("Steam game launching is currently supported on Windows only.");

  const wanted = normalizedName(gameName);
  if (!wanted) throw new Refused("Give me the name of the game to launch.");

  for (const root of config.roots) {
    const common = resolve(root);
    const rootName = common.toLowerCase().replaceAll("/", "\\");
    if (!/(?:^|\\)steamapps\\common$/i.test(rootName)) continue;

    let folders;
    try {
      folders = await readdir(common, { withFileTypes: true });
    } catch {
      continue;
    }

    const manifests = await readSteamManifests(dirname(common));
    const manifestMatches = manifests.filter((entry) => {
      const name = normalizedName(entry.name);
      const installdir = normalizedName(entry.installdir);
      return name.includes(wanted) || wanted.includes(name) || installdir.includes(wanted) || wanted.includes(installdir);
    });
    const manifestFolders = new Set(manifestMatches.map((entry) => normalizedName(entry.installdir)));
    const gameFolders = folders.filter((entry) => {
      if (!entry.isDirectory()) return false;
      const folder = normalizedName(entry.name);
      return folder.includes(wanted) || wanted.includes(folder) || manifestFolders.has(folder);
    });
    for (const folder of gameFolders) {
      const candidates = [];
      await collectExecutables(join(common, folder.name), 0, candidates);
      candidates.sort((a, b) => scoreExecutable(b, wanted, folder.name) - scoreExecutable(a, wanted, folder.name));
      if (candidates.length) {
        const manifest = manifests.find(
          (entry) => normalizedName(entry.installdir) === normalizedName(folder.name)
        );
        return { executable: candidates[0], appId: manifest?.appId ?? "", title: manifest?.name || gameName };
      }
    }
  }

  throw new Refused(`I couldn't find an executable for "${gameName}" in the shared Steam games folder.`);

  async function readSteamManifests(steamapps) {
    let entries;
    try {
      entries = await readdir(steamapps, { withFileTypes: true });
    } catch {
      return [];
    }

    const matches = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^appmanifest_\d+\.acf$/i.test(entry.name)) continue;
      const text = await readFile(join(steamapps, entry.name), "utf8").catch(() => "");
      const appId = text.match(/"appid"\s+"(\d+)"/i)?.[1] ?? "";
      const name = text.match(/"name"\s+"([^"]+)"/i)?.[1] ?? "";
      const installdir = text.match(/"installdir"\s+"([^"]+)"/i)?.[1] ?? "";
      if (appId && installdir) matches.push({ appId, name, installdir });
    }
    return matches;
  }

  async function collectExecutables(dir, depth, out) {
    if (depth > 4 || out.length >= 80 || isDenied(dir, config.denyNames)) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (isDenied(join(dir, entry.name), config.denyNames)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await collectExecutables(full, depth + 1, out);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".exe") out.push(full);
    }
  }

  function scoreExecutable(file, wantedName, folderName) {
    const stem = normalizedName(basename(file, ".exe"));
    let score = 0;
    if (stem === wantedName) score += 100;
    if (stem === normalizedName(folderName)) score += 80;
    if (stem.includes(wantedName) || wantedName.includes(stem)) score += 30;
    if (/(crash|unins|install|setup|redist|helper|benchmark)/i.test(stem)) score -= 100;
    if (/(launcher|bootstrap|start)/i.test(stem)) score -= 10;
    return score;
  }
}

class Refused extends Error {
  constructor(message) {
    super(message);
    this.refused = true;
  }
}

/** Resolve a path, honour the deny list, and follow symlinks safely. */
async function safePath(requested, config, { mustExist = true } = {}) {
  const check = resolveWithinRoots(requested, config.roots);
  if (!check.ok) throw new Refused(check.reason);
  if (isDenied(check.path, config.denyNames)) {
    throw new Refused("That location is on this machine's deny list.");
  }

  let real = check.path;
  try {
    real = await realpath(check.path);
  } catch {
    if (mustExist) throw new Refused("That path doesn't exist.");

    // A write may be creating several folders at once, so walk up to the
    // nearest ancestor that does exist and require THAT to be inside a root
    // once symlinks are resolved. Checking only the immediate parent would
    // reject legitimate nested writes; checking none would let a symlinked
    // ancestor smuggle the destination out of the sandbox.
    let probe = dirname(check.path);
    let ancestor = null;
    for (;;) {
      ancestor = await realpath(probe).catch(() => null);
      if (ancestor) break;
      const up = dirname(probe);
      if (up === probe) break; // reached the filesystem root
      probe = up;
    }
    if (!ancestor) throw new Refused("That folder doesn't exist.");

    const ancestorCheck = resolveWithinRoots(ancestor, config.roots);
    if (!ancestorCheck.ok) throw new Refused("That path resolves outside the shared folders.");
    if (isDenied(ancestor, config.denyNames)) {
      throw new Refused("That location is on this machine's deny list.");
    }
    return check.path;
  }

  // Re-check after resolution: this is what stops a symlink escaping a root.
  const again = resolveWithinRoots(real, config.roots);
  if (!again.ok) throw new Refused("That path resolves outside the shared folders.");
  if (isDenied(real, config.denyNames)) {
    throw new Refused("That location is on this machine's deny list.");
  }
  return real;
}

/* ---- the capabilities ------------------------------------------------ */

const handlers = {
  async speak(args, config) {
    return speak(args, config);
  },

  async "system.info"(_args, config) {
    return {
      hostname: hostname(),
      platform: platform(),
      release: release(),
      arch: arch(),
      cpus: cpus().length,
      cpuModel: cpus()[0]?.model ?? "",
      totalMemGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
      home: homedir(),
      roots: config.roots,
      gpu: await detectGpu(),
      speech: { engine: config.speech?.engine ?? defaultEngine(), available: await availableEngines(config) },
      summary: `${hostname()} · ${platform()} ${arch()} · ${cpus().length} cores`,
    };
  },

  async "files.list"(args, config) {
    const dir = await safePath(args.path, config);
    const entries = await readdir(dir, { withFileTypes: true });

    const out = [];
    for (const entry of entries.slice(0, 500)) {
      if (isDenied(join(dir, entry.name), config.denyNames)) continue;
      let size = null;
      let modified = null;
      if (entry.isFile()) {
        try {
          const s = await stat(join(dir, entry.name));
          size = s.size;
          modified = s.mtimeMs;
        } catch {
          /* unreadable; list it without detail */
        }
      }
      out.push({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
        size,
        modified,
      });
    }
    return { path: dir, entries: out, summary: `${out.length} entries in ${dir}` };
  },

  async "files.search"(args, config) {
    const needle = String(args.query ?? "").toLowerCase();
    if (needle.length < 2) throw new Refused("Give me at least two characters to search for.");

    const roots = args.path ? [await safePath(args.path, config)] : config.roots;
    const matches = [];
    const limit = Math.min(200, Number(args.limit) || 60);

    for (const root of roots) {
      await walk(root, 0);
      if (matches.length >= limit) break;
    }

    async function walk(dir, depth) {
      if (depth > 6 || matches.length >= limit) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (matches.length >= limit) return;
        const full = join(dir, entry.name);
        if (isDenied(full, config.denyNames)) continue;
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
        } else if (entry.name.toLowerCase().includes(needle)) {
          let size = null;
          let modified = null;
          try {
            const s = await stat(full);
            size = s.size;
            modified = s.mtimeMs;
          } catch {
            /* ignore */
          }
          matches.push({ path: full, name: entry.name, size, modified });
        }
      }
    }

    return { matches, summary: `${matches.length} files matching "${args.query}"` };
  },

  async "files.read"(args, config) {
    const file = await safePath(args.path, config);
    const s = await stat(file);
    if (!s.isFile()) throw new Refused("That's not a file.");
    if (s.size > config.maxReadBytes) {
      throw new Refused(
        `That file is ${Math.round(s.size / 1024)}KB; this machine caps reads at ${Math.round(
          config.maxReadBytes / 1024
        )}KB.`
      );
    }
    // Text only. Handing back a binary as a giant base64 blob helps nobody.
    const BINARY = [".exe", ".dll", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".mp4", ".mp3"];
    if (BINARY.includes(extname(file).toLowerCase())) {
      throw new Refused("That looks like a binary file.");
    }
    const content = await readFile(file, "utf8");
    return { path: file, bytes: s.size, content, summary: `${s.size} bytes from ${file}` };
  },

  async "files.write"(args, config) {
    const content = String(args.content ?? "");
    if (content.length > 2_000_000) throw new Refused("That's too much to write in one go.");

    const file = await safePath(args.path, config, { mustExist: false });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
    return { path: file, bytes: Buffer.byteLength(content), summary: `Wrote ${file}` };
  },

  /**
   * Open a file, folder or link with whatever the OS considers its default.
   *
   * Deliberately not a way to run a program of the caller's choosing: the
   * target must be inside a shared root, an http(s) URL, or one of the
   * explicitly allowlisted installed-app names above.
   */
  async "app.open"(args, config) {
    const target = String(args.target ?? "").trim();
    if (!target) throw new Refused("Nothing to open.");

    if (/^steam-game:/i.test(target)) {
      const game = target.replace(/^steam-game:/i, "").trim();
      const located = await findSteamGame(game, config);
      if (located.appId) {
        if (!launchIsAllowed(config, `steam:${located.appId}`)) {
          throw new Refused(`Launching ${located.title} is disabled in Bridge Settings.`);
        }
        const steamUri = `steam://rungameid/${located.appId}`;
        await run("cmd", ["/c", "start", "", steamUri], { windowsHide: true });
        return {
          opened: steamUri,
          executable: located.executable,
          appId: located.appId,
          game: located.title,
          summary: `Sent ${located.title} to Steam to launch.`,
        };
      }
      if (!launchIsAllowed(config, `game:${normalizedName(game)}`)) {
        throw new Refused(`Launching ${located.title} is disabled in Bridge Settings.`);
      }
      await run("cmd", ["/c", "start", "", located.executable], { windowsHide: true });
      return { opened: located.executable, game: located.title, summary: `Launched ${located.title}` };
    }

    const isUrl = /^https?:\/\//i.test(target);
    const alias = APP_ALIASES[appAlias(target)];
    const aliasKey = alias === "explorer.exe"
      ? "app:explorer"
      : alias === "code.exe"
        ? "app:vscode"
        : `app:${appAlias(target)}`;
    if (alias && !launchIsAllowed(config, aliasKey)) {
      throw new Refused(`Launching ${target} is disabled in Bridge Settings.`);
    }
    const opened = isUrl
      ? target
      : alias && !isAbsolute(target)
        ? alias
        : await safePath(target, config);

    if (platform() === "win32") {
      // `start` is a cmd builtin; the empty string is the window title, which
      // it otherwise steals from a quoted first argument.
      await run("cmd", ["/c", "start", "", opened], { windowsHide: true });
    } else if (platform() === "darwin") {
      await run("open", [opened]);
    } else {
      await run("xdg-open", [opened]);
    }
    return { opened, summary: `Opened ${opened}` };
  },
};

/** Best-effort GPU detection, for deciding how speech gets synthesised. */
async function detectGpu() {
  try {
    const { stdout } = await run("nvidia-smi", [
      "--query-gpu=name,memory.total",
      "--format=csv,noheader",
    ]);
    const line = stdout.trim().split("\n")[0] ?? "";
    if (line) {
      const [name, memory] = line.split(",").map((p) => p.trim());
      return { vendor: "nvidia", name, memory, cuda: true };
    }
  } catch {
    /* no nvidia-smi on PATH, which is the common case */
  }
  return { vendor: "none", cuda: false };
}

export const SUPPORTED = Object.keys(handlers);

/**
 * Runs one command. Never throws — a refusal and a crash are both results the
 * server needs to see and write down.
 */
export async function execute(capability, args, config) {
  const handler = handlers[capability];
  if (!handler) return { ok: false, error: `This machine doesn't do "${capability}".` };
  if (!config.capabilities.includes(capability)) {
    return { ok: false, error: "denied" };
  }

  try {
    const result = await handler(args ?? {}, config);
    return { ok: true, result };
  } catch (err) {
    if (err?.refused) return { ok: false, error: err.message };
    return { ok: false, error: String(err?.message ?? err).slice(0, 400) };
  }
}

export { Refused, safePath, relative };
