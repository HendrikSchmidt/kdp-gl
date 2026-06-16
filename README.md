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
2. Make sure the source tabs are named `Gästeliste` and `Skipliste`.
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

The app loads `Gästeliste` and `Skipliste` from the Sheet, polls check-in status every few seconds, and writes check-ins/resets immediately.

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
