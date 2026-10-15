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

## Outlook / Microsoft 365
Pit Wall signs in to Microsoft directly (OAuth 2.0 with PKCE, Microsoft Graph). Register an app in
Microsoft Entra: *Single-page application* redirect URI = the address you open Pit Wall at (for example
`https://duncangrant1998-source.github.io/Pit-Wall/`), delegated Graph permissions `User.Read`,
`Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, `offline_access`. Paste the Application (client) ID
into More → Email & calendar accounts → Outlook. Microsoft limits browser-app sign-ins to 24 hours, so
Pit Wall asks for a quick sign-in once a day.
