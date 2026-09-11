# Local setup

Getting JARVIS running on your machine. Railway comes later — this is laptop only.

Everything below is run from a terminal inside VS Code
(Ctrl + backtick opens one) with the `jarvis` folder open.

---

## 1. Get a database (~3 min)

Neon gives you a free hosted Postgres with no install.

1. Go to <https://neon.tech> and sign up (GitHub login is fastest).
2. **Create project** — name it `jarvis`, take the default region.
3. On the dashboard you'll land on a **Connection string** panel.
4. **Important:** find the toggle or dropdown labelled **Connection pooling** and
   turn it **off**, so the host does *not* contain `-pooler`. Prisma migrations
   need the direct connection.
5. Copy the string. It looks like:

   ```
   postgresql://neondb_owner:npg_xxxx@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

Keep that tab open, you need it in the next step.

---

## 2. Create your .env

In the terminal:

```powershell
copy .env.example .env
```

Open `.env` in VS Code and set these four. Everything else can stay as-is.

```ini
DATABASE_URL="<paste the Neon string from step 1>"
OPENROUTER_API_KEY="<see step 3>"
APP_PASSWORD="<anything you'll remember — this is your login>"
SESSION_SECRET="cb241959917a85a335203d8de8bf887461a028156e3e8f7ca9490f9e3a799ead83449dace5991356c709b3851937ec1f"
OWNER_NAME="Colin"
```

I generated that `SESSION_SECRET` for you — it's random and unique to this
project. It never leaves your machine, and `.env` is already gitignored.

---

## 3. Get an OpenRouter key (~2 min)

1. <https://openrouter.ai> → sign in.
2. **Keys** → **Create Key**. Name it `jarvis-local`.
3. Copy it (starts with `sk-or-v1-`) into `OPENROUTER_API_KEY`.

No credit card needed. The app defaults to a chain of free models — you'll be
rate-limited occasionally, and it'll fall through to the next model when that
happens. Add credits whenever you want better answers; that's a one-line env
change later.

---

## 4. Install and create the tables

```powershell
npm install
npx prisma migrate dev --name init
```

`migrate dev` connects to Neon, creates all seven tables, and writes a
`prisma/migrations/` folder. Commit that folder — it's what Railway replays
on deploy later.

Optional, gives you a profile row and two starter memories:

```powershell
npm run db:seed
```

---

## 5. Run it

```powershell
npm run dev
```

Open <http://localhost:3000>. You'll get the login screen. Sign in as:

| Username | Password |
| --- | --- |
| `owner` | the `APP_PASSWORD` you chose |

The first time you do that, the app converts `APP_PASSWORD` into a proper scrypt
hash stored on your account, and `APP_PASSWORD` stops being consulted. Change the
password from Settings whenever you like; you never need to touch that env var again.

Then hit the **JARVIS** tab and try:

> Give me a push day workout. I've got dumbbells and a pull-up bar.

You should see it check the library, write the workout, and drop a link card
under the reply. Click through and it's a real page at its own URL. Ask for a
push day again and it should point you back at that page instead of writing a
new one.

Then check the **Memory** tab — it should have quietly learned that you own
dumbbells and a pull-up bar.

---

## Giving it to a friend

Accounts are invite-only — there's no open signup. As the owner:

1. Open **/admin** (the shield icon on the dashboard).
2. Type who it's for, hit **+**, and **Share** the code. That copies a link like
   `https://your-app.up.railway.app/signup?code=ABCD-EFGH-JKLM`.
3. They pick a username and password. Codes work once and expire after 14 days.

They get their own memories, pages, tasks and history. Nobody can see anybody else's.
Since your OpenRouter key pays for all of it, each account starts at 200 messages a
month — change it per person on the same screen, or disable an account outright.

---

## Testing it on your phone

While `npm run dev` is running, find your laptop's LAN address:

```powershell
ipconfig
```

Look for **IPv4 Address** under your Wi-Fi adapter, e.g. `192.168.1.42`. Then
start the dev server so it listens beyond localhost:

```powershell
npm run dev -- -H 0.0.0.0
```

On your phone, on the same Wi-Fi, open `http://192.168.1.42:3000`.

Two caveats over plain HTTP: the mic won't work (browsers require HTTPS for
speech recognition outside localhost), and *Add to Home Screen* won't behave
like a real PWA. Both work properly once it's on Railway with a real domain.

---

## If something breaks

| Symptom | Cause |
| --- | --- |
| `Can't reach database server` | Neon string wrong, or you copied the pooled one. Re-check step 1.4. |
| `prisma generate` fails on install | Corporate network or VPN blocking `binaries.prisma.sh`. Disconnect and retry `npm install`. |
| `SESSION_SECRET is missing or too short` | `.env` didn't get picked up. Restart `npm run dev` after editing it. |
| Login rejects the right password | `APP_PASSWORD` has stray quotes or a trailing space. |
| Chat says every model in the chain failed | Bad OpenRouter key, or every free model is rate-limited at once. Wait a minute, or check the key at openrouter.ai. |
| Reply arrives but no page gets saved | The free model ignored the tool call. Try again, or move that model down the chain in `src/lib/models.ts`. |

Paste the error at me and I'll sort it.
