import { expect, test, describe } from "vitest";
import type { ProxyProfile } from "@/services/profile";
import { ProfileAuthProvider } from "@/services/proxy/auth";

const profiles: Record<string, ProxyProfile> = {
  simpleProxy: {
    profileID: "simpleProxy",
    color: "",
    profileName: "",
    proxyType: "proxy",
    proxyRules: {
      default: {
        scheme: "http",
        host: "127.0.0.1",
        port: 8080,
      },
      bypassList: [],
    },
  },
  simpleProxyWithAuth: {
    profileID: "simpleProxyWithAuth",
    color: "",
    profileName: "",
    proxyType: "proxy",
    proxyRules: {
      default: {
        scheme: "http",
        host: "127.0.0.1",
        port: 8080,
        auth: {
          username: "user",
          password: "pass",
        },
      },
      bypassList: [],
    },
  },
  autoProxy: {
    profileID: "autoProxy",
    color: "",
    profileName: "",
    proxyType: "auto",
    rules: [
      {
        type: "domain",
        condition: "*.example.com",
        profileID: "simpleProxy",
      },
      {
        type: "domain",
        condition: "*.example2.com",
        profileID: "simpleProxyWithAuth",
      },
      {
        type: "domain",
        condition: "*.example3.com",
        profileID: "autoProxy", // circular reference
      },
    ],
    defaultProfileID: "direct",
  },

  autoProxyWithDefault: {
    profileID: "autoProxyWithDefault",
    color: "",
    profileName: "",
    proxyType: "auto",
    rules: [],
    defaultProfileID: "simpleProxyWithAuth",
  },
};

describe("testing auth provider", () => {
  test("test auth provider for simple proxy", async () => {
    let authProvider = new ProfileAuthProvider(profiles.simpleProxy);
    let authInfos = await authProvider.getAuthInfos("example.com", 80);
    expect(authInfos).toEqual([]);

    authProvider = new ProfileAuthProvider(profiles.simpleProxyWithAuth);
    authInfos = await authProvider.getAuthInfos("example.com", 80);
    expect(authInfos).toEqual([]);

    authInfos = await authProvider.getAuthInfos("127.0.0.1", 8080);
    expect(authInfos).toEqual([
      {
        username: "user",
        password: "pass",
      },
    ]);
  });

  test("test auth provider for auto proxy", async () => {
    const authProvider = new ProfileAuthProvider(
      profiles.autoProxy,
      async (id) => {
        return profiles[id];
      }
    );
    let authInfos = await authProvider.getAuthInfos("example.com", 80);
    expect(authInfos).toEqual([]);

    authInfos = await authProvider.getAuthInfos("127.0.0.1", 8080);
    expect(authInfos).toEqual([
      {
        username: "user",
        password: "pass",
      },
    ]);
  });

  test("test auth provider for auto proxy with default", async () => {
    const authProvider = new ProfileAuthProvider(
      profiles.autoProxyWithDefault,
      async (id) => {
        return profiles[id];
      }
    );

    let authInfos = await authProvider.getAuthInfos("example.com", 80);
    expect(authInfos).toEqual([]);

    authInfos = await authProvider.getAuthInfos("127.0.0.1", 8080);
    expect(authInfos).toEqual([
      {
        username: "user",
        password: "pass",
      },
    ]);
  });
});
