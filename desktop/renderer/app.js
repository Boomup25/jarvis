const api = window.jarvisDesktop;
const $ = (selector) => document.querySelector(selector);
const output = $("#output");
const status = $("#status");
const setup = $("#setup");
const setupTitle = $("#setup-title");
const setupCopy = $("#setup-copy");
const pairForm = $("#pair-form");
const unlockForm = $("#unlock-form");
const setupError = $("#setup-error");
const commandForm = $("#command-form");
const commandInput = $("#command");
const startup = $("#startup");
const openJarvisButton = $("#open-jarvis");
const serverForm = $("#server-form");
const serverUrl = $("#server-url");
const connectionView = $("#connection-view");
const settingsPage = $("#settings-page");
const settingsToggle = $("#settings-toggle");
const settingsClose = $("#settings-close");
const launchApps = $("#launch-apps");

if (!api) {
  output.textContent = "The desktop bridge did not load. Please reinstall the latest JARVIS Bridge installer.\n";
  throw new Error("JARVIS desktop preload API is unavailable");
}

let state = { paired: false, connected: false, state: "stopped", startOnLogin: false };
let settingsOpen = false;
function write(text) {
  if (!text) return;
  output.textContent += `${text}${text.endsWith("\n") ? "" : "\n"}`;
  output.scrollTop = output.scrollHeight;
}
function setStatus(next) {
  state = { ...state, ...next };
  const label = state.state === "starting" ? "Connecting…" : state.state === "stopping" ? "Stopping…" : state.connected || state.state === "connected" ? "Connected" : "Stopped";
  status.textContent = label;
  status.className = `status ${label === "Connected" ? "connected" : label === "Connecting…" ? "starting" : "stopped"}`;
}
function showSetup() {
  setup.classList.remove("hidden");
  const paired = state.paired;
  const autoUnlock = paired && state.autoUnlock && state.state !== "stopped";
  pairForm.classList.toggle("hidden", paired);
  unlockForm.classList.toggle("hidden", !paired || autoUnlock);
  setupTitle.textContent = paired ? (autoUnlock ? "Starting automatically" : "Unlock this computer") : "Connect this computer";
  setupCopy.textContent = paired
    ? (autoUnlock ? "The bridge is starting with the encrypted credential saved on this Windows account." : "Enter the bridge passphrase to recover the saved connection.")
    : "Use the device token from Settings → Bridge in JARVIS.";
}
function hideSetup() { setup.classList.add("hidden"); setupError.textContent = ""; }

function showSettings(open) {
  settingsOpen = open;
  connectionView.classList.toggle("hidden", open);
  settingsPage.classList.toggle("hidden", !open);
  settingsToggle.textContent = open ? "Connection" : "Settings";
  if (open) loadLaunchApps();
}

function renderLaunchApps(items) {
  launchApps.textContent = "";
  if (!items.length) {
    launchApps.innerHTML = '<p class="muted empty-state">No supported apps or Steam games were found yet.</p>';
    return;
  }
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  for (const [group, groupItems] of groups) {
    const section = document.createElement("section");
    section.className = "launch-group";
    const heading = document.createElement("p");
    heading.className = "launch-group-title";
    heading.textContent = group;
    section.append(heading);
    for (const item of groupItems) {
      const row = document.createElement("div");
      row.className = "launch-row";
      const copy = document.createElement("div");
      copy.className = "launch-copy";
      const name = document.createElement("strong");
      name.textContent = item.name;
      const detail = document.createElement("span");
      detail.textContent = item.kind === "game" ? "Steam game" : "Installed app";
      copy.append(name, detail);
      const label = document.createElement("label");
      label.className = "toggle";
      label.title = item.enabled ? `Allow JARVIS to launch ${item.name}` : `Block JARVIS from launching ${item.name}`;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(item.enabled);
      input.dataset.id = item.id;
      const track = document.createElement("span");
      track.className = "toggle-track";
      label.append(input, track);
      row.append(copy, label);
      input.addEventListener("change", async () => {
        input.disabled = true;
        const next = input.checked;
        const result = await api.setLaunchAccess({ id: item.id, enabled: next });
        if (!result?.ok) {
          input.checked = !next;
          write(result?.error || "Could not update launch permission.");
        } else {
          label.title = next ? `Allow JARVIS to launch ${item.name}` : `Block JARVIS from launching ${item.name}`;
          write(`${next ? "Allowed" : "Blocked"} JARVIS launch access for ${item.name}.`);
        }
        input.disabled = false;
      });
      section.append(row);
    }
    launchApps.append(section);
  }
}

async function loadLaunchApps() {
  launchApps.innerHTML = '<p class="muted loading">Looking for installed apps and Steam games…</p>';
  try {
    renderLaunchApps(await api.getLaunchCatalog());
  } catch (error) {
    launchApps.innerHTML = '<p class="error">Could not load launch permissions.</p>';
    write(`Could not load launch permissions: ${error?.message ?? error}`);
  }
}

api.onLog(write);
api.onState((next) => { setStatus(next); if (next.state === "connected") hideSetup(); else if (next.state === "stopped" && state.paired) showSetup(); });
api.onDesktopState((next) => { setStatus(next); startup.checked = Boolean(next.startOnLogin); if (!next.connected) showSetup(); });

pairForm.addEventListener("submit", async (event) => {
  event.preventDefault(); setupError.textContent = "";
  const values = Object.fromEntries(new FormData(pairForm));
  const result = await api.pair(values);
  if (!result.ok) setupError.textContent = result.error || "Pairing failed."; else hideSetup();
});
unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault(); setupError.textContent = "";
  const passphrase = unlockForm.elements.passphrase.value;
  const result = await api.connect(passphrase);
  if (!result.ok) setupError.textContent = result.error || "Could not start the bridge.";
  else { unlockForm.reset(); hideSetup(); }
});
commandForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const line = commandInput.value.trim();
  if (!line) return;
  write(`> ${line}`); commandInput.value = "";
  try {
    const result = await api.command(line);
    if (result?.clear) output.textContent = "";
    if (result?.output) write(result.output);
  } catch (error) {
    write(`Command failed: ${error?.message ?? error}`);
  }
});
startup.addEventListener("change", async () => { await api.setStartup(startup.checked); write(startup.checked ? "Start with Windows enabled." : "Start with Windows disabled."); });
openJarvisButton.addEventListener("click", async () => {
  openJarvisButton.disabled = true;
  const result = await api.openJarvis();
  if (!result?.ok) write(result?.error || "Could not open JARVIS.");
  openJarvisButton.disabled = false;
});
settingsToggle.addEventListener("click", () => showSettings(!settingsOpen));
settingsClose.addEventListener("click", () => showSettings(false));
serverForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const address = serverUrl.value.trim();
  if (!address) return;
  const result = await api.command(`url "${address.replaceAll('"', '')}"`);
  if (result?.output) write(result.output);
  if (result?.ok) serverForm.querySelector("button").textContent = "Saved";
  setTimeout(() => { serverForm.querySelector("button").textContent = "Save address"; }, 1600);
});

api.getState().then((next) => { setStatus(next); startup.checked = Boolean(next.startOnLogin); serverUrl.value = next.serverUrl || ""; if (!next.connected) showSetup(); write("JARVIS Bridge console ready. Type help for commands."); }).catch((error) => {
  write(`Could not read bridge state: ${error?.message ?? error}`);
});
