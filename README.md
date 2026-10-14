# Pit Wall

A personal organiser that runs as a Home Screen web app on iPhone: calendar, tasks, inbox, quick capture, waiting-on, event weekends, day planning and leave-by times, with work and personal kept separate.

Everything is stored on the device (browser storage). No account, no server.

## Install on iPhone
1. Open the site in Safari.
2. Tap **Share → Add to Home Screen**.
3. Use the icon from then on (Safari keeps a separate copy of your data).

## Hosting
Static files only — served by GitHub Pages from the `main` branch root.

## Gmail and Google Calendar
Pit Wall connects to Google through a small Apps Script that runs in *your own* Google account
(`google/PitWallConnector.gs`). Your phone talks to that script directly; no third-party server.
Setup steps are at the top of the script. In the app: More → Google accounts → Connect.
