# Phase 1 on the `phase1` branch

Same repo, same Vercel project, same Supabase project, one `.env`.
`main` (the hackathon demo) keeps working until you merge.

---

## 1. Put the code on the branch (your laptop)

```bash
cd ~/Documents/meeting-agent
git checkout main && git pull
git checkout -b phase1
```

Unzip `meeting-agent-phase1.zip`, then copy its contents over the project. The `.git` folder, `.env` and `node_modules` are not in the zip, so they stay as they are. Then delete the hackathon-only files the branch no longer uses:

```bash
# from inside the project folder, with the unzipped folder next to it:
cp -r ../meeting-agent-phase1/. .
git rm -q api/conflicts.js api/extract.js api/notify.js api/transcribe.js api/transcript-status.js api/trello.js
git rm -rq src/assets
npm install
git add -A
git status          # .env must NOT be in the list
git commit -m "Phase 1: personal Minutes (sign-in, capture, calendar, reminders)"
git push -u origin phase1
```

Vercel builds a **preview** for the branch automatically.

## 2. Supabase (same project): add the new tables

**SQL Editor** → paste all of `supabase/schema.sql` → **Run**.
It only *adds* tables (`profiles`, `categories`, `entries`, `items`, `entry_decisions`, `push_subscriptions`) and a private `audio` bucket. The hackathon tables are untouched.

**Authentication → Sign In / Providers → Email**: keep it on. While testing, turn **Confirm email** off.

**Project Settings → API**: copy the **service_role** key (needed below).

## 3. One `.env`: add five lines

Generate push keys once:
```bash
npx web-push generate-vapid-keys
```

Add to your existing `.env` (keep everything already there):
```
SUPABASE_SERVICE_ROLE_KEY=...        # Supabase → Project Settings → API → service_role (server only, never VITE_)
VITE_VAPID_PUBLIC_KEY=...            # Public Key from the command above
VAPID_PRIVATE_KEY=...                # Private Key from the command above
VAPID_SUBJECT=mailto:kadamdevesh969@gmail.com
APP_URL=https://meeting-agent-git-phase1-<your-team>.vercel.app
```
Still used: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `GROQ_API_KEY`, `ASSEMBLYAI_API_KEY`, `CRON_SECRET`.
No longer used (fine to leave): `RESEND_API_KEY`, `TRELLO_*`.

Add the same five in **Vercel → Settings → Environment Variables**, ticking **Preview** (and Production, for later). Check that the existing ones are also ticked for **Preview**.

`APP_URL`: Vercel → Deployments → open the `phase1` deployment → copy the **branch link** (it contains `git-phase1`; it stays the same on every push). Set it, then **Redeploy** the branch.

## 4. Let AssemblyAI and the reminder job reach the preview

Vercel password-protects previews by default, which blocks the "transcript ready" callback and the reminder job.
**Vercel → Settings → Deployment Protection → Vercel Authentication**: turn it off (or set it to protect production only) while testing.

## 5. Turn on minute-by-minute reminders

Open `supabase/reminders_cron.sql`, replace:
- `YOUR-APP.vercel.app` → your branch link from step 3 (without `https://`)
- `YOUR-CRON-SECRET` → your `CRON_SECRET`

Run it in the SQL Editor. After a few minutes, check:
```sql
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
```
`succeeded` means it's working.

## 6. Run it locally

```bash
npx vercel dev
```
Open http://localhost:3000. Locally, everything works except the AssemblyAI callback (it can't reach your laptop). Minutes still finish, because the app checks every few seconds while it's open.

## 7. Test checklist (on the preview link)

1. **Create account** → you land on Today with "Good morning, <name>".
2. **Note to self**: "remind me to test Minutes in 10 minutes and pay rent tomorrow" → two items appear.
3. **Settings → Turn on reminders → Send a test** → a notification arrives.
4. **Record** a 30-second chat (two voices if you can) → close the app → "Your minutes are ready" arrives → open it → review the follow-ups.
5. Record a second chat that changes something from the first ("pilot is now 10 seats") → a conflict card appears → **Replace**.
6. **Calendar**: items show on the right days; tap a day; **Agenda** lists the next 30 days.
7. **Tasks**: edit one, mark one done, and check the review list.
8. **Library**: search a word from a transcript.
9. Wait for the 10-minute reminder from step 2.
10. **Phone:** iPhone → Safari → Share → **Add to Home Screen** → open from the Home Screen → Settings → Turn on reminders. Android → Chrome → ⋮ → **Install app**.

## 8. When everything works: merge

```bash
git checkout main && git pull
git merge phase1
git push
```
Then:
1. Supabase SQL Editor → run `supabase/merge_cleanup.sql` (drops the old hackathon tables).
2. Storage → `recordings` → ⋯ → **Empty bucket**, then **Delete bucket**.
3. Update `APP_URL` in Vercel (Production) to your production URL, and re-run `supabase/reminders_cron.sql` with the production domain.
4. Turn Deployment Protection back on for previews if you like.

## Good to know
- **Long recordings on a phone:** the app keeps the screen awake while recording, but browsers stop recording if you lock the phone or switch apps. For long events, record with Voice Memos and use **Upload**.
- **Free tiers:** AssemblyAI gives a fixed amount of free hours, Groq is rate-limited, and Supabase pauses idle free projects after a week.
- **Privacy:** every table is private to its owner (row-level security), recordings sit in a private bucket under your user ID, and the server only uses short-lived links.
- **Rotate** the Trello token from the hackathon; it's no longer used.
