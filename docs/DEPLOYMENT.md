# Deploying OneStop on free hosting

A hosted OneStop instance, reachable over HTTPS, costing nothing.

Everything in this guide is free-tier. **Free-tier quotas and provider policies change** — that is
exactly why nothing here is in the code: every choice below is an environment variable, so moving
to a different free provider is a config change, never a code change.

---

## 1. Choose a shape first

OneStop is one Next.js app (`apps/web`) plus one Postgres. `apps/api` is a library the app
imports, not a second service, so there is nothing to split.

|                                 | Serverless (Vercel / Netlify) | Container (Render / Railway / Fly.io)            |
| ------------------------------- | ----------------------------- | ------------------------------------------------ |
| Setup                           | easiest — connect the repo    | a little more, one Dockerfile-free build command |
| PDF, data, image, QR, dev tools | ✅                            | ✅                                               |
| Audio/video (FFmpeg)            | ❌ no FFmpeg binary           | ✅ install it in the build                       |
| Online media (yt-dlp)           | ❌                            | ✅                                               |
| Office fidelity (LibreOffice)   | ❌ built-in converters only   | ✅ if the image has room                         |
| Local AI (Ollama)               | ❌                            | ❌ on a free tier — no free plan has the RAM     |
| Long jobs                       | request timeout (10–60 s)     | minutes                                          |
| Idle behaviour                  | always warm                   | free tiers sleep; first request is slow          |

