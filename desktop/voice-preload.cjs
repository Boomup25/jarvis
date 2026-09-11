const { contextBridge, ipcRenderer } = require("electron");

// The live JARVIS page gets only microphone transcription. It never receives
// the bridge token, command API, or desktop preferences.
contextBridge.exposeInMainWorld("jarvisDesktopVoice", {
  transcribeAudio: (payload) => ipcRenderer.invoke("transcribe-audio", payload),
  wakeJarvis: (text) => ipcRenderer.invoke("wake-jarvis", text),
  restoreJarvis: () => ipcRenderer.invoke("restore-jarvis"),
  onOrbControl: (callback) => {
    const listener = (_event, value) => callback(String(value ?? ""));
    ipcRenderer.on("orb-control", listener);
    return () => ipcRenderer.removeListener("orb-control", listener);
  },
});
