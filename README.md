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

Check-in data is stored in the browser's `localStorage`, so use the same device/browser during the event if you want the state to persist.

## Update the guest list

Keep the cleartext CSV outside the repository, then regenerate the hosted data file:

```sh
python3 obfuscate.py clear-guests.csv guests.csv
```
