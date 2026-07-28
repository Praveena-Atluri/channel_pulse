# Channel Pulse Security and Data Protection

## Executive summary

Channel Pulse is designed to keep YouTube analytics private and limit access to authorized dashboard users. It retrieves channel data directly from Google's official YouTube Analytics API and YouTube Data API from the server. YouTube OAuth credentials, database credentials, and dashboard passwords are not sent to the browser.

The application does not sell or intentionally share analytics data with advertising networks, data brokers, or unrelated third-party analytics services. Its primary external services are:

- Google/YouTube, as the authoritative source of channel data.
- Turso/libSQL, as the application's private analytics database.
- The infrastructure provider hosting the application.

No application can honestly guarantee that a data leak is impossible. Channel Pulse materially reduces the risk of accidental exposure when it is deployed over HTTPS, secrets are stored securely, access is limited to trusted users, and dependencies and credentials are maintained properly.

## Direct YouTube API data flow

Channel Pulse communicates with Google's official endpoints:

- `https://youtubeanalytics.googleapis.com/v2/reports`
- `https://www.googleapis.com/youtube/v3`
- `https://oauth2.googleapis.com/token`

The data flow is:

1. An authenticated dashboard user requests a report or synchronization.
2. The Channel Pulse server exchanges the protected YouTube refresh token for a temporary access token.
3. The server requests the required channel metrics directly from YouTube.
4. The server stores the required reporting data in the private Turso database.
5. The dashboard returns only the information allowed for the signed-in account.

OAuth refresh tokens, client secrets, access tokens, and Turso credentials remain server-side environment variables. They are not embedded in client-side JavaScript or returned in dashboard API responses.

Using the official YouTube APIs avoids scraping, unofficial intermediaries, and unnecessary data processors. YouTube remains the source of truth for channel statistics, privacy status, and estimated revenue metrics.

## Authentication and session security

Channel Pulse requires authentication before protected dashboards or APIs can be used.

- Sessions are signed with HMAC-SHA-256, preventing a user from altering a session token without invalidating it.
- Session cookies are `HttpOnly`, so browser JavaScript cannot read them.
- Cookies use `SameSite=Lax` to reduce cross-site request forgery risk.
- Cookies are marked `Secure` in production and are sent only over HTTPS.
- Sessions expire after 12 hours.
- Invalid, expired, malformed, or incorrectly signed session tokens are rejected.
- Logout deletes the session cookie.
- Unsafe external login redirect destinations are rejected.
- If authentication is not configured, the app fails closed instead of exposing the dashboard.

Passwords and session secrets are loaded from server environment variables. The local `.env` and `.env.local` files are excluded from Git and must never be committed or shared.

## Authorization and least-privilege access

The app enforces access on the server rather than relying only on hidden UI elements.

- `admin-revenue` has management access and can view revenue.
- `admin` has the same management capabilities but cannot view or set revenue.
- Viewer accounts can be restricted to all channels or to an explicit list of channel IDs.
- Channel restrictions are checked when loading dashboards, syncing data, managing targets, and generating reports.
- Revenue cards, tables, charts, country breakdowns, CPM, ad impressions, monetized metrics, revenue rankings, and revenue report columns are removed for accounts without revenue permission.
- Revenue report fields are rejected by API authorization checks even if someone manually constructs a request.
- A non-revenue administrator cannot set or overwrite a revenue target. Existing revenue targets are preserved when that administrator updates other targets.

These controls prevent sensitive revenue data from being exposed merely by changing a URL, modifying browser code, or calling a protected endpoint directly.

## Database and stored data

Channel Pulse stores only the channel catalog, reporting metrics, targets, synchronization status, and related data needed by the dashboards and exports. It does not need to store a user's Google password.

Database access uses a server-side Turso URL and authentication token. Browser clients do not connect directly to Turso. All database queries are issued by the Channel Pulse server after authentication and authorization checks.

The application also respects stored YouTube video privacy status when presenting video-level performance. Database backups, access controls, encryption, retention, and deletion policies must additionally be configured with the database and hosting providers.

## Report and export protection

Downloaded reports are generated only after the server validates the current session, allowed channels, administrator capability, and revenue permission.

Users should treat downloaded Excel, CSV, and PDF reports as confidential. Once a report is downloaded, protection of that copy depends on the receiving computer, shared drive, email system, and recipient behavior.

## Deployment requirements

The following controls are required to preserve the security described above:

- Serve production only over HTTPS.
- Store secrets in the hosting provider's encrypted environment-variable system.
- Use long, unique passwords and a long, random `CHANNEL_PULSE_SESSION_SECRET`.
- Never commit `.env`, `.env.local`, OAuth tokens, database tokens, or downloaded reports.
- Restrict Turso database access and rotate its token if exposure is suspected.
- Restrict the Google OAuth client and revoke/rotate the refresh token if exposure is suspected.
- Grant accounts access only to the channels and revenue data they require.
- Remove accounts immediately when access is no longer needed.
- Keep Node.js, Next.js, and other dependencies patched.
- Review application and provider logs for unexpected logins, exports, or synchronization activity.
- Keep production error responses free of credentials and sensitive raw provider data.

## Current limitations and recommended hardening

Direct use of the YouTube APIs improves privacy, but it does not by itself guarantee complete security. The following controls should be added or supplied by the hosting layer for higher-security deployments:

- Login rate limiting and temporary lockout after repeated failures.
- Multi-factor authentication or organization single sign-on.
- Centralized audit logs for logins, target changes, exports, and administrative actions.
- A Content Security Policy and additional security response headers.
- Automated dependency and secret scanning.
- Documented backup retention and incident-response procedures.
- Periodic access reviews and credential rotation.

## Security conclusion

Channel Pulse has a privacy-conscious architecture: official YouTube APIs are called directly by the server, credentials remain server-side, dashboards require signed sessions, channel access is scoped per account, and revenue authorization is enforced in both the UI and APIs.

When deployed and operated according to the requirements above, the app provides a strong foundation for protecting private YouTube channel analytics and substantially reduces the likelihood of accidental data exposure. This document is a technical overview, not a warranty that a breach can never occur.