**Recommendation.** Take the container route (Render's free web service is the simplest) unless you
only want the document/data/image tools, in which case Vercel is a two-minute deploy.

Whatever you pick, **`/status` on the deployed instance tells the truth**: it lists all 206 tools,
which are offline-capable, and which server-side programs this particular host actually has. A tool
whose prerequisite is missing fails with one clear sentence — it is never silently broken.

## 2. Postgres (both routes) — Neon or Supabase

Both have a free tier with no card.

1. Create a project; choose a region near your host.
2. Copy the **pooled** connection string (Neon calls it "Pooled connection"; Supabase calls it the
   "Transaction pooler"). Serverless hosts open many short-lived connections and a direct URL will
   run out.
3. Append `?sslmode=require` if it is not already there.

That string is `DATABASE_URL`.

Then apply the schema once, from your own machine:

```bash
DATABASE_URL="postgres://…" npm run db:deploy
```

Without a database the deployed app still works — every tool runs, but history and favourites live
only in the browser and sign-in reports that it is unavailable.

## 3. Route A — Render (recommended)

1. **New → Web Service**, connect the repository, pick the free instance type.
2. **Build command:**

   ```bash
   npm ci && npm run build
   ```

   To include FFmpeg and yt-dlp, use this instead — both are free and add about a minute:

   ```bash
   apt-get update && apt-get install -y ffmpeg python3-pip && pip3 install --break-system-packages -U yt-dlp && npm ci && npm run build
   ```

   (On a host where you cannot `apt-get`, `npm run fetch:ffmpeg` downloads a static FFmpeg build
   into `.tools/`, which OneStop finds on its own.)

3. **Start command:** `npm start`
4. **Environment variables:** see [§5](#5-environment-variables).
5. Deploy. Render gives you `https://<name>.onrender.com` with HTTPS already on.

The free instance sleeps after inactivity, so the first request after a quiet period takes ~30
seconds. That is the free tier working as designed, not a fault.

**Railway** and **Fly.io** are the same three fields with different names. On Fly, `fly launch`
then set the same variables with `fly secrets set`.

## 4. Route B — Vercel

1. Import the repository. Vercel detects Next.js; the defaults are right.
2. **Root directory:** leave it at the repository root — the build script drives the workspace.
3. Add the environment variables from §5.
4. Deploy.

Known limits of this route, all of which the app reports rather than hides:

- **No FFmpeg, no yt-dlp, no LibreOffice.** The 27 audio/video tools and the 7 online-media tools
  report their setup message; Office conversion uses OneStop's own converters and says fidelity may
  be lower. Nothing else is affected.
- **Function timeout** (10 s on Hobby). A large OCR or a 200-page merge can exceed it. Raise
  `maxDuration` if your plan allows, or use Route A for those.
- **Temporary files** live in the function's `/tmp` and do not survive between invocations, so set
  `TEMP_DIR=/tmp` and expect a result to be downloadable only from the request that produced it.

Netlify behaves the same way.

## 5. Environment variables

`.env.example` documents all of them. These are the ones a hosted instance needs:

| Variable                                                    | Needed       | Value                                                                                                    |
| ----------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| `APP_URL`                                                   | **yes**      | the public HTTPS URL, no trailing slash                                                                  |
| `NEXTAUTH_URL`                                              | **yes**      | the same URL                                                                                             |
| `NEXTAUTH_SECRET`                                           | for accounts | `npx auth secret`, or `openssl rand -base64 32`                                                          |
| `DATABASE_URL`                                              | for accounts | the pooled Postgres URL from §2                                                                          |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                 | optional     | a free Google Cloud OAuth client; add `<APP_URL>/api/auth/callback/google` as an authorised redirect URI |
| `RESEND_API_KEY` or `SMTP_URL`                              | optional     | real password-reset email; without it the link is printed to the server log                              |
| `MAX_UPLOAD_MB`                                             | optional     | default 100. Lower it on a small free instance                                                           |
| `TEMP_FILE_TTL_MINUTES`                                     | optional     | default 60                                                                                               |
| `TEMP_DIR`                                                  | serverless   | `/tmp`                                                                                                   |
| `RUN_RATE_LIMIT` / `RUN_RATE_WINDOW_SECONDS`                | optional     | per-caller cap on `POST /api/tools/run`; default 120 per 60 s                                            |
| `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `GOOGLE_AI_API_KEY` | optional     | see §6                                                                                                   |

`APP_URL` matters more than it looks: **dynamic QR codes encode `<APP_URL>/q/<id>`**, so set it to
the real public URL before printing any code.

## 6. AI on a hosted instance

Ollama needs several GB of RAM and does not fit on any free tier. So on a hosted instance the AI
features have two honest options:

1. **Leave them off.** Every AI tool reports "this needs an AI runtime" with instructions, and the
   other 190 tools are unaffected. The assistant says the same. Nothing is silently broken.
2. **A free hosted API with a key.** Groq, OpenRouter's free models, or Google AI Studio's free
   tier. Set the key as an environment variable, or let each user paste their own in `/settings` —
   that key is used for that run and is never stored.

Option 2 sends text to that provider. The UI says so on every AI tool page and every result names
the runtime that produced it. It is never the silent default: OneStop tries Ollama first.

If you want fully local AI, run OneStop on your own machine (see
[`LOCAL_SETUP.md`](LOCAL_SETUP.md)) or on a paid box with 8 GB+ of RAM. That is a choice, not a
requirement.

## 7. After deploying — check it

1. Open `https://<your-url>/status`. It should list 206 tools and show what this host has.
2. Run **File Metadata Viewer** on any file. A report means upload → process → download works.
3. Run **Password Generator**. Instant, no file, no dependency.
4. If you set up a database: sign up, sign out, sign in, and check `/history` shows the run.
5. Install it: open on a phone, "Add to Home Screen". It needs HTTPS, which your host provides.
6. Go offline (aeroplane mode) and open it again — the shell loads and offline-capable tools work.

## 8. Privacy and security on a public URL

OneStop was built for personal or small-trusted-group use. Before you give the link to anyone:

- **Uploads are deleted automatically** — inputs as soon as a job ends, results after
  `TEMP_FILE_TTL_MINUTES` (default 60). No file binary is ever stored in Postgres.
- **There is no admin, no roles and no billing**, by design. Anyone who can reach the URL can run
  the tools. If that is not what you want, put the host's own access control in front of it, or
  keep the URL private.
- **The rate limit is per server process.** One free instance is one process, so it works as
  intended; behind several instances each gets its own budget.
- **Secrets only in the host's environment panel.** Never commit `.env`.
- **The AI assistant cannot run shell commands** and cannot call anything that is not in the tool
  registry. That is enforced in code, not by prompt.

## 9. Moving providers

Nothing above is in the source. To move:

1. Point `DATABASE_URL` at the new Postgres and run `npm run db:deploy`.
2. Set `APP_URL` and `NEXTAUTH_URL` to the new URL (and update the Google redirect URI if you use
   it, and re-make any printed dynamic QR codes).
3. Deploy the same repository with the same build and start commands.

That is the whole migration. It is why the free-tier caveat at the top of this file is survivable.

---

See [`LOCAL_SETUP.md`](LOCAL_SETUP.md) for running it on your own machine,
[`../CLAUDE.md`](../CLAUDE.md) for the rules the project is built under, and
[`PROGRESS.md`](PROGRESS.md) for what was built in which phase.
