import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, screen, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const bundledAgent = app.isPackaged ? join(process.resourcesPath, "agent") : join(repoRoot, "agent");
const bridgePath = join(bundledAgent, "bin", "jarvis-bridge.mjs");
const configModulePath = join(bundledAgent, "src", "config.mjs");
const configModuleUrl = pathToFileURL(configModulePath).href;

let windowRef;
let jarvisWindow = null;
let orbWindow = null;
let bridgeProcess = null;
let bridgeState = "stopped";
let preferences = {};
let transcriberPromise = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

const BUILTIN_LAUNCH_APPS = [
  ["app:calculator", "Calculator", "calculator", "Windows"],
  ["app:chrome", "Google Chrome", "chrome", "Browsers"],
  ["app:discord", "Discord", "discord", "Communication"],
  ["app:edge", "Microsoft Edge", "edge", "Browsers"],
  ["app:explorer", "File Explorer", "file explorer", "Windows"],
  ["app:notepad", "Notepad", "notepad", "Windows"],
  ["app:outlook", "Outlook", "outlook", "Communication"],
  ["app:paint", "Paint", "paint", "Windows"],
  ["app:powershell", "PowerShell", "powershell", "Windows"],
  ["app:settings", "Windows Settings", "settings", "Windows"],
  ["app:spotify", "Spotify", "spotify", "Media"],
  ["app:steam", "Steam", "steam", "Games"],
  ["app:teams", "Microsoft Teams", "teams", "Communication"],
  ["app:terminal", "Windows Terminal", "terminal", "Windows"],
  ["app:task manager", "Task Manager", "task manager", "Windows"],
  ["app:vscode", "Visual Studio Code", "vscode", "Development"],
  ["app:word", "Microsoft Word", "word", "Office"],
].map(([id, name, target, group]) => ({ id, name, target, group, kind: "app", defaultEnabled: true }));

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!windowRef || windowRef.isDestroyed()) return;
  if (windowRef.isMinimized()) windowRef.restore();
  windowRef.show();
  windowRef.focus();
});

function send(channel, value) {
  if (!windowRef || windowRef.isDestroyed()) return;
  windowRef.webContents.send(channel, value);
}

function preferencePath() { return join(app.getPath("userData"), "preferences.json"); }
function loadPreferences() {
  try { preferences = JSON.parse(readFileSync(preferencePath(), "utf8")); } catch { preferences = {}; }
}
function savePreferences() {
  const file = preferencePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(preferences, null, 2), { mode: 0o600 });
}

function launchAccess() {
  return preferences.launchApps && typeof preferences.launchApps === "object" ? preferences.launchApps : {};
}

async function launchCatalog() {
  const items = [...BUILTIN_LAUNCH_APPS];
  let config;
  try {
    const { loadConfig } = await import(configModuleUrl);
    config = loadConfig();
  } catch {
    config = null;
  }

  const seenGames = new Set();
  for (const root of config?.roots ?? []) {
    const common = resolve(root);
    if (!/(?:^|\\)steamapps\\common$/i.test(common.replaceAll("/", "\\"))) continue;
    let entries;
    try { entries = await readdir(dirname(common), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !/^appmanifest_\d+\.acf$/i.test(entry.name)) continue;
      const text = await readFile(join(dirname(common), entry.name), "utf8").catch(() => "");
      const appId = text.match(/"appid"\s+"(\d+)"/i)?.[1] ?? "";
      const name = text.match(/"name"\s+"([^"]+)"/i)?.[1] ?? "";
      const installdir = text.match(/"installdir"\s+"([^"]+)"/i)?.[1] ?? "";
      const gamePath = installdir ? join(common, installdir) : "";
      if (!appId || !name || !gamePath || !existsSync(gamePath) || seenGames.has(appId)) continue;
      seenGames.add(appId);
      items.push({ id: `steam:${appId}`, name, target: `steam-game:${name}`, group: "Steam games", kind: "game", defaultEnabled: true });
    }
  }

  const access = launchAccess();
  return items.map((item) => ({
    ...item,
    enabled: Object.prototype.hasOwnProperty.call(access, item.id) ? Boolean(access[item.id]) : item.defaultEnabled,
  }));
}

