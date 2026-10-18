# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Proxyverse?

A Manifest V3 browser extension (Chrome, Edge, Firefox) for proxy profile management with auto-switch rules and PAC script support. It is an alternative to Proxy SwitchyOmega.

## Build and Test Commands

```bash
npm run build           # Type-check (vue-tsc) + build for Chrome/Edge
npm run build:firefox   # Type-check + build for Firefox (transforms manifest)
npm run dev             # Vite dev server
npm test                # Run vitest in watch mode
npm run coverage        # Single run with coverage report
npx vitest run tests/services/proxy/profile2config.test.ts  # Run a single test file

npm run test:e2e            # Build into .e2e-build/, then run all e2e tests
npm run test:e2e:chromium   # Chromium suite only (Playwright)
npm run test:e2e:firefox    # Firefox smoke suite only (Selenium + geckodriver)
npm run test:e2e:typecheck  # Type-check e2e/ (not covered by vue-tsc)
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

### Browser adapter layer (`src/adapters/`)

`BaseAdapter` defines the abstract contract for all browser APIs (storage, proxy, webRequest, tabs, i18n). Concrete implementations: `Chrome`, `Firefox`, `WebBrowser` (dev stub). A singleton `Host` is auto-detected at import time and used everywhere. This is the only layer that touches `chrome.*` or `browser.*` APIs directly.

### Proxy engine (`src/services/proxy/`)

The core complexity lives here:
- **`profile2config.ts`** -- `ProfileConverter` turns a `ProxyProfile` into a `ProxyConfig` (for `chrome.proxy.settings`). For non-PAC profiles and auto-switch profiles, it **generates PAC scripts via AST** using `escodegen`/`acorn` node builders in `scriptHelper.ts`. Auto-switch profiles compose multiple sub-profiles by generating `register()` calls that build a lookup table.
- **`pacSimulator.ts`** -- JS reimplementations of PAC functions (`shExpMatch`, `isInNet`) used to simulate PAC evaluation in-extension (e.g., for tab badge resolution). `isInNet` returns `UNKNOWN` when given a hostname instead of an IP (can't do DNS in extension context).
- **`auth.ts`** -- Resolves proxy auth credentials by walking the profile tree (auto-switch profiles delegate to sub-profiles).
- **`index.ts`** -- `setProxy`/`refreshProxy` apply a profile and save the `"active-profile"` snapshot (`refreshProxy` updates the snapshot too). `createProfileFinder(profile)` simulates which profile serves a URL (popup and badge). `refreshProxyOnProfileUpdate` re-applies the active profile when a storage change touches it or any profile it routes to (`profileTreeIDs`); the background calls it from `onProfileUpdate`, so writers of profiles don't need to.
- **`ruleEditor.ts`** -- Writes domain rules to the active auto-switch profile from the popup: exact host, or a whole site (`example.com` + `*.example.com`, registrable domain via `tldts`). Rules are updated in place or prepended so they win.
- **`pacFetcher.ts`** -- PAC URL fetching and `pac-refresh:<profileID>` alarms.
- **`route.ts`** -- The route a request actually used. `RouteObserver` (background) turns webRequest details into an `Observation`. Firefox's `details.proxyInfo` is exact. Chrome only reports the first hop's IP (`details.ip`, no port), so it can match proxies set by IP but not by hostname, and can't tell apart proxies sharing an IP (e.g. local proxies on 127.0.0.1 with different ports); mostly it tells direct from proxied. `createRouteResolver(active)` gives the one route shown everywhere (popup chip, Resources View, badge): the observation when it leaves a single possible profile, else the rules' prediction (kept uncertain when the observation contradicts or can't confirm it).

### Request stats and badge

- **`src/services/stats.ts`** -- The background records every request per tab (`TabStats`), reset on each main-frame navigation, persisted to `storage.session` under `tabstats:<tabID>` (survives service worker restarts). The popup reads it via `subscribeTabStats` for the failed-resources alert and the Resources View. Benign errors (aborted, blocked by client) don't count as failures. Opening the popup sends `stats:ack`, marking the tab's failures as seen until it reloads.
- **`src/services/indicator.ts`** -- `TabIndicator` owns the toolbar badge: profile initials (2 chars) globally and per tab, alternating every 2s with the count of unseen failures. It refreshes on proxy changes and on writes of the active-profile snapshot (e.g. a color edit leaves the proxy setting unchanged).

### Profile system (`src/services/profile.ts`)

Profiles are stored in `chrome.storage.local` under key `"profiles"`. Types: `ProfileSimple` (proxy/pac), `ProfilePreset` (system/direct), `ProfileAutoSwitch` (rule-based routing). System profiles `DIRECT` and `SYSTEM` have fixed IDs `"direct"` and `"system"`. `onProfileUpdate(cb)` fires in every extension context with the new and old profiles.

UI pickers share one reactive profile list (`src/components/configs/useProfileOptions.ts`) and the `ProfileOptions` dropdown items.

### Config import/export (`src/services/config/schema/`)

Schema definitions for importing/exporting profile configurations using `io-ts` for runtime type validation.

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
- Firefox smoke (`e2e/firefox/`): temporary add-ons don't get private-browsing access (required by `proxy.settings`), and WebDriver can't open `moz-extension://` URLs. The driver grants the permission and opens pages from Marionette's chrome context, which needs geckodriver ≥ 0.36 with `--allow-system-access`.

## Firefox build differences

The `vite.config.ts` `TRANSFORMER_CONFIG` rewrites `manifest.json` at build time for Firefox:
- Replaces `background.service_worker` with `background.scripts` array
- Removes `version_name`
- Adds `browser_specific_settings.gecko` (minimum version 115, for `storage.session`)

## Path alias

`@/` maps to `src/` (configured in both `vite.config.ts` and `tsconfig.json`).

## i18n

Translation strings live in `public/_locales/{locale}/messages.json`. Translations are managed via Transifex.
