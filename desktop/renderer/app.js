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

if (!api) {
  output.textContent = "The desktop bridge did not load. Please reinstall the latest JARVIS Bridge installer.\n";
  throw new Error("JARVIS desktop preload API is unavailable");
}

let state = { paired: false, connected: false, state: "stopped", startOnLogin: false };
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
  pairForm.classList.toggle("hidden", paired);
  unlockForm.classList.toggle("hidden", !paired);
  setupTitle.textContent = paired ? "Unlock this computer" : "Connect this computer";
  setupCopy.textContent = paired ? "Enter the bridge passphrase to start the saved connection." : "Use the device token from Settings → Bridge in JARVIS.";
}
function hideSetup() { setup.classList.add("hidden"); setupError.textContent = ""; }

api.onLog(write);
api.onState((next) => { setStatus(next); if (next.state === "connected") hideSetup(); });
api.onDesktopState((next) => { setStatus(next); startup.checked = Boolean(next.startOnLogin); if (!next.connected) showSetup(); });

pairForm.addEventListener("submit", async (event) => {
  event.preventDefault(); setupError.textContent = "";
  const values = Object.fromEntries(new FormData(pairForm));
  values.remember = pairForm.elements.remember.checked;
  const result = await api.pair(values);
  if (!result.ok) setupError.textContent = result.error || "Pairing failed."; else hideSetup();
});
unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault(); setupError.textContent = "";
  const passphrase = unlockForm.elements.passphrase.value;
  const result = await api.connect(passphrase);
  if (!result.ok) setupError.textContent = result.error || "Could not start the bridge.";
  else { await api.remember({ passphrase, remember: unlockForm.elements.remember.checked }); unlockForm.reset(); hideSetup(); }
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