async function setLaunchAccess(id, enabled) {
  const catalog = await launchCatalog();
  if (!catalog.some((item) => item.id === id)) return { ok: false, error: "That app is not in the launch list." };
  preferences.launchApps = { ...launchAccess(), [id]: Boolean(enabled) };
  savePreferences();

  const wasRunning = Boolean(bridgeProcess);
  if (wasRunning) {
    const passphrase = await unlockPassphrase();
    if (passphrase) {
      bridgeProcess.kill();
      await new Promise((done) => setTimeout(done, 250));
      startBridge(passphrase);
    }
  }
  return { ok: true, restarting: wasRunning };
}
function setState(state, detail = "") { bridgeState = state; send("bridge-state", { state, detail }); }
function nodeCommand() { return process.execPath; }
function spawnNode(args, extraEnv = {}) {
  return spawn(nodeCommand(), args, {
    cwd: bundledAgent,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...extraEnv },
    windowsHide: true,
  });
}

function startBridge(passphrase) {
  if (bridgeProcess) return { ok: false, error: "Bridge is already running." };
  if (!existsSync(bridgePath)) return { ok: false, error: `Bridge files were not found at ${bridgePath}` };
  bridgeProcess = spawnNode([bridgePath, "start"], {
    JARVIS_BRIDGE_PASSPHRASE: passphrase,
    JARVIS_LAUNCH_APPS: JSON.stringify(launchAccess()),
  });
  setState("starting");
  const read = (chunk) => {
    const text = chunk.toString();
    send("bridge-log", text);
    if (/\bConnected\./.test(text)) setState("connected");
  };
  bridgeProcess.stdout.on("data", read);
  bridgeProcess.stderr.on("data", read);
  bridgeProcess.on("error", (error) => {
    send("bridge-log", `\nProcess error: ${error.message}\n`);
    bridgeProcess = null;
    setState("stopped", error.message);
  });
  bridgeProcess.on("exit", (code, signal) => {
    bridgeProcess = null;
    setState("stopped", `Exited (${code ?? signal ?? "unknown"})`);
    send("bridge-log", `\nBridge stopped (${code ?? signal ?? "unknown"}).\n`);
  });
  return { ok: true };
}
function stopBridge() {
  if (!bridgeProcess) return { ok: true };
  bridgeProcess.kill();
  setState("stopping");
  return { ok: true };
}
function parseArgs(line) {
  const args = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  for (const match of line.matchAll(pattern)) args.push((match[1] ?? match[2] ?? match[3]).replace(/\\"/g, '"'));
  return args;
}
function commandHelp() {
  return `JARVIS desktop commands

  help                          Show this help
  status                        Show bridge state
  url <address>                 Change the JARVIS server address
  restart                       Restart the bridge connection
  folder list                   Show shared folders
  folder add <absolute-path>    Add a shared folder
  folder remove <absolute-path> Stop sharing a folder
  say "text"                   Test the configured JARVIS voice
  clear                         Clear this window's log`;
}
function runOneShot(args) {
  return new Promise((resolveResult) => {
    const child = spawnNode([bridgePath, ...args]);
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.on("error", (error) => resolveResult({ ok: false, output: error.message }));
    child.on("exit", (code) => resolveResult({ ok: code === 0, output }));
  });
}
async function unlockPassphrase() {
  if (!preferences.passphrase) return "";
  try { return safeStorage.decryptString(Buffer.from(preferences.passphrase, "base64")); } catch { return ""; }
}
async function runCommand(line) {
  const args = parseArgs(String(line ?? "").trim());
  if (!args.length) return { ok: true, output: "" };
  const command = args[0].toLowerCase();
  if (command === "help" || command === "/help") return { ok: true, output: commandHelp() };
  if (command === "status") return { ok: true, output: `Bridge: ${bridgeState}\nConfig: ${join(homedir(), ".jarvis-bridge", "config.json")}` };
  if (command === "url") {
    const address = args.slice(1).join(" ");
    if (!address) return { ok: false, output: "Usage: url https://your-live-jarvis.example.com" };
    const result = await runOneShot(["url", address]);
    if (result.output) send("bridge-log", result.output);
    if (result.ok && bridgeProcess) {
      const passphrase = await unlockPassphrase();
      if (passphrase) {
        stopBridge();
        await new Promise((done) => setTimeout(done, 250));
        startBridge(passphrase);
      }
    }
    return { ok: result.ok, output: result.ok ? "JARVIS address saved. The bridge is reconnecting." : result.output };
  }
  if (command === "clear") return { ok: true, clear: true, output: "" };
  if (command === "restart") {
    const passphrase = await unlockPassphrase();
    if (!passphrase) return { ok: false, output: "No stored passphrase. Use Connect first." };
    stopBridge();
    await new Promise((done) => setTimeout(done, 250));
    const result = startBridge(passphrase);
    return { ok: result.ok, output: result.ok ? "Bridge restarting…" : result.error };
  }
  if (command === "folder" || command === "folders") {
    const action = (args[1] ?? "list").toLowerCase();
    const result = await runOneShot(["folder", action, ...args.slice(2)]);
    if (result.output) send("bridge-log", result.output);
    if (result.ok && ["add", "remove", "rm"].includes(action) && bridgeProcess) {
      const passphrase = await unlockPassphrase();
      if (passphrase) {
        stopBridge();
        await new Promise((done) => setTimeout(done, 250));
        startBridge(passphrase);
      }
    }
    return { ok: result.ok, output: result.ok ? "" : result.output };
  }
  if (command === "say") {
    const result = await runOneShot(["say", args.slice(1).join(" ")]);
    if (result.output) send("bridge-log", result.output);
    return { ok: result.ok, output: result.ok ? "" : result.output };
  }
  return { ok: false, output: "Unknown command. Type help for the command list." };
}
async function configState() {
  const { loadConfig } = await import(configModuleUrl);
  const config = loadConfig();
  return { paired: Boolean(config?.sealed), connected: Boolean(bridgeProcess), state: bridgeState, autoUnlock: Boolean(preferences.passphrase), serverUrl: config?.serverUrl ?? "" };
}

async function openJarvisWindow() {
  const { loadConfig } = await import(configModuleUrl);
  const config = loadConfig();
  const url = String(config?.serverUrl ?? "").trim();
  if (!url) return { ok: false, error: "Pair this computer first so JARVIS knows which server to open." };

  if (jarvisWindow && !jarvisWindow.isDestroyed()) {
    jarvisWindow.show();
    jarvisWindow.focus();
    hideOrbWindow();
    return { ok: true };
  }

  jarvisWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#05080f",
    title: "JARVIS",
    icon: nativeImage.createEmpty(),
    webPreferences: {
      preload: join(__dirname, "voice-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const jarvisSession = jarvisWindow.webContents.session;
  allowMicrophone(jarvisSession);
  jarvisWindow.on("minimize", (event) => {
    event.preventDefault();
    // Stop the page recorder before handing the microphone to the orb.
    void jarvisWindow?.webContents.executeJavaScript("window.dispatchEvent(new Event('jarvis-desktop-suspend'))").catch(() => {});
    jarvisWindow?.hide();
    showOrbWindow();
  });
  jarvisWindow.on("show", hideOrbWindow);
  jarvisWindow.on("restore", hideOrbWindow);
  jarvisWindow.on("closed", () => { jarvisWindow = null; });
  jarvisWindow.webContents.on("did-fail-load", (_event, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || !windowRef || windowRef.isDestroyed()) return;
    send("bridge-log", `\nJARVIS could not load (${code}: ${description}).\nAddress: ${failedUrl}\nCheck the server URL and that the JARVIS server is online.\n`);
  });
  jarvisWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });
  try {
    await jarvisWindow.loadURL(url);
    return { ok: true };
  } catch (error) {
    jarvisWindow.close();
    jarvisWindow = null;
    return { ok: false, error: `Could not open JARVIS: ${error?.message ?? error}` };
  }
}

function allowMicrophone(session) {
  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  session.setPermissionCheckHandler((_webContents, permission) => permission === "media");
}

function positionOrbWindow() {
  if (!orbWindow || orbWindow.isDestroyed()) return;
  const { workArea } = screen.getPrimaryDisplay();
  const margin = 22;
  const [width, height] = orbWindow.getSize();
  orbWindow.setPosition(workArea.x + workArea.width - width - margin, workArea.y + workArea.height - height - margin, false);
}

function createOrbWindow() {
  if (orbWindow && !orbWindow.isDestroyed()) return orbWindow;
  orbWindow = new BrowserWindow({
    width: 104,
    height: 104,
    minWidth: 104,
    minHeight: 104,
    maxWidth: 104,
    maxHeight: 104,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    title: "JARVIS",
    webPreferences: {
      preload: join(__dirname, "voice-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  allowMicrophone(orbWindow.webContents.session);
  orbWindow.on("closed", () => { orbWindow = null; });
  orbWindow.loadFile(join(__dirname, "renderer", "orb.html"));
  orbWindow.webContents.once("did-finish-load", () => {
    positionOrbWindow();
    orbWindow?.webContents.send("orb-control", "start");
  });
  return orbWindow;
}

function showOrbWindow() {
  const orb = createOrbWindow();
  positionOrbWindow();
  orb.showInactive();
  orb.webContents.send("orb-control", "start");
}

function hideOrbWindow() {
  if (!orbWindow || orbWindow.isDestroyed()) return;
  orbWindow.webContents.send("orb-control", "stop");
  orbWindow.hide();
}

async function dispatchWakeToJarvis(text) {
  const cleanText = String(text ?? "").trim();
  if (!cleanText) return { ok: false, error: "No wake phrase was captured." };
  const opened = await openJarvisWindow();
  if (!opened.ok || !jarvisWindow || jarvisWindow.isDestroyed()) return opened;

  hideOrbWindow();
  jarvisWindow.show();
  jarvisWindow.focus();
  const eventScript = `window.dispatchEvent(new CustomEvent("jarvis-desktop-wake", { detail: ${JSON.stringify({ text: cleanText })} }));`;
  const currentUrl = jarvisWindow.webContents.getURL();
  if (/\/chat(?:[/?#]|$)/i.test(currentUrl)) {
    await jarvisWindow.webContents.executeJavaScript(eventScript).catch(() => {});
    return { ok: true };
  }

  const target = new URL(currentUrl || "http://localhost");
  target.pathname = "/chat";
  target.search = "";
  target.hash = "";
  await jarvisWindow.loadURL(target.toString());
  await jarvisWindow.webContents.executeJavaScript(eventScript).catch(() => {});
  return { ok: true };
}

async function transcribeAudio(payload) {
  const samples = payload?.samples;
  if (!(samples instanceof Float32Array) || !samples.length) {
    return { ok: false, error: "No microphone audio was captured." };
  }

  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = join(app.getPath("userData"), "models");
      return pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", { dtype: "q8" });
    })().catch((error) => {
      transcriberPromise = null;
      throw error;
    });
  }

  try {
    const transcriber = await transcriberPromise;
    const result = await transcriber(samples);
    return { ok: true, text: String(result?.text ?? "").trim() };
  } catch (error) {
    return { ok: false, error: `Desktop transcription failed: ${error?.message ?? error}` };
  }
}
async function rememberPassphrase(passphrase, remember) {
  if (!remember || !safeStorage.isEncryptionAvailable()) {
    delete preferences.passphrase;
    savePreferences();
    return;
  }
  preferences.passphrase = safeStorage.encryptString(passphrase).toString("base64");
  savePreferences();
}
async function pairMachine(values) {
  const { DEFAULT_CONFIG, loadConfig, saveConfig, sealToken, serverUrlProblem } = await import(configModuleUrl);
  const serverUrl = String(values.serverUrl ?? "").trim().replace(/\/+$/, "");
  const problem = serverUrlProblem(serverUrl);
  if (problem) return { ok: false, error: problem };
  const token = String(values.token ?? "").trim();
  if (!token.startsWith("jbr_")) return { ok: false, error: "Device tokens start with jbr_." };
  const passphrase = String(values.passphrase ?? "");
  if (passphrase.length < 10) return { ok: false, error: "Use a passphrase of at least 10 characters." };
  if (passphrase !== String(values.confirm ?? "")) return { ok: false, error: "The passphrases do not match." };
  const roots = String(values.roots ?? "").split(/\r?\n/).map((root) => root.trim()).filter(Boolean);
  const existing = loadConfig() ?? DEFAULT_CONFIG;
  saveConfig({ ...existing, serverUrl, name: String(values.name ?? "").trim() || "My computer", roots, sealed: sealToken(token, passphrase) });
  await rememberPassphrase(passphrase, Boolean(values.remember));
  return startBridge(passphrase);
}
function createWindow() {
  windowRef = new BrowserWindow({
    width: 1040, height: 720, minWidth: 760, minHeight: 560,
    backgroundColor: "#05080f", title: "JARVIS Bridge", icon: nativeImage.createEmpty(),
    // Sandboxed Electron windows require a CommonJS preload. Keeping the
    // renderer sandboxed and exposing only this narrow IPC surface means the
    // command console works without giving page code Node.js access.
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  windowRef.loadFile(join(__dirname, "renderer", "index.html"));
  // Keep the bridge console available from the taskbar while the orb takes
  // over the desktop corner as the hands-free entry point.
  windowRef.on("minimize", () => showOrbWindow());
  windowRef.on("show", hideOrbWindow);
  windowRef.on("restore", hideOrbWindow);
  windowRef.on("closed", () => {
    windowRef = null;
    // The orb is normally hidden, but a hidden BrowserWindow still keeps the
    // Electron process alive. Closing the console must therefore close the orb
    // and stop the bridge explicitly instead of relying on window-all-closed.
    if (orbWindow && !orbWindow.isDestroyed()) orbWindow.close();
    stopBridge();
    if (!app.isQuitting) app.quit();
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  loadPreferences();
  Menu.setApplicationMenu(null);
  createWindow();
  ipcMain.handle("state", configState);
  ipcMain.handle("pair", (_event, values) => pairMachine(values));
  ipcMain.handle("connect", async (_event, passphrase) => {
    const result = startBridge(String(passphrase ?? ""));
    return result;
  });
  ipcMain.handle("remember", (_event, values) => rememberPassphrase(String(values.passphrase ?? ""), Boolean(values.remember)));
  ipcMain.handle("launch-catalog", () => launchCatalog());
  ipcMain.handle("launch-access", (_event, values) =>
    setLaunchAccess(String(values?.id ?? ""), Boolean(values?.enabled))
  );
  ipcMain.handle("command", (_event, line) => runCommand(line));
  ipcMain.handle("stop", () => stopBridge());
  ipcMain.handle("startup", (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: false });
    preferences.startOnLogin = Boolean(enabled);
    savePreferences();
    return { ok: true };
  });
  ipcMain.handle("open-jarvis", () => openJarvisWindow());
  ipcMain.handle("restore-jarvis", async () => {
    const result = await openJarvisWindow();
    if (result.ok && jarvisWindow && !jarvisWindow.isDestroyed()) {
      jarvisWindow.show();
      jarvisWindow.focus();
    }
    hideOrbWindow();
    return result;
  });
  ipcMain.handle("wake-jarvis", (_event, text) => dispatchWakeToJarvis(String(text ?? "")));
  ipcMain.handle("transcribe-audio", (_event, payload) => transcribeAudio(payload));
  ipcMain.handle("open-url", (_event, url) => shell.openExternal(String(url)));
  const config = await configState();
  send("desktop-state", { ...config, startOnLogin: Boolean(preferences.startOnLogin) });
  const passphrase = await unlockPassphrase();
  if (config.paired && passphrase) startBridge(passphrase);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  app.isQuitting = true;
  if (orbWindow && !orbWindow.isDestroyed()) orbWindow.destroy();
  if (bridgeProcess) {
    bridgeProcess.kill();
    bridgeProcess = null;
  }
});
