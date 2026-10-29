# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Proxyverse?

A Manifest V3 browser extension (Chrome, Edge, Firefox) for proxy profile management with auto-switch rules and PAC script support. It is an alternative to Proxy SwitchyOmega.

## Build and Test Commands

```bash
npm run build           # Type-check (vue-tsc) + build for Chrome/Edge
npm run build:firefox   # Type-check + build for Firefox (transforms manifest)
npm run build:preview   # Chrome build against the preview server (northernlight.byte.vet), fixed dev extension ID
npm run build:preview:firefox  # The same for Firefox, into dist-firefox/ (so it doesn't replace the Chrome dist/)
npm run dev             # Vite dev server
npm test                # Run vitest in watch mode
npm run coverage        # Single run with coverage report
npx vitest run tests/services/proxy/profile2config.test.ts  # Run a single test file

npm run test:e2e            # Build into .e2e-build/, then run all e2e tests
npm run test:e2e:chromium   # Chromium suite only (Playwright)
npm run test:e2e:firefox    # Firefox smoke suite only (Selenium + geckodriver)
npm run test:e2e:typecheck  # Type-check e2e/ (not covered by vue-tsc)
npm run test:e2e:live       # Live sync smoke vs northernlight.byte.vet: headed, you sign in twice; never in CI
npm run sync:api-types      # Regenerate src/services/sync/api.gen.ts from docs/sync-api.openapi.yaml
E2E_SKIP_BUILD=1 npx playwright test -c e2e --project=chromium e2e/specs/pac.e2e.ts  # Reuse the last build, one spec
```

CI runs `npm run coverage` and both e2e suites (`e2e.yml`) on PRs to main/develop; `npm run build` + `npm run build:firefox` on pushes and tags. Pushing a `v*.*.*` tag (or creating a GitHub release) also publishes to the GitHub release and the Chrome, Edge and Firefox stores. Branch flow: feature branches → `develop` → release PR into `main`.

There is no formatter or linter; the gate is both builds, `vitest`, `test:e2e:typecheck` and the e2e suites.

## Architecture

### Three build entry points

The Vite config defines three entry points that produce the extension bundle:
- **`index.html`** / **`popup.html`** -- Both load `src/main.ts` (Vue app). The Vue router uses hash history: `#/popup` renders `PopupPage`, `#/` renders `ConfigPage` with nested profile/preference routes.
- **`src/background.ts`** -- Service worker. Wires up proxy auth, request stats, the badge indicator, PAC refresh alarms, and re-applying the proxy when stored profiles change. No Vue, no DOM.

Popup routes: `#/popup` and `#/popup/resources/:tabID` (Resources View, lazy-loaded). `#/popup?tabID=N` makes the popup act on tab N instead of the active tab; e2e tests rely on it.

`#/sidebar` is the same page in the browser's side panel (Chrome/Edge `sidePanel`) or sidebar (Firefox `sidebar_action`): it stays open, so it follows the active tab of its window (`Host.onActiveTabChanged`) and profile changes. What the toolbar icon opens is the `ui.actionBehavior` setting (`src/services/ui.ts`, "popup" or "sidebar"), applied by the background at every start and on change (`Host.applyActionBehavior`; on Firefox a click with no popup toggles the sidebar). Playwright can't drive the side panel: e2e opens `#/sidebar` as a tab instead.

The theme (`src/services/preference.ts`) is applied before the app mounts (`main.ts`), so it never renders in the wrong one; `useDarkMode()` is the page's shared state and follows changes made in other pages.

### Browser adapter layer (`src/adapters/`)

`BaseAdapter` defines the abstract contract for all browser APIs (storage, proxy, webRequest, tabs, i18n). Concrete implementations: `Chrome`, `Firefox`, `WebBrowser` (dev stub). A singleton `Host` is auto-detected at import time and used everywhere. This is the only layer that touches `chrome.*` or `browser.*` APIs directly.

### Proxy engine (`src/services/proxy/`)

