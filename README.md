# JARVIS

A personal AI assistant, built as a mobile-first web app. It remembers who you are,
and when it writes something worth keeping — a workout, a recipe, a plan — it saves it
to its own page instead of regenerating it every time you ask.

Next.js 16 · TypeScript · Tailwind v4 · Prisma + Postgres · OpenRouter · deployed on Railway.

---

## What it does

**Remembers you.** Every conversation is mined for durable facts — body stats, goals,
dietary rules, equipment you own, how you like to train. Those facts are injected into
the system prompt on every turn, so it never asks twice. You can read, edit, pin and
delete anything it has learned on the Memory tab.

**Doesn't repeat itself.** Ask for a push day, it writes one and saves it to
`/pages/push-day-a`. Ask again next week and it links you back to that page instead of
inventing a new one. Two mechanisms make this work: a deterministic similarity search
that runs before the model is even called, and a `search_pages` tool the model is
instructed to call before generating anything substantial.

**Tracks what you actually did.** Mark a workout complete or log a meal, and that
history feeds back into planning — it knows not to give you legs two days running.

**Talks.** Tap the mic to start a conversation, and toggle the speaker for spoken
replies. With **Wait for “Hey Jarvis” between conversations** enabled (the default),
a goodbye or 30 seconds of quiet returns JARVIS to wake standby. Say “Hey Jarvis”
alone or followed by a question to begin again; follow-up questions need no wake
phrase. Other speech in standby does not create chat or TTS requests. “Stop
listening,” “turn off the microphone,” the mic button, or Escape turns listening
off completely; in standby, say “Hey Jarvis, stop listening.” Tap the mic to resume.

**Listen as soon as I open it** starts wake standby on page load when wake mode is
enabled. Turn wake mode off for the previous tap-to-talk behavior that closes the
mic after a sign-off or idle timeout. Recognition pauses during replies and while
settings or history are open. Errors stop listening and require a deliberate
retry. Wake standby keeps the mic on and uses the browser's speech recognizer,
which may use an online service; it is not a system-wide offline wake detector.
The page must remain open, and browser permissions/background restrictions apply.

**Briefs you.** The home tab is a dashboard — the date, an opening line written in
character, open tasks, weekly workout count, recent pages.

**Free to run.** OpenRouter with a fallback chain of free models. When one rate-limits,
it silently tries the next. Add credits later and swap one env var.

**Shareable.** Invite-only accounts. The owner mints a code from `/admin`, hands it over,
and the new person gets their own memories, pages and history — completely separate from
everyone else's. The owner pays for the API, so each account carries a monthly message
quota you can dial up or down per person.

The sign-in page also links to a public `/demo`. It shows fictional dashboard data, a gallery
of the real Brief, JARVIS, Your week and Library screens, and a small chat. It is deliberately
isolated from accounts, history, tools, the bridge and computer controls. It accepts short,
rate-limited messages, uses one fixed free model with no paid fallback, and can read replies
with the visitor's local browser voice without sending audio requests to the server.

---

## Getting it running locally

**See [SETUP.md](./SETUP.md) for the full walkthrough** — Neon database, keys,
first run. The short version:

