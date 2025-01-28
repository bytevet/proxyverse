import { config2json } from "@/services/config/schema";
import { ProxyProfile } from "@/services/profile";
import { expect, test, describe } from "vitest";

const mockInnerConfig: Record<
  string,
  ProxyProfile & {
    [key: string]: any; // Index signature to allow additional properties
  }
> = {
  "90750184-fb8f-4130-ad83-c997a7207300": {
    color: "#DCF190",
    defaultProfileID: "direct",
    pacScript: {
      data: "function FindProxyForURL(url, host) {\n  // …\n  return 'DIRECT';\n}",
    },
    profileID: "90750184-fb8f-4130-ad83-c997a7207300",
    profileName: "PAC Script",
    proxyRules: {
      bypassList: ["<local>", "127.0.0.1", "[::1]"],
      default: {
        host: "127.0.0.1",
        port: 8080,
        scheme: "http",
      },
    },
    proxyType: "pac",
    rules: [
      {
        condition: "example.com",
        profileID: "direct",
        type: "domain",
      },
      {
        condition: "http://example.com/api/*",
        profileID: "direct",
        type: "url",
      },
    ],
  },
  "ac8eeebe-3a13-4969-881c-3c7419e91f95": {
    color: "#93BEFF",
    defaultProfileID: "direct",
    pacScript: {
      data: "function FindProxyForURL(url, host) {\n  // …\n  return 'DIRECT';\n}",
    },
    profileID: "ac8eeebe-3a13-4969-881c-3c7419e91f95",
    profileName: "HTTP",
    proxyRules: {
      bypassList: ["<local>", "127.0.0.1", "[::1]"],
      default: {
        host: "localhost",
        port: 8080,
        scheme: "http",
      },
    },
    proxyType: "proxy",
    rules: [
      {
        condition: "example.com",
        profileID: "direct",
        type: "domain",
      },
      {
        condition: "http://example.com/api/*",
        profileID: "direct",
        type: "url",
      },
    ],
  },
  "bd4a7580-2c03-4465-acae-bde628ffbb16": {
    color: "#FBB0A7",
    defaultProfileID: "direct",
    pacScript: {
      data: "function FindProxyForURL(url, host) {\n  // …\n  return 'DIRECT';\n}",
    },
    profileID: "bd4a7580-2c03-4465-acae-bde628ffbb16",
    profileName: "HTTP (with Auth)",
    proxyRules: {
      bypassList: ["<local>", "127.0.0.1", "[::1]"],
      default: {
        auth: {
          password: "securepassword",
          username: "admin",
        },
        host: "127.0.0.1",
        port: 8080,
        scheme: "http",
      },
    },
    proxyType: "proxy",
    rules: [
      {
        condition: "example.com",
        profileID: "direct",
        type: "domain",
      },
      {
        condition: "http://example.com/api/*",
        profileID: "direct",
        type: "url",
      },
    ],
  },
  "fb29f908-a284-4dca-b7e5-c606e6b3c2f1": {
    color: "#3491FA",
    defaultProfileID: "direct",
    pacScript: {
      data: "function FindProxyForURL(url, host) {\n  // …\n  return 'DIRECT';\n}",
    },
    profileID: "fb29f908-a284-4dca-b7e5-c606e6b3c2f1",
    profileName: "Auto Switch",
    proxyRules: {
      bypassList: ["<local>", "127.0.0.1", "[::1]"],
      default: {
        host: "127.0.0.1",
        port: 8080,
        scheme: "http",
      },
    },
    proxyType: "auto",
    rules: [
      {
        condition: "example.com",
        profileID: "direct",
        type: "domain",
      },
      {
        condition: "http://example.com/api/*",
        profileID: "ac8eeebe-3a13-4969-881c-3c7419e91f95",
        type: "url",
      },
    ],
  },
};

const mockExportedJSON = `{
  "version": "2025-01",
  "profiles": [
    {
      "color": "#DCF190",
      "profileID": "90750184-fb8f-4130-ad83-c997a7207300",
      "profileName": "PAC Script",
      "pacScript": {
        "data": "function FindProxyForURL(url, host) {\\n  // …\\n  return 'DIRECT';\\n}"
      },
      "proxyType": "pac"
    },
    {
      "color": "#93BEFF",
      "profileID": "ac8eeebe-3a13-4969-881c-3c7419e91f95",
      "profileName": "HTTP",
      "proxyRules": {
        "bypassList": [
          "<local>",
          "127.0.0.1",
          "[::1]"
        ],
        "default": {
          "host": "localhost",
          "scheme": "http",
          "port": 8080
        }
      },
      "proxyType": "proxy"
    },
    {
      "color": "#FBB0A7",
      "profileID": "bd4a7580-2c03-4465-acae-bde628ffbb16",
      "profileName": "HTTP (with Auth)",
      "proxyRules": {
        "bypassList": [
          "<local>",
          "127.0.0.1",
          "[::1]"
        ],
        "default": {
          "host": "127.0.0.1",
          "scheme": "http",
          "port": 8080,
          "auth": {
            "username": "admin",
            "password": "securepassword"
          }
        }
      },
      "proxyType": "proxy"
    },
    {
      "color": "#3491FA",
      "profileID": "fb29f908-a284-4dca-b7e5-c606e6b3c2f1",
      "profileName": "Auto Switch",
      "defaultProfileID": "direct",
      "proxyType": "auto",
      "rules": [
        {
          "type": "domain",
          "condition": "example.com",
          "profileID": "direct"
        },
        {
          "type": "url",
          "condition": "http://example.com/api/*",
          "profileID": "ac8eeebe-3a13-4969-881c-3c7419e91f95"
        }
      ]
    }
  ]
}`;

describe("testing exporting config", () => {
  test("export JSON config", async () => {
    const schema = config2json(mockInnerConfig);

    expect(schema).toEqual(mockExportedJSON);
  });
});
