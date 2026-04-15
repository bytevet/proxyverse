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
```

CI runs `npm run coverage` on PRs to main/develop; `npm run build` + `npm run build:firefox` on pushes and tags.

## Architecture

### Three build entry points

The Vite config defines three entry points that produce the extension bundle:
- **`index.html`** / **`popup.html`** -- Both load `src/main.ts` (Vue app). The Vue router uses hash history: `#/popup` renders `PopupPage`, `#/` renders `ConfigPage` with nested profile/preference routes.
- **`src/background.ts`** -- Service worker. Wires up proxy auth, request stats, and badge indicator. No Vue, no DOM.

### Browser adapter layer (`src/adapters/`)

`BaseAdapter` defines the abstract contract for all browser APIs (storage, proxy, webRequest, tabs, i18n). Concrete implementations: `Chrome`, `Firefox`, `WebBrowser` (dev stub). A singleton `Host` is auto-detected at import time and used everywhere. This is the only layer that touches `chrome.*` or `browser.*` APIs directly.

### Proxy engine (`src/services/proxy/`)

The core complexity lives here:
- **`profile2config.ts`** -- `ProfileConverter` turns a `ProxyProfile` into a `ProxyConfig` (for `chrome.proxy.settings`). For non-PAC profiles and auto-switch profiles, it **generates PAC scripts via AST** using `escodegen`/`acorn` node builders in `scriptHelper.ts`. Auto-switch profiles compose multiple sub-profiles by generating `register()` calls that build a lookup table.
- **`pacSimulator.ts`** -- JS reimplementations of PAC functions (`shExpMatch`, `isInNet`) used to simulate PAC evaluation in-extension (e.g., for tab badge resolution). `isInNet` returns `UNKNOWN` when given a hostname instead of an IP (can't do DNS in extension context).
- **`auth.ts`** -- Resolves proxy auth credentials by walking the profile tree (auto-switch profiles delegate to sub-profiles).

### Profile system (`src/services/profile.ts`)

Profiles are stored in `chrome.storage.local` under key `"profiles"`. Types: `ProfileSimple` (proxy/pac), `ProfilePreset` (system/direct), `ProfileAutoSwitch` (rule-based routing). System profiles `DIRECT` and `SYSTEM` have fixed IDs `"direct"` and `"system"`.

### Config import/export (`src/services/config/schema/`)

Schema definitions for importing/exporting profile configurations using `io-ts` for runtime type validation.

## Critical Gotcha: `deepClone()` must use JSON round-trip

`deepClone()` in `src/services/utils.ts` uses `JSON.parse(JSON.stringify(obj))`. **Do not replace with `structuredClone()`** -- Vue's reactive Proxy objects throw `DataCloneError` under `structuredClone()`. The JSON round-trip serializes through Vue's Proxy traps and produces plain objects safe for `chrome.storage`.

## Firefox build differences

The `vite.config.ts` `TRANSFORMER_CONFIG` rewrites `manifest.json` at build time for Firefox:
- Replaces `background.service_worker` with `background.scripts` array
- Removes `version_name`
- Adds `browser_specific_settings.gecko`

## Path alias

`@/` maps to `src/` (configured in both `vite.config.ts` and `tsconfig.json`).

## i18n

Translation strings live in `public/_locales/{locale}/messages.json`. Translations are managed via Transifex.
