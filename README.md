# QuickDash

A simple dashboard for tracking course-redesign work, replacing spreadsheet
color-coding with real status tracking and a per-user activity log.

## What it does

- **Courses yet to be done** — a live list filtered to "not started" / "in
  progress" work, with color-coded status badges (red / amber / green,
  matching the spreadsheet convention) that also carry a text label.
- **Live updates** — the dashboard and Admin page push changes to every
  open browser instantly (via Server-Sent Events): when one person claims
  or finishes a course, everyone else's screen updates with no reload.
- **Claim & update** — a user claims a course, moves it to "in progress",
  then "done." Every claim and status change is written to an activity log.
- **Per-user activity logs** — each user sees their own history on the
  dashboard; admins see everyone's, filterable by user, on the Admin page.
- **Login accounts** — admins create a login for each person from the Admin
  page. A temporary password is generated and shown once, for the admin to
  hand off; the user sets their own password on first login.
- **Spreadsheet import** — drop in `.xlsx`, `.xls`, or `.csv` directly, no
  need to save as CSV first. Columns `title`/`course`, `category`/`program`,
  `crn`/`section`, and `instructor` (folded into the title, e.g. "EA 111 —
  Tanya Fleck", so a course code repeated across sections tracks as separate
  rows instead of collapsing into one) are recognized. Safe to re-run with
  an updated export — a row matched by title to a course that already
  exists never has its status, priority, assignment, or notes touched (so a
  claim or in-progress mark always survives), though its category/CRN do
  get backfilled if the import has a non-blank value for them. A preview
  step (with a row-by-row breakdown) runs before anything is written, so a
  row cutoff can be chosen — e.g. to leave out trailing notes rows — and an
  optional **Replace** mode can additionally delete existing courses that
  aren't present in the file, for a sheet that's been audited down to fewer
  courses (their activity history is kept regardless).
- **CRN** — courses with a CRN (an actively scheduled section, as opposed
  to a placeholder) sort above ones without, right under anything marked
  priority.
- **Reads cell color directly for `.xlsx`/`.xls`** — no status column
  needed. Green fill → done, any other fill → marked priority, white/no
  fill → not started (a text `status`/`color` column is used instead if the
  sheet has one). Handles Excel's theme-color + tint shading, not just
  plain RGB fills, and per-row color doesn't have to span every column.
- **Program brand colors** — admins can assign a color to a category/program
  (e.g. all "EA" courses) from the Admin → Brand colors tab; it shows as a small
  swatch next to the category everywhere. This is separate from the
  done/priority status coloring above — it's just a visual label.
- **Admin overrides** — admins can set any course's status directly
  (including rolling "done" back to "not started"), release someone's claim
  ("Unclaim"), or mark/unmark priority, all from the Admin → Courses table.

## Getting started

```bash
npm install
npm start
```

The server starts on `http://localhost:3000` (override with `PORT`).

On first run, since there are no users yet, a default admin account is
created and its credentials are printed to the console:

```
username: admin
password: <random or ADMIN_PASSWORD env var>
```

Log in as admin, create real user accounts from the Admin page, and change
the admin password (top-right menu → Change password).

### Environment variables (optional)

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `SESSION_SECRET` | Signs session cookies — set a real secret in production | dev placeholder |
| `ADMIN_PASSWORD` | Password for the seeded admin account on first run | randomly generated, printed to console |

## Letting other people use it

This is a normal client-server app: one running instance holds the shared
data and pushes live updates. Everyone needs to point their browser at
that *same* instance — running separate local copies on separate machines
gives each person an empty, unsynced database.

- **Same office/Wi-Fi**: run `npm start` on one machine, everyone else
  visits `http://<that machine's LAN IP>:3000`. No extra setup beyond
  finding the IP and allowing the port through the firewall.
- **Reachable from anywhere**: run it on an always-on host (a small cloud
  VM, a spare server) behind a process manager (pm2/systemd) so it
  survives restarts, with a real `SESSION_SECRET` and HTTPS in front of it
  (e.g. via Caddy or nginx) since login passwords travel over the network.
  See [DEPLOY.md](DEPLOY.md) for a concrete, free walkthrough on a Google
  Cloud Always Free VM.

## Data storage

Data lives in `data/db.json` (a single JSON file, via lowdb) — no external
database required. This file is gitignored since it holds account and
activity data; back it up if you need to persist history across
deployments.

## Project layout

```
server.js          Express app + session setup
db.js               lowdb setup, default-admin seeding
middleware/auth.js   requireAuth / requireAdmin guards
routes/              auth, users, courses, activity endpoints
public/              login, dashboard, and admin pages (vanilla HTML/JS)
```

## Notes on the workflow

- A course can be claimed by one person at a time; once claimed, only that
  person (or an admin) can advance its status.
- Deleting a course does not delete the activity history already logged
  against it.
- Admins can reset any user's password (generates a new temporary one) or
  disable an account without deleting it.
