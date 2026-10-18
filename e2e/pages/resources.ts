import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { ServiceWorker } from "../fixtures/sw";
import type { Servers } from "../servers";

/** The Resources view of the popup, listing the requests of a tab. */
export class ResourcesView {
  constructor(readonly page: Page) {}

  /** Open the view for `tabID` directly. */
  static async open(context: BrowserContext, sw: ServiceWorker, tabID: number) {
    const page = await context.newPage();
    await page.goto(`${sw.origin}/index.html#/popup/resources/${tabID}`);
    const view = new ResourcesView(page);
    await expect(view.back).toBeVisible();
    return view;
  }

  get back() {
    return this.page.getByTestId("resources-back");
  }

  get filterAll() {
    return this.page.getByTestId("resources-filter-all");
  }

  get filterFailed() {
    return this.page.getByTestId("resources-filter-failed");
  }

  groups() {
    return this.page.locator('[data-testid^="resource-group-"]');
  }

  group(host: string) {
    return this.page.getByTestId(`resource-group-${host}`);
  }

  /** Hosts of the groups, in display order. */
  async hosts() {
    return this.groups().evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-testid")!.replace("resource-group-", ""))
    );
  }

  async toggle(host: string) {
    await this.group(host).locator(".arco-collapse-item-header .host").click();
  }

  rows(host?: string): Locator {
    return (host ? this.group(host) : this.page).getByTestId("resource-row");
  }

  /** The row whose path contains `path`. */
  row(host: string, path: string) {
    return this.rows(host).filter({ hasText: path });
  }

  chip(host: string) {
    return this.group(host).getByTestId("switch-chip");
  }
}

/** A URL that fails to load: nothing listens on its port. */
export const refused = (servers: Servers, path: string) =>
  `http://refused.test:${servers.ports.closed}${path}`;

/** A sub-resource of a test page. */
export type SubResource = {
  kind: "css" | "js" | "img" | "iframe" | "xhr";
  url: string;
};

/**
 * Register a page at `pagePath` loading `resources`, plus content for each
 * resource path. Returns the page URL on `host`.
 */
export function storePage(
  servers: Servers,
  host: string,
  pagePath: string,
  resources: SubResource[]
) {
  const tags: string[] = [];
  const xhrs: string[] = [];
  for (const r of resources) {
    const url = r.url;
    const path = new URL(url).pathname;
    switch (r.kind) {
      case "css":
        servers.store.set(path, { type: "text/css", body: "body { margin: 0 }" });
        tags.push(`<link rel="stylesheet" href="${url}">`);
        break;
      case "js":
        servers.store.set(path, { type: "text/javascript", body: "void 0;" });
        tags.push(`<script src="${url}"></script>`);
        break;
      case "img":
        servers.store.set(path, {
          type: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        });
        tags.push(`<img src="${url}">`);
        break;
      case "iframe":
        servers.store.set(path, { type: "text/html", body: "<p>frame</p>" });
        tags.push(`<iframe src="${url}"></iframe>`);
        break;
      case "xhr":
        servers.store.set(path, { type: "application/json", body: "{}" });
        xhrs.push(url);
        break;
    }
  }

  servers.store.set(pagePath, {
    type: "text/html",
    body: `<!doctype html><title>resources</title>
${tags.join("\n")}
<script>
${xhrs.map((u) => `fetch(${JSON.stringify(u)}).catch(() => {});`).join("\n")}
</script>`,
  });
  return servers.url(host, pagePath);
}
