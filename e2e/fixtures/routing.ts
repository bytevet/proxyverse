import { expect, type Page } from "@playwright/test";
import type { Route, Servers } from "../servers";

let counter = 0;

/**
 * Load `url` in `page` and return which server answered: "direct", a proxy
 * name, or `status:<code>` when no test server produced the response (e.g.
 * a 407 from the auth proxy, or a network error as `error:<message>`).
 */
export async function routeOf(page: Page, url: string): Promise<string> {
  // unique query so nothing is served from cache
  const u = new URL(url);
  u.searchParams.set("e2e", `${++counter}`);
  try {
    const res = await page.goto(u.href, { waitUntil: "commit" });
    if (!res) return "error:no-response";
    return res.headers()["x-route"] ?? `status:${res.status()}`;
  } catch (e: any) {
    return `error:${String(e.message).split("\n")[0]}`;
  }
}

/**
 * Assert that `url` is (eventually) served through `route`. Proxy changes
 * are applied asynchronously by the background, hence the polling.
 */
export async function expectRoute(page: Page, url: string, route: Route) {
  await expect.poll(() => routeOf(page, url), { timeout: 10_000 }).toBe(route);
}

/** Which proxy received the CONNECT tunnel for an https URL's host. */
export async function expectConnectVia(
  page: Page,
  servers: Servers,
  url: string,
  route: Route
) {
  const host = new URL(url).hostname;
  await expect
    .poll(
      async () => {
        servers.log.clear();
        await page.goto(url, { waitUntil: "commit" }).catch(() => undefined);
        return servers.log
          .forHost(host)
          .find((e) => e.method === "CONNECT")?.route;
      },
      { timeout: 10_000 }
    )
    .toBe(route);
}
