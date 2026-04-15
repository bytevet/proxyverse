import { expect, test, describe } from "vitest";
import { newProxyString } from "@/services/proxy/scriptHelper";
import type { ProxyServer } from "@/services/profile";

describe("newProxyString", () => {
  test("generates DIRECT for direct scheme", () => {
    const cfg: ProxyServer = { host: "", scheme: "direct" };
    expect(newProxyString(cfg).value).toBe("DIRECT");
  });

  test("generates PROXY for http scheme", () => {
    const cfg: ProxyServer = { host: "127.0.0.1", port: 8080, scheme: "http" };
    expect(newProxyString(cfg).value).toBe("PROXY 127.0.0.1:8080");
  });

  test("generates HTTPS for https scheme", () => {
    const cfg: ProxyServer = {
      host: "proxy.example.com",
      port: 443,
      scheme: "https",
    };
    expect(newProxyString(cfg).value).toBe("HTTPS proxy.example.com:443");
  });

  test("generates SOCKS for socks4 scheme", () => {
    const cfg: ProxyServer = {
      host: "127.0.0.1",
      port: 1080,
      scheme: "socks4",
    };
    expect(newProxyString(cfg).value).toBe(
      "SOCKS4 127.0.0.1:1080; SOCKS 127.0.0.1:1080",
    );
  });

  test("generates SOCKS5 for socks5 scheme", () => {
    const cfg: ProxyServer = {
      host: "127.0.0.1",
      port: 1080,
      scheme: "socks5",
    };
    expect(newProxyString(cfg).value).toBe(
      "SOCKS5 127.0.0.1:1080; SOCKS 127.0.0.1:1080",
    );
  });

  test("defaults to http (PROXY) when scheme is undefined", () => {
    const cfg: ProxyServer = { host: "127.0.0.1", port: 3128 };
    expect(newProxyString(cfg).value).toBe("PROXY 127.0.0.1:3128");
  });

  test("omits port when undefined", () => {
    const cfg: ProxyServer = { host: "proxy.example.com", scheme: "http" };
    expect(newProxyString(cfg).value).toBe("PROXY proxy.example.com");
  });
});
