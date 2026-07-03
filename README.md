# VIP Guestlist Check-In

A lightweight static web app for checking VIP guests in at an event. Guest lists and check-in state are loaded from Google Sheets.

## Run locally

Serve the folder with any static file server:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to GitHub Pages

This app has no build step. Push the repository to GitHub and enable Pages for the root of the default branch.

## Google Sheets setup

1. Create or open the Google Sheet with your lists.
2. Make sure the source tabs are named `Gästeliste` and `Skipliste`. (Only tabs for lists you actually enable are required — see [Running an event with only one list](#running-an-event-with-only-one-list).)
3. Each source tab should have headers named `Name`, `Vorname`, `Status`, and optionally `Kategorie`. If there is no `Gästeliste` tab, the script uses the first tab that is not `Checkins` or `Skipliste`.
4. In the Sheet, open **Extensions > Apps Script**.
5. Paste the contents of `google-apps-script.js` into the Apps Script editor.
6. Set `ACCESS_CODES` in Apps Script to one or more long, unguessable codes.
7. Deploy the script via **Deploy > New deployment > Web app**.
8. Set **Execute as** to yourself and **Who has access** to anyone with the link.
9. Copy the Web App URL into `sync-config.js` as `endpoint`.

Example:

```js
globalThis.GUESTLIST_SYNC_CONFIG = {
  endpoint: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
  pollMs: 3000,
};
```

The app loads `Gästeliste` and/or `Skipliste` from the Sheet (depending on `enabledLists`, see below), polls check-in status every few seconds, and writes check-ins/resets immediately.

## Running an event with only one list

Some events only need the `Skipliste` (or only the `Gästeliste`). Control this with
`enabledLists` in `sync-config.js`:

```js
globalThis.GUESTLIST_SYNC_CONFIG = {
  endpoint: "...",
  pollMs: 3000,
  enabledLists: ["skiplist"], // only show/sync the Skipliste
};
```

- Omit `enabledLists` (or set it to `["guestlist", "skiplist"]`) to show both tabs, which is the default.
- When only one list is enabled, the app hides the list-switcher tabs entirely and shows that list directly — no tab to accidentally switch away from.
- The app only fetches the sheet tab(s) for the enabled list(s), so a sheet used for a skiplist-only event doesn't need a `Gästeliste` tab at all.

## Access codes

The access code is **not** stored in the static site. On first load the app shows a
gate and staff enter the code for the event. The entered code is sent with every
request and must match an entry in `ACCESS_CODES` in `google-apps-script.js`.

- **Share a code:** tell staff the code, or send a per-event link that fills it in
  automatically: `https://your-site/?code=THE-CODE`. The `?code=` value is removed
  from the address bar after it loads and remembered on the device.
- **Per event:** add a fresh code to `ACCESS_CODES` for each event and remove old
  ones to revoke access. Multiple codes can be valid at once.

This keeps the code out of the page source and gates casual access. The code still
travels in requests and is stored on the device, so treat it as convenience-level
protection, not strong security.

## Update the guest list

Edit the `Gästeliste` and `Skipliste` tabs in your Google Sheet. The app picks up changes on the next sync poll.

## Checklist for a new event

1. **Sheet**: create a new Google Sheet (or reuse/duplicate a previous one) for the event.
   - Add a `Skipliste` tab and/or `Gästeliste` tab, whichever the event needs.
   - Each tab needs a header row: `Name`, `Vorname`, `Status`, and optionally `Kategorie`.
   - Fill in one guest per row below the header. Leave the `Checkins` tab alone — the script creates and manages it automatically.
2. **Apps Script**: open **Extensions > Apps Script** on the sheet.
   - Paste in the current `google-apps-script.js` (or confirm it's already there if you duplicated a previous sheet).
   - Set `ACCESS_CODES` to a fresh, unguessable code (or codes) for this event. Remove old codes from past events so they no longer work.
   - Deploy via **Deploy > New deployment > Web app** (or **Manage deployments > Edit > New version** if reusing a script), execute as yourself, access for anyone with the link.
   - Copy the Web App URL.
3. **App config** (`sync-config.js` in this repo):
   - Set `endpoint` to the Web App URL from step 2.
   - Set `enabledLists` to match which lists this event uses, e.g. `["skiplist"]` for a skiplist-only event, or `["guestlist", "skiplist"]` (or omit it) for both.
   - Commit and deploy/push so the change goes live.
4. **Share access**: send staff the access code, or a per-event link `https://your-site/?code=THE-CODE` so it's filled in automatically.
5. On the day, double-check the app loads the right guests and that check-ins sync before doors open.
