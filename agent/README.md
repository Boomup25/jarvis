# JARVIS bridge agent

Lets JARVIS reach this computer. It dials **out** to your JARVIS and holds the
connection open, so nothing here listens on a port — no forwarded ports, no
firewall holes, nothing for the internet to find.

## What it will and won't do

It runs a fixed list of named operations. There is deliberately **no "run this
command" capability**: an assistant that reads the web and then executes
arbitrary strings on your machine is one prompt injection away from a very bad
afternoon.

| Capability | What it does |
| --- | --- |
| `system.info` | Hostname, OS, CPU, RAM, whether there's a CUDA GPU |
| `files.list` | List a folder |
| `files.search` | Find files by name |
| `files.read` | Read a text file |
| `files.write` | Write a text file |
| `app.open` | Open a file, folder, or https link with the OS default |
| `speak` | Synthesise JARVIS's replies here instead of paying the API |

**The folders it can touch live in this machine's config, not in the database
and not in the web app.** JARVIS can only ask for things inside the roots you
list here, so a compromised web session can't widen its own reach. You can add
or remove roots from the command window after setup without pairing again.

Also refused, and covered by `npm test`:

- anything outside your listed roots, including `../` traversal
- a folder that merely shares a name prefix with a root (`Projects` vs `ProjectsPrivate`)
- symlinks that point out of a root — including writing *through* one
- anything on the deny list (`.ssh`, `.env`, `.git`, `node_modules`, …) even inside a root

## Setup

```bash
cd agent
npm run pair
```

It asks for:

1. **Your JARVIS URL** — e.g. `http://localhost:3000` while testing, or
   `https://jarvis.up.railway.app` once deployed. Press Enter to accept the
   default in brackets; it re-asks until you give it a real address.
2. **A device token** — in JARVIS: Settings → Bridge → unlock → *Pair a machine*.
   Shown once.
3. **Your bridge passphrase** — the same one you set in JARVIS.
4. **Which folders to share** — absolute paths, one per line.

Then:

```bash
npm start
```

It asks for the passphrase and connects.

## Why it asks for the passphrase every time

The device token is stored **encrypted** in `~/.jarvis-bridge/config.json`,
under a key derived from your bridge passphrase. A copy of that file is useless
on its own — that is the whole point of the machine-side gate. The passphrase is
held in memory only.

To run it unattended (a service, a startup task), set
`JARVIS_BRIDGE_PASSPHRASE` in the environment. That trades the second gate for
convenience, so it's opt-in rather than the default.

## Speech

JARVIS can have this machine speak its replies instead of paying the API. The
audio is sent back to your browser, so it works from your phone too, and the
reactor still pulses to the real waveform.

Out of the box it uses whatever your OS already has — SAPI on Windows — so it
works before you download anything. Robotic, but it proves the pipeline.

### Hearing it before you commit

```bash
npm start -- say "At your service, sir."
```

Writes a WAV to `~/.jarvis-bridge/voice-test.wav` and tells you which engine
made it. Use this to tune a voice — editing config and restarting the whole app
to hear one sentence gets old fast.

### Getting a voice worth listening to

SAPI is a placeholder. **Piper** is the realistic upgrade: neural, free, runs
fast on CPU, and has British male voices.

```powershell
pip install piper-tts
python -m piper.download_voices en_GB-alan-medium
```

Then in `~/.jarvis-bridge/config.json`:

```json
"speech": {
  "engine": "command",
  "command": "python",
  "args": ["-m", "piper", "-m", "en_GB-alan-medium", "-f", "{out}"],
  "textVia": "stdin"
}
```

`npm start -- say "test"` to hear it. Other en_GB voices worth trying:
`en_GB-northern_english_male-medium`, `en_GB-semaine-medium`, `en_GB-alba-medium`.

### A heavy model (LuxTTS, XTTS, anything on the GPU)

Those load for tens of seconds, so they must run as a **resident server** —
spawning one per sentence would make every reply arrive a minute late.

`voices/luxtts_server.py` does that for LuxTTS. From inside your LuxTTS
checkout, with its requirements installed:

```bash
python luxtts_server.py --ref my-voice.wav
```

Then:

```json
"speech": { "engine": "http", "url": "http://127.0.0.1:5111/speak" }
```

`--ref` is the recording whose voice gets cloned — **you supply it**. A clean
10–30 second mono recording works best; a short clip with music under it clones
badly whatever the model. Use your own voice, something you have the rights to,
or a licensed voice.

The server binds to loopback only, and the agent refuses any `speech.url` that
isn't on this machine — a remote one would ship every sentence JARVIS says to
a third party.

### Anything else that writes a WAV

```json
"speech": {
  "engine": "command",
  "command": "piper",
  "args": ["-m", "C:\\voices\\en_GB-alan-medium.onnx", "-f", "{out}"],
  "textVia": "stdin"
}
```

`{out}` is the file to write. `textVia` is `"stdin"` (default) or `"textfile"`,
in which case use `{textfile}` in the args. The same shape works for a Piper
model, a Kokoro wrapper, or a script driving a GPU model like LuxTTS.

Windows SAPI options:

```json
"speech": { "engine": "sapi", "voice": "Microsoft George Desktop", "rate": 0 }
```

**The text is never put on a command line.** It goes to disk as UTF-8 or over
stdin, and the engine is pointed at it — so a reply containing quotes, `$(…)`
or backticks is spoken, not executed. There's a test for exactly that.

Choose where speech comes from in JARVIS: Settings → Voice → *Synthesised by*.
"Auto" uses this machine when it's connected and falls back to the API.

## Changing the JARVIS URL

If you got the address wrong, fix it without re-pairing — your token stays valid:

```bash
npm start -- url http://localhost:3000
```

## Adding or changing folders

Use the bridge command window:

```bash
npm start -- folder list
npm start -- folder add "C:\\Users\\you\\Documents\\Notes"
npm start -- folder remove "C:\\Users\\you\\Documents\\Notes"
```

The add command requires an existing absolute folder and keeps the encrypted
device token untouched. Restart `npm start` after changing folders so the new
root is included in the next connection. `folder` and `folders` are both accepted.

Edit `~/.jarvis-bridge/config.json`:

```json
{
  "roots": ["C:\\Users\\you\\Projects", "C:\\Users\\you\\Documents\\Notes"],
  "capabilities": ["system.info", "files.list", "files.search", "files.read"],
  "denyNames": [".git", ".ssh", "node_modules", ".env"],
  "maxReadBytes": 512000
}
```

Removing a capability from `capabilities` means the machine stops offering it,
and JARVIS stops showing it. Restart the agent after editing.

## If you revoke it

Revoking the machine in JARVIS takes effect on its next request — no waiting,
no restart. Changing the bridge passphrase revokes every paired machine, because
their stored tokens were encrypted with the old one.

## Tests

```bash
npm test
```

The containment tests are the ones that matter — they try to escape the sandbox
and assert that each attempt is refused.
