# VIP Guestlist Check-In

A lightweight static web app for checking VIP guests in at an event.

Guest data is stored in `guests.csv` as a lightly obfuscated XOR/base64 payload. This is not real security, but it keeps names out of cleartext in the hosted files.

## Run locally

Serve the folder with any static file server:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to GitHub Pages

This app has no build step. Push the repository to GitHub and enable Pages for the root of the default branch.

Check-in data is stored in the browser's `localStorage` by default. To sync multiple devices, connect the app to Google Sheets using the setup below.

## Sync with Google Sheets

1. Create or open the Google Sheet with your guest list.
2. Make sure the guest-list tab has headers named `Name`, `Vorname`, `Status`, and optionally `Kategorie`. A tab named `Guests` is preferred; otherwise the script uses the first tab that is not `Checkins`.
3. In the Sheet, open **Extensions > Apps Script**.
4. Paste the contents of `google-apps-script.js` into the Apps Script editor.
5. Change `SHARED_SECRET` in Apps Script to a simple private phrase.
6. Deploy the script via **Deploy > New deployment > Web app**.
7. Set **Execute as** to yourself and **Who has access** to anyone with the link.
8. Copy the Web App URL into `sync-config.js`.
9. Set the same `secret` value in `sync-config.js`.

Example:

```js
globalThis.GUESTLIST_SYNC_CONFIG = {
  endpoint: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
  secret: "your-private-phrase",
  pollMs: 3000,
};
```

The app loads guests from the Sheet when sync is configured, polls check-in status every few seconds, and writes check-ins/resets immediately. The secret is visible in the static site, so this is convenience-level protection, not real security.

## Update the guest list

If Google Sheets is not configured, the app falls back to `guests.csv`. To update that offline fallback, keep the cleartext CSV outside the repository and regenerate the hosted data file:

```sh
python3 obfuscate.py clear-guests.csv guests.csv
```
