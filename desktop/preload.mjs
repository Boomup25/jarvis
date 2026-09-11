import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("jarvisDesktop", {
  getState: () => ipcRenderer.invoke("state"),
  pair: (values) => ipcRenderer.invoke("pair", values),
  connect: (passphrase) => ipcRenderer.invoke("connect", passphrase),
  remember: (values) => ipcRenderer.invoke("remember", values),
  command: (line) => ipcRenderer.invoke("command", line),
  stop: () => ipcRenderer.invoke("stop"),
  setStartup: (enabled) => ipcRenderer.invoke("startup", enabled),
  onLog: (callback) => ipcRenderer.on("bridge-log", (_event, value) => callback(value)),
  onState: (callback) => ipcRenderer.on("bridge-state", (_event, value) => callback(value)),
  onDesktopState: (callback) => ipcRenderer.on("desktop-state", (_event, value) => callback(value)),
});