```bash
git clone <your-repo-url> jarvis
cd jarvis
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | What to put there |
| --- | --- |
| `DATABASE_URL` | Local Postgres, or copy the one Railway generates |
| `OPENROUTER_API_KEY` | From <https://openrouter.ai/keys> — free tier is fine |
| `APP_PASSWORD` | Whatever you want to type on the login screen |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `OWNER_NAME` | What it should call you |

Then:

```bash
npx prisma migrate dev --name init   # creates the tables
npm run db:seed                      # optional starter profile
npm run dev
```

Open <http://localhost:3000>, enter your password, and start talking.

### No local Postgres?

Easiest path is to make the Railway database first (below) and point your local
`DATABASE_URL` at its public connection string. One database, same data on your phone
and your laptop.

---

## Deploying to Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**, pick it.
3. In the same project: **New → Database → PostgreSQL**. Railway wires `DATABASE_URL`
   into the app service automatically.
4. On the app service, **Variables** → add `OPENROUTER_API_KEY`, `APP_PASSWORD`,
   `SESSION_SECRET`, `OWNER_NAME`, and `OPENROUTER_SITE_URL` (your Railway URL).
5. **Settings → Networking → Generate Domain.**

`railway.json` already sets the start command to run `prisma migrate deploy` before
booting, so schema changes ship with the code. `/api/health` is the healthcheck.

### Install it on your phone

Open the Railway URL in Safari or Chrome on your phone and use *Add to Home Screen*.
The manifest sets it to standalone display, so it opens without browser chrome and
behaves like an app.

The native iOS client can use the same authenticated APIs. `POST /api/auth/mobile`
returns a 30-day signed session token for Keychain storage; send it as
`Authorization: Bearer <token>` to `/api/chat`, `/api/settings`, `/api/bridge/*`,
and `/api/speak`. When the Windows bridge is connected and speech is set to **Machine**
or **Auto**, `/api/speak` returns the LuxTTS audio generated by that computer, so the
iPhone hears the same JARVIS voice without putting the voice model or bridge token
on the phone. If the computer is offline, **Auto** can fall back to the configured
cloud voice; **Machine** fails cleanly instead.

### Run the Windows bridge desktop app

The repository also includes a desktop launcher for the bridge. It provides a
pairing form, connection logs, folder commands, voice testing, and a **Start
with Windows** option:

```powershell
npm run desktop:install
npm run desktop:start
```

Use `npm run desktop:dist` to build a Windows installer. The desktop app uses
the same encrypted bridge token as the command-line agent. If you enable
automatic startup, its optional remembered passphrase is protected with
Windows credential encryption rather than stored as plain text.

---

## How it's put together

```
src/
  app/
    page.tsx              Dashboard / daily brief
    chat/                 The conversation
    pages/                Saved-page library + individual page view
    memory/               What it knows about you, editable
    login/  signup/       Password sign-in; signup needs an invite code
    demo/                 Public, isolated portfolio demo
    admin/                Owner only: invites, accounts, quotas, data export
    api/
      chat/route.ts       Streaming loop: NDJSON events, tool calls, memory extraction
      demo/chat/route.ts  Rate-limited, no-tools demo stream on one free model
      pages/  memory/  tasks/  logs/  briefing/  models/  profile/  conversations/
      invites/  users/    Owner-only account management
      search/  export/    Global search; download everything as JSON
  components/
    ChatView.tsx          Client chat UI, stream reader, voice wiring
    ReactorOrb.tsx        The canvas particle sphere — idle, listening, thinking, speaking
    Markdown.tsx          Dependency-free Markdown → React (no raw HTML, no XSS path)
    MemoryManager.tsx     Memory + profile editor
    AdminPanel.tsx        Invite minting, per-account quotas
    useSpeech.ts          Speech recognition + synthesis hooks
  lib/
    openrouter.ts         Streaming client with model fallback chain
    prompt.ts             Builds the system prompt from profile + memory + library
    tools.ts              Tool schemas and handlers — add capabilities here
    memory.ts             Recall ranking, dedupe, background fact extraction
    pages.ts              Similarity search, slugs, the "already saved" check
    auth.ts               HMAC session cookie via Web Crypto (works in proxy + node)
    users.ts              Accounts, invites, quotas, usage accounting
    password.ts           scrypt hashing, constant-time verify
    ratelimit.ts          Sliding-window limiter for login, chat and speech
    session.ts            requireUser() — the gate every route goes through
scripts/audit-scoping.mjs Fails the build if a query forgets its userId
prisma/schema.prisma      User, Profile, Memory, Page, Conversation, Message, Task,
                          LogEntry, InviteCode, UsageRecord, SystemEvent
```

### Keeping accounts apart

Every row that belongs to a person carries a `userId`, and it is **required** in the
schema — so the compiler rejects any write that forgets it. Reads are the gap the
compiler can't close: `findMany({ where: { archived: false } })` type-checks fine and
quietly returns everyone's rows. `npm run audit` greps for exactly that and the build
refuses to run until it comes back clean. A row that's already been fetched through a
userId filter and is then updated by its primary key is marked `// audit-ok: <reason>`.

Routes never trust a client-supplied id. `requireUser()` returns the account from the
session cookie, and every query is built from that — deletes and updates use
`deleteMany`/`updateMany` so the userId lands *inside* the where clause rather than
being checked afterwards.

### The chat loop

`POST /api/chat` streams newline-delimited JSON so the UI can react to more than text:

```
{"type":"match","pages":[…]}        pages that already cover this — shown instantly
{"type":"model","model":"…"}        which model in the chain answered
{"type":"text","delta":"…"}         streamed reply
{"type":"tool_start","name":"…"}    "Checking your library…"
{"type":"page_saved","slug":"…"}    renders a link card mid-reply
{"type":"memory_saved","content":"…"}
{"type":"done","conversationId":"…"}
```

The server runs up to four tool rounds per turn, then persists the exchange and — after
the response has already reached you — runs a background pass to extract new memories
and title the conversation.

### Adding a capability

One entry in `src/lib/tools.ts`: a JSON schema and an async handler. The chat loop picks
it up automatically and the model can call it on the next turn. That's the extension
point for everything on the roadmap below.

---

## Models

Free models are the default and the chain lives in `src/lib/models.ts`. They rotate
often — `GET /api/models` returns OpenRouter's live catalogue filtered to free ones if
the chain goes stale.

When you add credits, set one env var:

```
OPENROUTER_MODELS="anthropic/claude-sonnet-4.5,deepseek/deepseek-chat-v3-0324:free"
```

First model wins; the rest are the fallback. Keep a free model at the end of the chain
as a safety net. `OPENROUTER_UTILITY_MODEL` handles the cheap background work
(memory extraction, conversation titles) — point it at something small.

A note on free models: tool calling support varies. If one starts ignoring
`search_pages` and regenerating pages you already have, move it down the chain. The
deterministic pre-check still catches most duplicates regardless of the model.

---

## Roadmap

**Phase 2 — sharper memory**
- pgvector embeddings for semantic recall instead of keyword overlap
- Memory decay and conflict resolution ("he *used to* weigh 190")
- Page versioning so revisions don't lose the original

**Phase 3 — running your day**
- Calendar and email connectors (Google OAuth) as tools
- Proactive push: a morning brief that arrives instead of waiting to be asked
- Weather, commute, and a real "your 10am moved" nudge

**Phase 4 — acting on your machine**
The piece that makes it feel like the film. The web app can't touch your PC directly,
so it needs a companion: a small local Node service that holds an authenticated
WebSocket open to this app and executes a *whitelisted* set of commands — open an app,
run a named script, control media, read a folder. The app gains one tool,
`run_on_computer`, that queues an intent; the local agent polls, confirms, executes,
and reports back.

Deliberately left for later, because the security model is the hard part: signed
commands, an explicit allowlist rather than arbitrary shell, and a confirmation step for
anything destructive. Getting that wrong turns a portfolio piece into a liability.

---

## Notes for the portfolio version

Things worth pointing at when someone reviews this:

- Streaming tool-call loop written against the raw OpenRouter SSE protocol, not an SDK
- Graceful degradation across a model fallback chain — free-tier rate limits are the norm
- The dedupe design: cheap deterministic search *and* a model-facing tool, because
  neither alone is reliable
- Markdown rendered to React elements rather than `dangerouslySetInnerHTML`
- Session auth on Web Crypto so identical code runs in the proxy and in route handlers
