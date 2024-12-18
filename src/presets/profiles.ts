import { ProfileSimple } from "@/services/profile";

export const PRESET_PROFILES: ProfileSimple[] = [
  {
    profileID: "abcdefg",
    color: "blue",
    profileName: "abc",
    proxyType: "proxy",
    proxyRules: {
      default: {
        host: "proxyA.io",
        scheme: "https",
        port: 5555,
      },
      bypassList: [],
    },
    pacScript: {},
  },
  {
    profileID: "cdfghij",
    color: "blue",
    profileName: "def",
    proxyType: "proxy",
    proxyRules: {
      default: {
        host: "proxyB.io",
        scheme: "http",
        port: 4555,
      },
      bypassList: [],
    },
    pacScript: {},
  },
];
