import { test, expect } from "../fixtures";
import { expectRoute, routeOf } from "../fixtures/routing";
import { autoProfile, proxyProfile, rule } from "../data/profiles";
import { freshHost, freshProxyHost } from "../data/hosts";
import { AUTH, type Servers } from "../servers";
import type { ProxyServer } from "@/services/profile";

const authServer = (
  servers: Servers,
  host: string,
  auth?: ProxyServer["auth"],
): ProxyServer => ({ scheme: "http", host, port: servers.ports.auth, auth });

/** Host of the request caching the proxy credentials, see `warmUpProxyAuth`. */
const WARM_UP_HOST = "proxyverse-auth.invalid";

/** Auth results seen by the auth proxy for `host`, in order. */
const authAttempts = (servers: Servers, host: string) =>
  servers.log
    .forHost(host)
    .filter((e) => e.route === "auth")
    .map((e) => e.auth);

test.describe("proxy auth", () => {
  test("correct credentials pass the auth proxy", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    const site = freshHost();
    const proxyHost = freshProxyHost();
    await sw.setProfiles([
      proxyProfile(
        { profileID: "authed" },
        { default: authServer(servers, proxyHost, AUTH) },
      ),
    ]);
    await activate("authed");

    await expectRoute(page, servers.url(site), "auth");
    expect(authAttempts(servers, site)).toContain("ok");
  });

  test("has the browser cache the credentials once a proxy is set", async ({
    sw,
    servers,
    activate,
  }) => {
    // Chrome prompts for requests the extension can't see (e.g. the new tab
    // page's), unless it already has the credentials of the proxy
    const proxyHost = freshProxyHost();
    await sw.setProfiles([
      proxyProfile(
        { profileID: "authed" },
        { default: authServer(servers, proxyHost, AUTH) },
      ),
    ]);
    await activate("authed");

    await expect
      .poll(() => authAttempts(servers, WARM_UP_HOST))
      .toEqual(["none", "ok"]);
  });

  test("matches the proxy host regardless of case", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    const site = freshHost();
    // Chrome reports the challenger host lower-cased
    const proxyHost = freshProxyHost().toUpperCase();
    await sw.setProfiles([
      proxyProfile(
        { profileID: "authed" },
        { default: authServer(servers, proxyHost, AUTH) },
      ),
    ]);
    await activate("authed");

    await expectRoute(page, servers.url(site), "auth");
    expect(authAttempts(servers, site)).toContain("ok");
  });

  test("retries with the next candidate when the first is wrong", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    const site = freshHost();
    const proxyHost = freshProxyHost();
    const wrong = { username: AUTH.username, password: "wrong" };
    // candidates are tried in order: default, ftp, http, https
    await sw.setProfiles([
      proxyProfile(
        { profileID: "authed" },
        {
          default: authServer(servers, proxyHost, wrong),
          http: authServer(servers, proxyHost, AUTH),
        },
      ),
    ]);
    await activate("authed");

    // no credentials, then the wrong ones, then the right ones, seen on the
    // first request through the proxy: the one caching the credentials
    await expect
      .poll(() => authAttempts(servers, WARM_UP_HOST))
      .toEqual(["none", "bad", "ok"]);
    await expectRoute(page, servers.url(site), "auth");
    expect(authAttempts(servers, site)).toContain("ok");
  });

  test("without credentials the 407 surfaces", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    const site = freshHost();
    const proxyHost = freshProxyHost();
    await sw.setProfiles([
      proxyProfile(
        { profileID: "authed" },
        { default: authServer(servers, proxyHost) },
      ),
    ]);
    await activate("authed");

    // headless Chrome fails the navigation instead of prompting
    await expect
      .poll(() => routeOf(page, servers.url(site)), { timeout: 10_000 })
      .toMatch(/^(status:407|error:.*ERR_INVALID_AUTH_CREDENTIALS)/);
    expect(authAttempts(servers, site)).toContain("none");
    expect(authAttempts(servers, site)).not.toContain("ok");
  });

  test("uses credentials of a sub-profile of the active auto profile", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    const site = freshHost();
    const proxyHost = freshProxyHost();
    await sw.setProfiles([
      proxyProfile(
        { profileID: "authed" },
        { default: authServer(servers, proxyHost, AUTH) },
      ),
      autoProfile(
        { profileID: "auto" },
        [rule("domain", "*.secret.test", "authed")],
        "direct",
      ),
    ]);
    await activate("auto");

    await expectRoute(page, servers.url("www.secret.test"), "auth");
    expect(authAttempts(servers, "www.secret.test")).toContain("ok");
    await expectRoute(page, servers.url(site), "direct");
  });
});
