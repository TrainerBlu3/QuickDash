# QuickDash

A simple dashboard for tracking course-redesign work, replacing spreadsheet
color-coding with real status tracking and a per-user activity log.

## What it does

- **Courses yet to be done** — a live list filtered to "not started" / "in
  progress" work, with color-coded status badges (red / amber / green,
  matching the spreadsheet convention) that also carry a text label.
- **Claim & update** — a user claims a course, moves it to "in progress",
  then "done." Every claim and status change is written to an activity log.
- **Per-user activity logs** — each user sees their own history on the
  dashboard; admins see everyone's, filterable by user, on the Admin page.
- **Login accounts** — admins create a login for each person from the Admin
  page. A temporary password is generated and shown once, for the admin to
  hand off; the user sets their own password on first login.
- **CSV import** — export the existing spreadsheet to CSV and import it.
  Columns `title`/`course`, `status`/`color` (accepts red/yellow/green as
  well as not started/in progress/done), and `category` are recognized.

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
