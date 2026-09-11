const { contextBridge, ipcRenderer } = require("electron");

// The live JARVIS page gets only microphone transcription. It never receives
// the bridge token, command API, or desktop preferences.
contextBridge.exposeInMainWorld("jarvisDesktopVoice", {
  transcribeAudio: (payload) => ipcRenderer.invoke("transcribe-audio", payload),
});