The core complexity lives here:
- **`profile2config.ts`** -- `ProfileConverter` turns a `ProxyProfile` into a `ProxyConfig` (for `chrome.proxy.settings`). For non-PAC profiles and auto-switch profiles, it **generates PAC scripts via AST** using `escodegen`/`acorn` node builders in `scriptHelper.ts`. Auto-switch profiles compose multiple sub-profiles by generating `register()` calls that build a lookup table.
- **Rule types** -- `domain` (`shExpMatch` on the host), `url` (`shExpMatch` on the URL), `regex` (`RegExp(...).test(url)`), `cidr` (`isInNet`), `disabled`. Browsers strip the path and query of https URLs before a PAC script sees them (Chrome 52+, Firefox 51+), so `url`/`regex` rules can't match https paths; the editor's help popover per type says so.
- **`pacSimulator.ts`** -- JS reimplementations of PAC functions (`shExpMatch`, `isInNet`) used to simulate PAC evaluation in-extension (e.g., for tab badge resolution). `isInNet` returns `UNKNOWN` when given a hostname instead of an IP (can't do DNS in extension context).
- **`auth.ts`** -- Resolves proxy auth credentials by walking the profile tree (auto-switch profiles delegate to sub-profiles). Hosts match case-insensitively (Chrome reports the challenger lower-cased). Chrome prompts on requests extensions can't see (e.g. the new tab page's), so `warmUpProxyAuth` (`index.ts`) sends one request of ours to `proxyverse-auth.invalid` through the proxy at browser start and on every proxy change, to get the credentials cached.
- **`index.ts`** -- `setProxy`/`refreshProxy` apply a profile and save the `"active-profile"` snapshot (`refreshProxy` updates the snapshot too). `createProfileFinder(profile)` simulates which profile serves a URL (popup and badge). `refreshProxyOnProfileUpdate` re-applies the active profile when a storage change touches it or any profile it routes to (`profileTreeIDs`); the background calls it from `onProfileUpdate`, so writers of profiles don't need to.
- **`ruleEditor.ts`** -- Writes domain rules to the active auto-switch profile from the popup: exact host, or a whole site (`example.com` + `*.example.com`, registrable domain via `tldts`). Rules are updated in place or prepended so they win.
- **`pacFetcher.ts`** -- PAC URL fetching and `pac-refresh:<profileID>` alarms.
- **`route.ts`** -- The route a request actually used. The background stores the raw facts the browser reports per request (`routeFactsOf`): Firefox's `details.proxyInfo` is exact; Chrome only gives the first hop's IP (`details.ip`, no port), so it can match proxies set by IP but not by hostname, and can't tell apart proxies sharing an IP (e.g. local proxies on 127.0.0.1 with different ports) -- mostly it tells direct from proxied. `createRouteResolver(active)` turns facts + rules into the one route shown everywhere (popup chip, Resources View, badge): the facts when they leave a single possible profile, else the rules' prediction (kept uncertain when the facts contradict or can't confirm it). The server a proxy profile picks for a URL is `ProfileConverter.findServer`, next to the PAC generation it mirrors.

### Request stats and badge

- **`src/services/stats.ts`** -- The background records every request per tab (`TabStats`), reset on each main-frame navigation, persisted to `storage.session` under `tabstats:<tabID>` (survives service worker restarts). The popup reads it via `subscribeTabStats` for the failed-resources alert and the Resources View. Benign errors (aborted, blocked by client) don't count as failures. Opening the popup sends `stats:ack`, marking the tab's failures as seen until it reloads.
- **`src/services/indicator.ts`** -- `TabIndicator` owns the toolbar badge: profile initials (2 chars) globally and per tab, alternating every 2s with the count of unseen failures. It refreshes on proxy changes and on writes of the active-profile snapshot (e.g. a color edit leaves the proxy setting unchanged).

### Profile system (`src/services/profile.ts`)

Profiles are stored in `chrome.storage.local` under key `"profiles"`. Write them only through `saveProfile`/`saveManyProfiles`/`deleteProfile`/`updateProfiles`: they hold a Web Lock (`withLock` in `utils.ts`) across extension contexts, so the config page, PAC refresh and sync don't overwrite each other. Deleting the active profile (here or by sync) switches the proxy to Direct (`refreshProxy`). Types: `ProfileSimple` (proxy/pac), `ProfilePreset` (system/direct), `ProfileAutoSwitch` (rule-based routing). System profiles `DIRECT` and `SYSTEM` have fixed IDs `"direct"` and `"system"`. `onProfileUpdate(cb)` fires in every extension context with the new and old profiles.

UI pickers share one reactive profile list (`src/components/configs/useProfileOptions.ts`) and the `ProfileOptions` dropdown items.

### Config import/export (`src/services/config/`)

`importConfig(text, storedProfiles)` detects the file format and returns `{profiles, warnings}`; warnings are i18n keys (`import_warn_*`) the Preference page lists in a modal. `exportConfig` writes our format and names the profiles it skipped as invalid.
- **`proxyverse/`** -- Our format (`version: "2025-01"`), validated with `zod/mini`. Unknown keys are stripped (so runtime fields like `pacScript.lastFetched` never reach a file), and each profile is validated on its own: an invalid one, a reserved ID (`direct`/`system`) or a repeated ID is skipped with a warning.
- **`switchyomega/`** -- SwitchyOmega / ZeroOmega backups (`schemaVersion` 2, `+<name>` profiles, maybe base64). Profile IDs are UUIDv5 of the name, so re-importing overwrites. An enabled attached rule list (`__ruleListOf_<switch>`) is merged into its switch profile; rule lists become static auto profiles. Conditions map to our rules only where the match is exact (`conditions.ts`): URL regexes to `regex` rules, host regexes to `domain` wildcards via `regex.ts` (only those with an exact wildcard equivalent). Anything else (time, weekday, host levels, other regexes) becomes a `disabled` rule holding the condition text, plus a warning. Wildcards never carry `+()[]{}^$|\`: Firefox's PAC `shExpMatch` treats them as regex syntax.

### Cloud sync (`src/services/sync/`)

Profiles and three preferences (`theme.darkmode`, `ui.language`, `ui.actionBehavior`) sync through byte.vet. Protocol: `docs/sync-protocol.md`; wire contract: `docs/sync-api.openapi.yaml`, vendored from the byte.vet webapp repo (which owns it), with types generated into `api.gen.ts` (a unit test fails when they drift).
- **`buildEnv.ts`** -- `PROXYVERSE_ENV` at build time (`build/env.ts`): `production` (byte.vet, client `proxyverse-extension`), `northernlight` (preview server, client `proxyverse-extension-dev`), `e2e` (origin overridable at runtime via `sync.devOrigin`). Chrome dev/e2e builds carry `build/dev-extension-key.pub` as `manifest.key`, fixing the extension ID and so the OAuth redirect URI (`build/README.md`); store builds never do. `identity` is a required permission everywhere: browsers show no warning for it.
- **`auth.ts`** -- OAuth 2.1 code + PKCE via `Host.launchWebAuthFlow`, run from the Preference page (sign-in can outlive an idle service worker). Refresh tokens are single use and reuse revokes the sign-in, so refreshes hold the `proxyverse-sync-auth` lock and store the new refresh token first.
- **`engine.ts`** -- `SyncEngine.run()`: per-record last-writer-wins by HLC (`hlc.ts`). `state.local` (this device's version) vs `state.base` (last agreed with the server) decides what's dirty; there's no outbox, so pending changes survive service worker restarts. Remote changes are written storage first, then state. `records.ts` normalizes profiles with the export schema (no PAC script for URL profiles, upper-case color) and hashes canonical JSON. The engine takes a `SyncDevice` (storage) and an API factory, so unit tests run two devices against the mock store.
- **`index.ts` / `background.ts`** -- the real engine and `sync:*` messages (Sync now, first-sync choice, snapshots); the background syncs at start, after sign-in, 2 s after a local change and on the `sync:poll` alarm (15 min).
- State lives in `sync.auth`, `sync.state`, `sync.settings` (local storage, never synced). "This device only" profiles are `sync.settings.localOnly`, not a profile field. UI: `src/components/sync/` (Preference section) and the switch in `ProfileConfig.vue`.

## Critical Gotcha: `deepClone()` must use JSON round-trip

`deepClone()` in `src/services/utils.ts` uses `JSON.parse(JSON.stringify(obj))`. **Do not replace with `structuredClone()`** -- Vue's reactive Proxy objects throw `DataCloneError` under `structuredClone()`. The JSON round-trip serializes through Vue's Proxy traps and produces plain objects safe for `chrome.storage`.

## Profile editor: edit detection

`ProfileConfig.vue` shows Discard/Save by comparing the form with a JSON snapshot taken at load. Child inputs may write values back on load, which is fine as long as they're unchanged. The color picker upper-cases colors, so `loadProfile` upper-cases the stored color before taking the snapshot.

## E2E tests (`e2e/`)

- Playwright loads the built extension (`.e2e-build/chrome`) in bundled Chromium, one browser and one set of local servers per worker. Each test resets extension state. Spec files must end in `.e2e.ts` (vitest ignores them).
- **Routing is asserted with real traffic**: `*.test` hosts resolve to the machine's LAN IP (`LAN_IP`, via `--host-resolver-rules`) and `*.proxy.internal` to 127.0.0.1, where the test proxies (`proxyA`, `proxyB`, `auth`, `socks`) listen. Distinct IPs let Chrome's `details.ip` tell direct from proxied requests. The proxies answer requests themselves with an `x-route` header, checked by `expectRoute`. Avoid loopback URLs for routed requests: Chrome never proxies them.
- Use `data-testid` selectors; Arco dropdowns, selects and toasts render in `<body>` (helpers in `e2e/pages/arco.ts`).
- `sw.restart()` stops the service worker via CDP `Target.closeTarget`. PAC refresh alarms are fired with `sw.fireAlarm()`.
- Use `freshHost()` for site hosts in tests that inspect the request log (late requests of an earlier test can land in the shared log), and `freshProxyHost()` for proxy hostnames (Chrome caches proxy credentials per proxy host for the browser's lifetime).
- **Sync** runs against a fake byte.vet (`e2e/servers/syncStore.ts` logic, `syncApi.ts` HTTP), on loopback so it's never proxied: `servers.sync` (seed records, `failNext`, `issueTokens`, request log) and `servers.syncOrigin`. Helpers in `e2e/pages/sync.ts`: `useFakeByteVet` before a UI sign-in (Chromium's auth window works headless against it), `signInDirectly` to skip it. The same store is the fake server of the engine's unit tests.
- Firefox smoke (`e2e/firefox/`): temporary add-ons don't get private-browsing access (required by `proxy.settings`), and WebDriver can't open `moz-extension://` URLs. The driver grants the permission and opens pages from Marionette's chrome context, which needs geckodriver ≥ 0.36 with `--allow-system-access`.

## Firefox build differences

The `vite.config.ts` `TRANSFORMER_CONFIG` rewrites `manifest.json` at build time for Firefox:
- Replaces `background.service_worker` with `background.scripts` array
- Removes `version_name`
- Adds `browser_specific_settings.gecko` (minimum version 115, for `storage.session`)

The manifest transform lives in `build/manifest.ts` (pure, unit-tested in `tests/build/`).

## Path alias

`@/` maps to `src/` (configured in both `vite.config.ts` and `tsconfig.json`).

## i18n

Translation strings live in `public/_locales/{locale}/messages.json`. Translations are managed via Transifex. `chrome.i18n` only knows the browser's language, so a language chosen in Preference (`ui.language`, `src/services/i18n.ts`) is loaded from those files before the app mounts and installed as the adapters' message override (per-message fallback to `en`, Chrome's `$1`/`$$`/placeholder formatting); changing it reloads every open page. Add a new locale to `LANGUAGES` too (a unit test checks they match).
