import { test, expect } from "../fixtures";
import { expectRoute } from "../fixtures/routing";
import { autoProfile, rule, standardProfiles } from "../data/profiles";
import { profileOptions } from "../pages/arco";
import {
  fieldError,
  saveNew,
  stored,
  stubClipboard,
} from "../pages/editorExtras";

test.describe("auto switch profiles", () => {
  test.describe("rule types", () => {
    test("domain wildcard and exact domain", async ({
      sw,
      servers,
      page,
      activate,
    }) => {
      const { proxyA, proxyB } = standardProfiles(servers);
      const auto = autoProfile({ profileID: "auto" }, [
        rule("domain", "*.wild.test", "proxyA"),
        rule("domain", "exact.test", "proxyB"),
      ]);
      await sw.setProfiles([proxyA, proxyB, auto]);
      await activate("auto");

      await expectRoute(page, servers.url("a.wild.test"), "proxyA");
      await expectRoute(page, servers.url("a.b.wild.test"), "proxyA");
      await expectRoute(page, servers.url("exact.test"), "proxyB");
      await expectRoute(page, servers.url("sub.exact.test"), "direct");
    });

    test("URL pattern", async ({ sw, servers, page, activate }) => {
      const { socks } = standardProfiles(servers);
      const pattern = `http://url.test:${servers.ports.direct}/api/*`;
      const auto = autoProfile({ profileID: "auto" }, [
        rule("url", pattern, "socks"),
      ]);
      await sw.setProfiles([socks, auto]);
      await activate("auto");

      await expectRoute(page, servers.url("url.test", "/api/items"), "socks");
      await expectRoute(page, servers.url("url.test", "/home"), "direct");
    });

    test("URL regex", async ({ sw, servers, page, activate }) => {
      const { proxyA } = standardProfiles(servers);
      const auto = autoProfile({ profileID: "auto" }, [
        rule("regex", "^http://(www\\.)?re\\.test:\\d+/api/", "proxyA"),
      ]);
      await sw.setProfiles([proxyA, auto]);
      await activate("auto");

      await expectRoute(page, servers.url("re.test", "/api/items"), "proxyA");
      await expectRoute(page, servers.url("www.re.test", "/api/"), "proxyA");
      await expectRoute(page, servers.url("re.test", "/home"), "direct");
      await expectRoute(page, servers.url("xre.test", "/api/"), "direct");
    });

    test("CIDR on an IP literal", async ({ sw, servers, page, activate }) => {
      const { proxyA } = standardProfiles(servers);
      const auto = autoProfile({ profileID: "auto" }, [
        rule("cidr", "198.51.100.0/24", "proxyA"),
      ]);
      await sw.setProfiles([proxyA, auto]);
      await activate("auto");

      // nothing listens on 198.51.100.7, so only the proxy can answer
      await expectRoute(
        page,
        `http://198.51.100.7:${servers.ports.direct}/`,
        "proxyA",
      );
      await expectRoute(page, servers.url("site.test"), "direct");
    });

    test("'Temporarily Skip' rules are ignored", async ({
      sw,
      servers,
      page,
      activate,
    }) => {
      const { proxyA } = standardProfiles(servers);
      const auto = autoProfile({ profileID: "auto" }, [
        rule("disabled", "*.skip.test", "proxyA"),
        rule("domain", "*.kept.test", "proxyA"),
      ]);
      await sw.setProfiles([proxyA, auto]);
      await activate("auto");

      await expectRoute(page, servers.url("www.kept.test"), "proxyA");
      await expectRoute(page, servers.url("www.skip.test"), "direct");
    });

    test("'Temporarily Skip' disables the rule inputs", async ({
      sw,
      servers,
      openEditor,
    }) => {
      const { proxyA } = standardProfiles(servers);
      await sw.setProfiles([
        proxyA,
        autoProfile({ profileID: "auto" }, [
          rule("domain", "a.test", "proxyA"),
        ]),
      ]);
      const editor = await openEditor("auto");
      const r = editor.rule(0);
      await expect(r.condition.locator("input")).toBeEnabled();
      await expect(r.route).toBeEnabled();

      await editor.setRule(0, { type: "Temporarily Skip" });
      await expect(r.condition.locator("input")).toBeDisabled();
      await expect(r.route).toBeDisabled();
    });
  });

  test("the first matching rule wins", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    const { proxyA, proxyB } = standardProfiles(servers);
    await sw.setProfiles([
      proxyA,
      proxyB,
      autoProfile({ profileID: "auto" }, [
        rule("domain", "*.both.test", "proxyA"),
        rule("domain", "www.both.test", "proxyB"),
      ]),
    ]);
    await activate("auto");
    await expectRoute(page, servers.url("www.both.test"), "proxyA");
  });

  test("unmatched traffic uses the default profile", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    const { proxyA, proxyB } = standardProfiles(servers);
    await sw.setProfiles([
      proxyA,
      proxyB,
      autoProfile(
        { profileID: "auto" },
        [rule("domain", "*.a.test", "proxyA")],
        "proxyB",
      ),
    ]);
    await activate("auto");
    await expectRoute(page, servers.url("x.a.test"), "proxyA");
    await expectRoute(page, servers.url("other.test"), "proxyB");
  });

  test("nested auto profiles", async ({ sw, servers, page, activate }) => {
    const { proxyB, socks } = standardProfiles(servers);
    await sw.setProfiles([
      proxyB,
      socks,
      autoProfile(
        { profileID: "inner" },
        [rule("domain", "a.nest.test", "socks")],
        "proxyB",
      ),
      autoProfile({ profileID: "outer" }, [
        rule("domain", "*.nest.test", "inner"),
      ]),
    ]);
    await activate("outer");

    await expectRoute(page, servers.url("a.nest.test"), "socks");
    await expectRoute(page, servers.url("b.nest.test"), "proxyB");
    await expectRoute(page, servers.url("other.test"), "direct");
  });

  test("rules built in the editor are saved and route", async ({
    sw,
    servers,
    page,
    openEditor,
    activate,
  }) => {
    const { proxyA, socks } = standardProfiles(servers);
    await sw.setProfiles([proxyA, socks]);
    const editor = await openEditor();
    await editor.setType("auto");
    await editor.setRule(0, {
      type: "Domain",
      condition: "*.ui.test",
      profileID: "proxyA",
    });
    await editor.setRule(1, {
      type: "CIDR",
      condition: "198.51.100.0/24",
      profileID: "socks",
    });
    const id = await saveNew(editor);

    expect((await stored(sw, id, "auto")).rules).toEqual([
      rule("domain", "*.ui.test", "proxyA"),
      rule("cidr", "198.51.100.0/24", "socks"),
    ]);
    await activate(id);
    await expectRoute(page, servers.url("www.ui.test"), "proxyA");
    await expectRoute(
      page,
      `http://198.51.100.7:${servers.ports.direct}/`,
      "socks",
    );
  });

  test("shows rule validation messages", async ({ openEditor }) => {
    const editor = await openEditor();
    await editor.setType("auto");
    const condition = editor.rule(0).condition;

    await editor.setRule(0, { type: "URL", condition: "not a url" });
    await expect(fieldError(condition)).toHaveText("Invalid URL");

    await editor.setRule(0, { condition: "https://example.test/path" });
    await expect(fieldError(condition)).toContainText(
      "Chrome does not support path matching in HTTPS URLs",
    );

    await editor.setRule(0, { condition: "https://example.test/" });
    await expect(fieldError(condition)).toBeHidden();

    await editor.setRule(0, { type: "CIDR", condition: "10.0.0.300/8" });
    await expect(fieldError(condition)).toContainText("Invalid CIDR");

    await editor.setRule(0, { condition: "10.0.0.0/8" });
    await expect(fieldError(condition)).toBeHidden();

    await editor.setRule(0, { type: "URL RegExp", condition: "^https://(a" });
    await expect(fieldError(condition)).toHaveText("Invalid regular expression");

    await editor.setRule(0, { condition: "^https://(a|b)\\.test/" });
    await expect(fieldError(condition)).toBeHidden();
  });

  test("explains the selected condition type", async ({ openEditor }) => {
    const editor = await openEditor();
    await editor.setType("auto");
    const help = editor.byId("rule-0-help");
    const content = editor.page.getByTestId("rule-0-help-content");

    await help.hover();
    await expect(content).toContainText("Matches the host name with wildcards");

    await editor.setRule(0, { type: "URL RegExp" });
    await help.hover();
    await expect(content).toContainText("unless anchored with ^ and $, e.g.");
    await expect(content).toContainText("Chrome since version 52");
  });

  test("adds, duplicates and deletes rules", async ({ openEditor }) => {
    const editor = await openEditor();
    await editor.setType("auto");
    const conditions = () =>
      editor.rows()
        .locator('[data-testid$="-condition"] input')
        .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    // a new profile comes with example rules
    const initial = await conditions();
    expect(initial).toHaveLength(2);

    await editor.addRule();
    await expect(editor.rows()).toHaveCount(3);
    await expect(editor.rule(2).condition.locator("input")).toHaveValue("");
    await expect(editor.rule(2).type).toContainText("Domain");
    await editor.setRule(2, { condition: "added.test" });

    await editor.rule(0).duplicate.click();
    await expect(editor.rows()).toHaveCount(4);
    expect(await conditions()).toEqual([...initial, "added.test", initial[0]]);

    await editor.rule(0).delete.click();
    await expect(editor.rows()).toHaveCount(3);
    expect(await conditions()).toEqual([initial[1], "added.test", initial[0]]);
  });

  test("drag-reordering rules changes which one wins", async ({
    sw,
    servers,
    page,
    openEditor,
    activate,
  }) => {
    const { proxyA, proxyB } = standardProfiles(servers);
    await sw.setProfiles([
      proxyA,
      proxyB,
      autoProfile({ profileID: "auto" }, [
        rule("domain", "*.both.test", "proxyA"),
        rule("domain", "www.both.test", "proxyB"),
      ]),
    ]);
    await activate("auto");
    const site = servers.url("www.both.test");
    await expectRoute(page, site, "proxyA");

    const editor = await openEditor("auto");
    await editor.dragRule(1, 0);
    await expect(editor.rule(0).condition.locator("input")).toHaveValue(
      "www.both.test",
    );
    await editor.saveOK();
    expect(
      (await stored(sw, "auto", "auto")).rules.map((r) => r.profileID),
    ).toEqual(["proxyB", "proxyA"]);
    await expectRoute(page, site, "proxyB");
  });

  test("the route picker excludes the profile itself and disables System", async ({
    sw,
    servers,
    openEditor,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([
      proxyA,
      autoProfile({ profileID: "auto" }, [rule("domain", "a.test", "proxyA")]),
      autoProfile({ profileID: "other" }, []),
    ]);
    const editor = await openEditor("auto");

    for (const trigger of [editor.rule(0).route, editor.byId("rule-default")]) {
      const options = await profileOptions(editor.page, trigger);
      expect(options.map((o) => o.id).sort()).toEqual(
        ["direct", "other", "proxyA", "system"].sort(),
      );
      expect(options.find((o) => o.id === "system")?.disabled).toBe(true);
      expect(options.find((o) => o.id === "proxyA")?.disabled).toBe(false);
    }
  });

  test("previews and copies the generated PAC script", async ({
    sw,
    servers,
    openEditor,
  }) => {
    const { proxyA, proxyB } = standardProfiles(servers);
    await sw.setProfiles([
      proxyA,
      proxyB,
      autoProfile(
        { profileID: "auto" },
        [
          rule("domain", "*.wild.test", "proxyA"),
          rule("cidr", "198.51.100.0/24", "proxyB"),
        ],
        "proxyB",
      ),
    ]);
    const editor = await openEditor("auto");
    const preview = editor.byId("pac-preview");
    await preview.locator(".arco-collapse-item-header").click();

    const code = preview.locator(".script-display code");
    await expect(code).toContainText("FindProxyForURL");
    await expect(code).toContainText("shExpMatch(host, '*.wild.test')");
    await expect(code).toContainText(
      "isInNet(host, '198.51.100.0', '255.255.255.0')",
    );
    await expect(code).toContainText(`127.0.0.1:${servers.ports.proxyA}`);

    // edits show up in the preview
    await editor.setRule(0, { condition: "*.edited.test" });
    await expect(code).toContainText("shExpMatch(host, '*.edited.test')");

    const copied = await stubClipboard(editor.page);
    await editor.byId("pac-preview-copy").click();
    await expect(editor.byId("pac-preview-copy")).toHaveText("Copied");
    expect(await copied()).toBe(await code.textContent());
  });
});
