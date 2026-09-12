const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  getState: () => ipcRenderer.invoke("state"),
  pair: (values) => ipcRenderer.invoke("pair", values),
  connect: (passphrase) => ipcRenderer.invoke("connect", passphrase),
  remember: (values) => ipcRenderer.invoke("remember", values),
  getLaunchCatalog: () => ipcRenderer.invoke("launch-catalog"),
  setLaunchAccess: (values) => ipcRenderer.invoke("launch-access", values),
  command: (line) => ipcRenderer.invoke("command", line),
  stop: () => ipcRenderer.invoke("stop"),
  setStartup: (enabled) => ipcRenderer.invoke("startup", enabled),
  openJarvis: () => ipcRenderer.invoke("open-jarvis"),
  onLog: (callback) => ipcRenderer.on("bridge-log", (_event, value) => callback(value)),
  onState: (callback) => ipcRenderer.on("bridge-state", (_event, value) => callback(value)),
  onDesktopState: (callback) => ipcRenderer.on("desktop-state", (_event, value) => callback(value)),
});
