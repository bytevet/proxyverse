import { test, expect } from "../fixtures";
import { expectRoute, routeOf } from "../fixtures/routing";
import { autoProfile, proxyProfile, rule } from "../data/profiles";
import { freshHost } from "../data/hosts";
import { AUTH, type Servers } from "../servers";
import type { ProxyServer } from "@/services/profile";

const authServer = (
  servers: Servers,
  host: string,
  auth?: ProxyServer["auth"],
): ProxyServer => ({ scheme: "http", host, port: servers.ports.auth, auth });

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
    const proxyHost = freshHost("proxy");
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
    const proxyHost = freshHost("proxy");
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

    await expectRoute(page, servers.url(site), "auth");
    // no credentials, then the wrong ones, then the right ones. Requests
    // running at the same time (e.g. the favicon) may interleave in the log.
    const attempts = authAttempts(servers, site);
    expect(attempts[0]).toBe("none");
    expect(attempts).toContain("bad");
    expect(attempts.indexOf("bad")).toBeLessThan(attempts.indexOf("ok"));
  });

  test("without credentials the 407 surfaces", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    const site = freshHost();
    const proxyHost = freshHost("proxy");
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
    const proxyHost = freshHost("proxy");
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
