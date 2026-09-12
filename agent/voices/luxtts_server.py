#!/usr/bin/env python3
"""
A resident LuxTTS voice server for the JARVIS bridge.

Why a server and not a script: LuxTTS is PyTorch. Loading the model takes tens
of seconds. Spawning it per sentence would make every reply arrive a minute
late — so it loads once, stays resident on the GPU, and answers in milliseconds.

Point the agent at it:

    "speech": { "engine": "http", "url": "http://127.0.0.1:5111/speak" }

Run it:

    pip install -r requirements.txt          # from the LuxTTS checkout
    python luxtts_server.py --ref my-voice.wav

--ref is the reference recording whose voice gets cloned. You supply it. A
clean 10-30 second mono recording works best; a short clip with music under it
clones badly no matter what the model is.

Binds to loopback only. Nothing outside this machine can reach it.
"""

import argparse
import io
import json
from pathlib import Path
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_TEXT = 1500

# Loaded once at startup and reused. The lock matters because the bridge can
# ask for the next sentence while the previous one is still being generated,
# and most torch models are not safe to call concurrently.
_engine = None
_prompt = None
_lock = threading.Lock()
_speed = 0.82
LUXTTS_ROOT = Path(__file__).resolve().parent / "LuxTTS"

# The resident server lives beside the checkout rather than inside it. Add the
# checkout to Python's import path so `python ..\luxtts_server.py` works from
# the LuxTTS directory on Windows.
if str(LUXTTS_ROOT) not in sys.path:
    sys.path.insert(0, str(LUXTTS_ROOT))


def load(model_name: str, ref_audio: str, device: str):
    """Load LuxTTS and pre-encode the reference voice."""
    global _engine, _prompt

    try:
        from zipvoice.luxvoice import LuxTTS
    except ImportError:
        sys.exit(
            "Could not import LuxTTS.\n"
            "Run this from inside your LuxTTS/JarvisLuxTTS checkout, with its\n"
            "requirements installed:  pip install -r requirements.txt"
        )

    print(f"Loading {model_name} on {device} ...", flush=True)
    _engine = LuxTTS(model_name, device=device)

    print(f"Encoding reference voice from {ref_audio} ...", flush=True)
    _prompt = _engine.encode_prompt(ref_audio)
    print("Ready.", flush=True)


def synthesise(text: str) -> bytes:
    """Text in, WAV bytes out."""
    with _lock:
        audio = _engine.generate_speech(text, _prompt, speed=_speed)

    # The model hands back float samples; the bridge wants a real WAV file.
    import numpy as np

    samples = np.asarray(audio, dtype=np.float32).squeeze()
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > 0:
        samples = samples / peak * 0.95
    pcm = (samples * 32767.0).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(48000)  # LuxTTS generates at 48kHz
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {fmt % args}", flush=True)

    def do_GET(self):
        # A health check, so `say` can tell "not running" from "broken".
        if self.path == "/health":
            self._json(200, {"ok": True, "ready": _engine is not None})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/speak":
            return self._json(404, {"error": "not found"})

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 64_000:
            return self._json(400, {"error": "bad request size"})

        try:
            payload = json.loads(self.rfile.read(length))
        except Exception:
            return self._json(400, {"error": "malformed json"})

        text = str(payload.get("text") or "").strip()[:MAX_TEXT]
        if not text:
            return self._json(400, {"error": "no text"})

        try:
            audio = synthesise(text)
        except Exception as err:  # noqa: BLE001 - report anything, never die
            print(f"  synthesis failed: {err}", flush=True)
            return self._json(500, {"error": str(err)[:300]})

        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    def _json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    ap = argparse.ArgumentParser(description="Resident LuxTTS voice server.")
    ap.add_argument("--ref", required=True, help="Reference recording to clone (wav/mp3).")
    ap.add_argument("--model", default="YatharthS/LuxTTS", help="HuggingFace model id.")
    ap.add_argument("--port", type=int, default=5111)
    ap.add_argument(
        "--speed",
        type=float,
        default=0.82,
        help="Speech speed passed to LuxTTS. 1.0 is normal; lower is slower and more deliberate.",
    )
    ap.add_argument(
        "--device",
        default="auto",
        help="cuda, mps, cpu, or auto to pick the best available.",
    )
    args = ap.parse_args()
    global _speed
    _speed = max(0.55, min(1.15, args.speed))

    device = args.device
    if device == "auto":
        try:
            import torch

            device = (
                "cuda"
                if torch.cuda.is_available()
                else "mps"
                if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()
                else "cpu"
            )
        except ImportError:
            sys.exit("PyTorch is not installed. Install the LuxTTS requirements first.")

    if device == "cpu":
        print(
            "WARNING: running on CPU. Expect several seconds per sentence —\n"
            "         slow enough that the API voice will feel faster.",
            flush=True,
        )

    load(args.model, args.ref, device)

    # Loopback only. This must never be reachable from the network.
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Listening on http://127.0.0.1:{args.port}/speak", flush=True)
    print("Point the agent at it, then:  npm start -- say \"test\"", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
