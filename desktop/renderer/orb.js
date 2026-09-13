const orb = document.querySelector("#orb");
const canvas = document.querySelector("#orb-canvas");
const status = document.querySelector("#status");
const voice = window.jarvisDesktopVoice;

let active = false;
let recorder = null;
let stream = null;
let audioContext = null;
let analyser = null;
let monitor = 0;
let chunks = [];
let heardSpeech = false;
let quietSince = 0;
let startedAt = 0;
let generation = 0;
let visualFrame = 0;
let visualActive = false;
const points = Array.from({ length: 120 }, (_, index) => {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / 119) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = golden * index;
  return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
});

function drawOrb(time = 0) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = rect.width;
  const height = rect.height;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = width / 2;
  const cy = height / 2;
  const energy = (active ? 0.24 : 0.08) + (orb.classList.contains("transcribing") ? 0.45 : 0);
  const radius = Math.min(width, height) * (0.3 + energy * 0.08);
  ctx.clearRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.2);
  glow.addColorStop(0, `rgba(190,245,255,${0.55 + energy * 0.25})`);
  glow.addColorStop(0.16, `rgba(79,216,255,${0.32 + energy * 0.18})`);
  glow.addColorStop(1, "rgba(79,216,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.27, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(226,250,255,${0.8 + energy * 0.18})`;
  ctx.fill();
  for (let ring = 0; ring < 3; ring += 1) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * (1.18 + ring * 0.12), radius * (0.62 + ring * 0.08), time * 0.0007 + ring, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(79,216,255,${0.16 + energy * 0.18})`;
    ctx.stroke();
  }
  for (const point of points) {
    const angle = time * 0.00035;
    const x = point.x * Math.cos(angle) - point.z * Math.sin(angle);
    const z = point.x * Math.sin(angle) + point.z * Math.cos(angle);
    const scale = 1.1 / (1.9 + z);
    ctx.beginPath();
    ctx.arc(cx + x * radius * scale, cy + point.y * radius * scale, 0.75 + scale * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(150,232,255,${0.22 + scale * 0.22 + energy * 0.18})`;
    ctx.fill();
  }
  if (visualActive) visualFrame = requestAnimationFrame(drawOrb);
}

function startVisual() {
  if (visualActive) return;
  visualActive = true;
  visualFrame = requestAnimationFrame(drawOrb);
}

function stopVisual() {
  visualActive = false;
  if (visualFrame) cancelAnimationFrame(visualFrame);
  visualFrame = 0;
}

const setStatus = (text, className = "") => {
  status.textContent = text;
  orb.className = className;
};

const stopTracks = () => {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (audioContext) void audioContext.close().catch(() => {});
  audioContext = null;
  analyser = null;
};

const downsample = (input, fromRate, toRate) => {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < Math.max(start + 1, end); j += 1) sum += input[Math.min(j, input.length - 1)];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
};

const finishRecorder = (token) => {
  if (token !== generation || !recorder) return;
  const current = recorder;
  recorder = null;
  if (monitor) cancelAnimationFrame(monitor);
  monitor = 0;
  current.onstop = async () => {
    stopTracks();
    if (token !== generation || !active) return;
    if (!heardSpeech || !chunks.length) {
      setStatus("Listening");
      void listen();
      return;
    }
    setStatus("Thinking", "transcribing");
    try {
      const blob = new Blob(chunks, { type: current.mimeType || "audio/webm" });
      const buffer = await blob.arrayBuffer();
      const decoder = new AudioContext();
      const decoded = await decoder.decodeAudioData(buffer.slice(0));
      const samples = downsample(decoded.getChannelData(0), decoded.sampleRate, 16000);
      await decoder.close();
      const result = await voice.transcribeAudio({ samples });
      const text = String(result?.text ?? "").trim();
      const wake = text.match(/^\s*(?:(?:hey|okay|ok)\s+)?jarvis\b[\s,:-]*(.*)$/i);
      if (result?.ok && wake) {
        await voice.wakeJarvis(wake[1] ? `Hey Jarvis, ${wake[1]}` : "Hey Jarvis");
        active = false;
        setStatus("Opening");
        return;
      }
    } catch (error) {
      console.warn("Orb transcription failed", error);
    }
    if (token === generation && active) {
      setStatus("Listening");
      void listen();
    }
  };
  current.stop();
};

const monitorAudio = (token) => {
  if (token !== generation || !recorder || !analyser) return;
  const values = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(values);
  let energy = 0;
  for (const value of values) {
    const sample = (value - 128) / 128;
    energy += sample * sample;
  }
  const rms = Math.sqrt(energy / values.length);
  const now = performance.now();
  if (rms > 0.025) {
    heardSpeech = true;
    quietSince = 0;
  } else if (heardSpeech) {
    quietSince ||= now;
    if (now - quietSince > 1200 && now - startedAt > 700) {
      finishRecorder(token);
      return;
    }
  } else if (now - startedAt > 9000) {
    finishRecorder(token);
    return;
  }
  monitor = requestAnimationFrame(() => monitorAudio(token));
};

async function listen() {
  if (!active || recorder) return;
  const token = ++generation;
  chunks = [];
  heardSpeech = false;
  quietSince = 0;
  startedAt = performance.now();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (!active || token !== generation) { stopTracks(); return; }
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((value) => MediaRecorder.isTypeSupported(value));
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.start();
    setStatus("Listening");
    monitor = requestAnimationFrame(() => monitorAudio(token));
  } catch (error) {
    stopTracks();
    setStatus("Mic unavailable");
    console.warn("Orb microphone unavailable", error);
    if (active) window.setTimeout(() => { if (active) void listen(); }, 2500);
  }
}

function stop() {
  active = false;
  generation += 1;
  if (monitor) cancelAnimationFrame(monitor);
  monitor = 0;
  const current = recorder;
  recorder = null;
  if (current && current.state !== "inactive") {
    current.onstop = () => stopTracks();
    current.stop();
  } else stopTracks();
  setStatus("Paused");
  stopVisual();
}

function start() {
  if (active) return;
  active = true;
  startVisual();
  setStatus("Listening");
  void listen();
}

orb.addEventListener("click", () => { void voice.restoreJarvis(); });
voice?.onOrbControl?.((command) => { if (command === "start") start(); else if (command === "stop") stop(); });
