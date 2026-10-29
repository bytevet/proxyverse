# build/

Build-time helpers imported by `vite.config.ts`:

- `env.ts` -- the build environments chosen by `PROXYVERSE_ENV`
  (`production`, the default; `northernlight`; `e2e`) and the sync settings
  each one compiles in.
- `manifest.ts` -- turns the root `manifest.json` into a build's manifest.

## Dev extension key

`dev-extension-key.pub` is the public half of an RSA key (base64 DER
SubjectPublicKeyInfo). Chrome builds with `PROXYVERSE_ENV=northernlight` or
`e2e` put it in `manifest.key`, so that unpacked builds always get the same
extension ID, and so the same OAuth redirect URI, registered on the
`proxyverse-extension-dev` client. **Dev only**: production builds never
carry a key (the stores assign the ID), and the private key is not kept
anywhere -- Chrome doesn't need it for unpacked extensions.

| | |
|---|---|
| Chrome/Edge dev extension ID | `ohbdfegnjlfoohcaiedlpbmcacohacmg` |
| Chrome/Edge dev redirect URI | `https://ohbdfegnjlfoohcaiedlpbmcacohacmg.chromiumapp.org/oauth` |
| Firefox redirect URI | `https://1e603ec5914c06cbcc280eb4c99adc6034a2cdff.extensions.allizom.org/oauth` |

The Chrome ID is the first 32 hex digits of SHA-256 of the DER key, with
`0-f` mapped to `a-p`. Firefox derives its redirect URL from the add-on ID
(`proxyverse@byte.vet`, the same in every build): the hex SHA-1 of the ID,
under `extensions.allizom.org` (`identity.getRedirectURL()`, see
`toolkit/components/extensions/child/ext-identity.js`).

To recompute them:

```sh
base64 -d -i build/dev-extension-key.pub | shasum -a 256 | cut -c1-32 | tr 0-9a-f a-p
printf %s proxyverse@byte.vet | shasum -a 1
```
