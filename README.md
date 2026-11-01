# Minutes

**Your conversations, minuted.** Record a meeting, a networking chat or a quick call. Minutes writes the summary, catches your follow-ups and decisions, and reminds you, with a calendar built in.

Started as a meeting-to-execution agent for the Wispr Flow hackathon (Oct 2026); the `phase1` branch turns it into a personal app.

## What it does
- **One-tap capture:** Record, Note to self, or Upload, from Today, the + button or the app-icon shortcuts.
- **Minutes arrive on their own:** stop recording and you're done. Transcription and the summary run in the background, and you get a notification when they're ready.
- **Note to self:** say or type "call Rahul tomorrow at 5", and it lands on your calendar with a reminder.
- **Follow-ups you approve:** the AI suggests tasks and events from each conversation; you add or dismiss them.
- **Decision memory:** decisions are kept, and when a new conversation changes an earlier one, it's flagged.
- **Built-in calendar:** month and agenda views of tasks, events and conversations, filterable by category.
- **Real reminders:** push notifications on phone and laptop, even with the app closed, plus a morning nudge for overdue items.
- **Organised by day and category:** Work, Networking, Clients, Personal, or your own.

## Stack
React + Vite · Supabase (auth, Postgres with row-level security, private storage, pg_cron) · Vercel serverless functions · AssemblyAI (transcripts with speakers) · Groq (gpt-oss-20b for minutes, Whisper for voice notes) · Web Push.

## Setup
See **PHASE1.md** for setting up, running locally, testing and merging.
