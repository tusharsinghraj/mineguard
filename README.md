# MineGuard — Mine Safety Incident Reporting & Hazard Tracker

MineGuard uses an obsidian-black and safety-yellow interface. It is a full-stack mine safety incident reporting and hazard tracking application with separate worker and supervisor portals. It includes role-based authentication, photo-enabled reporting, status/history tracking, analytics, a section heatmap, rule-based alerts, worker account creation and CSV export.

## Requirements

- Node.js 18.17 or later
- npm (included with Node.js)
- A browser on the same computer, or a phone connected to the same local network for a local demo

> **Deploying?** See [DEPLOY.md](DEPLOY.md) (Firebase Firestore + GitHub + Render).

## Run locally

1. Extract the ZIP.
2. Open a terminal inside the `MineGuard_App` folder.
3. Install server packages:

   ```bash
   npm install
   ```

4. Start the server:

   ```bash
   npm start
   ```

5. Open `http://localhost:3000`.

The first startup creates the local data store. Incident data is persisted in `data/store.json`; uploaded photos are stored in `uploads/`.

## Demo logins

Select the matching portal on the login screen.

**Worker portal**
- Email: `worker@mineguard.demo`
- Password: `Worker@123`

**Supervisor portal**
- Email: `supervisor@mineguard.demo`
- Password: `Supervisor@123`

The local demo seeds synthetic incident records so the dashboard and warning rules are populated immediately. These are example records for presentation and testing, not real mine safety reports. The interface keeps the sample data visually consistent with ordinary incident records; do not present seeded entries as real incidents.

## Main features

### Worker portal
- Sign in through the worker-only portal.
- Submit accident, near-miss or unsafe-condition reports.
- Add severity, mine section, description, event date/time and an optional image (JPG/PNG/WEBP/GIF, max 5 MB).
- View only their own reports, photo evidence and status/history.

### Supervisor portal
- See the incident overview, section counts, seven-day trend and incident-type split.
- See a colour-coded section concentration heatmap.
- Get rule-based flags for 3+ near-misses in the same section during the previous seven days, and repeated section/type patterns in 30 days.
- Search/filter incidents, inspect report details, record action notes and update status.
- Export records as CSV.
- Create worker accounts.

### Status workflow
`Reported` → `Under Investigation` → `Resolved`

Each status save adds an entry to the incident history with time, supervisor and note.

## Test the main workflow

1. Sign in as supervisor and open **Worker accounts**.
2. Create a test worker account with a password of at least 10 characters.
3. Sign out, then sign in through the **Worker login** portal with that new account.
4. Submit a near-miss with section `Face 3`, a description and a test image.
5. Sign out and return through the **Supervisor login** portal.
6. Open **All incidents**, review the report and update its status with an action note.
7. Check the dashboard/heatmap and use **Export CSV**.

You can also test the seeded demo user, whose reports are visible to the supervisor but are isolated from other workers.

## Phone demo on the same Wi-Fi

1. Start MineGuard on your laptop.
2. Find the laptop's local IPv4 address (Windows: run `ipconfig` and look for IPv4 Address).
3. Connect the phone to the same Wi-Fi and open `http://<laptop-ip>:3000`.
4. If the phone cannot connect, check that the firewall allows incoming connections on port 3000 for your private network.

This is local-network access, not a public deployment. Do not expose this demo server to the internet.

## Optional non-demo configuration

Create a `.env` file by copying `.env.example`, then set `DEMO_MODE=false`, a long random `SESSION_SECRET`, and unique credentials for the initial supervisor and worker. The app does not load demo sample reports in that mode. If the store has already been initialized, changing these variables does not overwrite existing accounts; for a fresh test, stop the server and back up/remove `data/store.json` before restarting.

The app reads environment variables directly when the server starts. On a local Windows terminal without a `.env` loader, you can either use PowerShell environment variables for that terminal session or use a local environment loader package if you choose to add one.

## Important implementation notes

- Passwords are hashed with bcryptjs. Session cookies are HTTP-only and use SameSite protection; security headers and a login rate limit are enabled.
- Worker access to incident records and photos is restricted to their own records. Supervisors can view all incident reports.
- The JSON file store is suitable for a small hackathon demo, not concurrent production use at a real mine.
- Express's default in-memory session store is not designed for production deployment.
- For real deployment, use HTTPS, a persistent database, durable session storage, backups, audit/retention policies, role provisioning and a security review.
- The demo's heatmap reflects report counts and simple rules. It is not a certified mine-risk assessment, does not provide emergency alerts, and does not replace inspections, statutory reporting or mine emergency procedures.
- A browser-based app needs a network connection to the server. Offline syncing and push notifications are not included in this MVP.

## Structure

```text
MineGuard_App/
├── server.js
├── package.json
├── README.md
├── .env.example
├── data/
├── uploads/
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```
