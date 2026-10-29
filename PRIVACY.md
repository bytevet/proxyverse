# Privacy Policy

_Effective October 29, 2026_

This policy covers the Proxyverse browser extension for Chrome, Edge and Firefox, and the optional cloud sync it offers through byte.vet. Both are run by byte.vet. Questions and requests: **admin@byte.vet**.

## In short

- Without sync, nothing leaves your browser: no account, no analytics, no tracking.
- Proxyverse sees the addresses of the pages you load, because it routes them. It uses them inside your browser only, to pick a proxy and show what happened, and never sends them anywhere.
- If you sign in to sync, your profiles (proxy passwords included) and four interface preferences are stored on byte.vet, encrypted, and used only to keep your devices in sync. We don't sell them, share them for advertising, or use them for anything else.

## What stays in your browser

All of this stays on your device, in the extension's own browser storage:

- **Proxy profiles and preferences**: servers, usernames and passwords, PAC scripts, auto-switch rules, bypass lists, and the theme, language and toolbar settings.
- **Requests per tab**: the address, type and outcome of each request in a tab, so the popup and the toolbar badge can show which profile served a site and which resources failed. It's kept per tab, cleared when the tab loads a new page or closes, and forgotten when the browser closes.

## Network requests the extension makes

Besides your own browsing, which goes wherever your active profile sends it, Proxyverse makes these requests:

- **PAC scripts** you set up by URL are downloaded from that URL, when you fetch them and at the refresh interval you choose.
- **Proxy credentials**: when the active profile has a username and password, Proxyverse sends one request through your proxy when the browser starts and whenever the proxy changes, so the browser can store the credentials. It's addressed to `proxyverse-auth.invalid`, a name that can't exist, so it goes no further than your proxy.
- **byte.vet**, only if you sign in to sync. See below.

## Cloud sync (optional)

Sync is off until you sign in from the Sync section of the Preference page.

### What we collect

- **Your byte.vet account**: you sign in with GitHub or Google. From that provider, byte.vet stores your name, email address, profile picture URL and account ID, plus the tokens the provider issues for the sign-in. We never see your GitHub or Google password. The extension keeps your account ID and email to show who's signed in.
- **What syncs**: every profile not marked "This device only", with everything in it, including proxy usernames and passwords. Also four preferences: theme, language, what the toolbar icon opens, and whether the badge shows failed resources. You can turn off syncing preferences.
- **Devices**: for each browser you sync, a random device ID, a name such as "Chrome on mac", the browser and the extension version, when it was added and when it last synced.
- **Sign-in and usage records**: the time, IP address and approximate location (country, region, city) of the last sync request, shown to you under "Connected apps" on byte.vet. Sign-in sessions on the byte.vet website store the IP address and browser user agent.
- **Server logs**: byte.vet runs on Cloudflare, which logs request metadata (such as the address requested, status, IP address and user agent), not request contents. These logs are kept for 30 days.

### How it's protected

- Everything travels over HTTPS.
- The contents of your profiles and preferences are encrypted at rest with AES-256, using a key unique to your account. That key is itself encrypted by a key held only by the service.
- Sync is not end-to-end encrypted: byte.vet holds the keys and decrypts your data to send it to your devices. Metadata isn't encrypted by us (only by the hosting platform): profile IDs, preference names, record sizes, timestamps and device details.
- To keep a profile, and its passwords, off the cloud entirely, mark it "This device only" in the profile editor.

### How long we keep it

- Your synced profiles and preferences stay until you delete them. A deleted profile is kept as a deletion marker for 90 days, so your other devices learn about it, then removed.
- Snapshots of your synced data (taken daily and before a restore, to let you go back) are deleted after 30 days, but the 10 most recent are always kept.
- Sign-in tokens expire: access after 1 hour, refresh after 90 days without use.
- Your account and its data stay until you delete them.

### Your choices

- **Sign out** in the Sync section: the extension revokes its access on byte.vet and forgets the sign-in. Your profiles stay in the browser.
- **Disconnect** Proxyverse under "Connected apps" on byte.vet to revoke its access from there.
- **Delete** a profile and it's deleted on every device and, after 90 days, on byte.vet.
- **Delete everything**: delete your byte.vet account on byte.vet, and all its synced data and snapshots are deleted with it.
- **Get a copy** of your profiles with Export Profiles on the Preference page.

## Who else handles your data

- **Cloudflare** hosts byte.vet: its servers, database, storage and logs. Data is stored in Cloudflare's network, not pinned to a region.
- **GitHub** or **Google**, whichever you sign in with.

No one else. We don't sell your data, share it with advertisers or data brokers, or use it to profile you.

## Permissions the extension asks for

- **proxy**: apply your proxy settings.
- **webRequest**, **webRequestAuthProvider** and access to all sites: answer proxies that ask for a password, and see which requests succeed or fail for the popup and the badge.
- **storage**: keep your profiles and preferences.
- **alarms**: refresh PAC scripts and sync on a schedule.
- **activeTab**, **sidePanel**: act on the current tab, and open the sidebar.
- **identity**: open the byte.vet sign-in window for sync.

## Changes

We'll update this page when what we collect or how we use it changes, with a new effective date. Its history is in this repository.

## Contact

admin@byte.vet
