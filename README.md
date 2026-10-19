![Proxyverse](./public/full-logo.svg)

[![Build Extension](https://github.com/bytevet/proxyverse/actions/workflows/build.yml/badge.svg)](https://github.com/bytevet/proxyverse/actions/workflows/build.yml)
[![Test](https://github.com/bytevet/proxyverse/actions/workflows/test.yml/badge.svg)](https://github.com/bytevet/proxyverse/actions/workflows/test.yml)

Proxyverse is a simple tool to help you switch between different proxy profiles. It's an alternative to Proxy SwitchyOmega, built on the latest web extension standard (Manifest V3) for Chrome, Edge and Firefox.

# Features

- **Proxy profiles**: HTTP, HTTPS, SOCKS4 and SOCKS5 proxies, per-scheme servers, bypass lists and proxy authentication
- **PAC scripts**: inline, or fetched from a URL and refreshed periodically
- **Auto switch**: route requests by rules (domain wildcards, URL wildcards, URL regular expressions, IP ranges), each to the profile of your choice
- **See what happened**: the popup shows which profile served the current site and lists failed requests, and the toolbar badge flags failures
- **Quick rules**: add the current site to an auto switch profile from the popup
- **Import & export** your profiles, and import a **ProxySwitchyOmega / ZeroOmega** backup (beta)
- **Interface preferences**: language, light / dark theme, and a popup or a sidebar for the toolbar icon
- Available in English, Português (Brasil), 简体中文 and 繁體中文

Still on the way:

- [ ] Support Safari

# How to download?

- [Chrome](https://chromewebstore.google.com/detail/proxyverse/igknmaflmijecdmjpcgollghmipkfbho)
- [Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/bpjcpinklkdfabcncofogcaigmmgjjbj)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/proxyverse/)

## Moving from SwitchyOmega?

In SwitchyOmega or ZeroOmega, open **Import/Export** and download a backup (`.bak`). In Proxyverse, open **Preference → Import Profiles** and pick that file. Rules that can't be converted exactly are listed after the import and kept as disabled rules for you to review.

# Making a Contribution

## Development

1. Fork the repository and make changes.
2. Write tests for your changes: unit tests with [vitest](https://vitest.dev/), and end-to-end tests with [Playwright](https://playwright.dev/) for behavior in the browser.
3. Make sure everything works perfectly before you make any pull request.

```bash
npm install
npm run build           # Chrome / Edge build into dist/
npm run build:firefox   # Firefox build into dist/
npm test                # unit tests (watch mode)
npm run test:e2e        # end-to-end tests in Chromium and Firefox
```

Load `dist/` as an unpacked extension in Chrome (`chrome://extensions`, developer mode), or as a temporary add-on in Firefox (`about:debugging`). Both builds write to `dist/`, so rebuild for the browser you're about to load.

## Translation & i18n

Proxyverse is using [transifex](https://explore.transifex.com/bytevet/proxyverse/) for translations.
