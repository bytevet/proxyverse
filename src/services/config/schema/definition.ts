import * as t from "io-ts";
import { pipe } from "fp-ts/function";
import { fold } from "fp-ts/Either";

export const getPaths = <A>(v: t.Validation<A>): Array<string> => {
  let lastActual: any;
  return pipe(
    v,
    fold(
      (errors) =>
        errors.map((error) =>
          error.context
            .map((ctx) => {
              if (ctx.actual === lastActual) {
                return;
              }

              lastActual = ctx.actual;
              return ctx.key;
            })
            .filter((x) => x !== undefined)
            .join(".")
        ),
      () => ["no errors"]
    )
  );
};

// branded types
export type Port = t.Branded<number, { readonly Port: unique symbol }>;
export const Port = t.brand(
  t.number,
  (n): n is Port => n >= 0 && n <= 65535,
  "Port"
);

export type HexedColor = t.Branded<
  string,
  { readonly HexedColor: unique symbol }
>;
export const HexedColor = t.brand(
  t.string,
  (s): s is HexedColor => /^#([0-9a-f]{6}|[0-9a-f]{3,4})$/i.test(s),
  "HexedColor"
);

// start of the config
const PacScript = t.strict({
  data: t.string,
});

export const ProxyServer = t.intersection([
  t.strict({
    scheme: t.keyof({
      direct: null,
      http: null,
      https: null,
      socks4: null,
      socks5: null,
    }),
    host: t.string,
  }),
  t.partial({
    auth: t.strict({
      username: t.string,
      password: t.string,
    }),
    port: Port,
  }),
]);

export type ProxyServer = t.TypeOf<typeof ProxyServer>;

const ProxyConfigMeta = t.strict({
  profileID: t.string,
  color: HexedColor,
  profileName: t.string,
});

// start of the definition of Simple Proxy
const ProxyConfigSimplePACScript = t.strict({
  proxyType: t.literal("pac"),
  pacScript: PacScript,
});

const ProxyConfigSimpleProxyRule = t.strict({
  proxyType: t.literal("proxy"),
  proxyRules: t.intersection([
    t.strict({
      default: ProxyServer,
      bypassList: t.array(t.string),
    }),
    t.partial({
      http: ProxyServer,
      https: ProxyServer,
      ftp: ProxyServer,
    }),
  ]),
});

const ProxyConfigSimple = t.union([
  ProxyConfigSimplePACScript,
  ProxyConfigSimpleProxyRule,
]);

// start of the definition of AutoSwitch
const ProxyConfigAutoSwitch = t.strict({
  proxyType: t.literal("auto"),
  rules: t.array(
    t.strict({
      type: t.keyof({
        domain: null,
        cidr: null,
        url: null,
        disabled: null,
      }),
      condition: t.string,
      profileID: t.string,
    })
  ),
  defaultProfileID: t.string,
});

export const ProfileSimple = t.intersection([
  ProxyConfigMeta,
  ProxyConfigSimple,
]);
export type ProfileSimple = t.TypeOf<typeof ProfileSimple>;

export const ProfileAuthSwitch = t.intersection([
  ProxyConfigMeta,
  ProxyConfigAutoSwitch,
]);
export type ProfileAuthSwitch = t.TypeOf<typeof ProfileAuthSwitch>;

// no preset profiles when conducting import & export
export const ProxyProfile = t.union([ProfileSimple, ProfileAuthSwitch]);
export type ProxyProfile = t.TypeOf<typeof ProxyProfile>;

export const ConfigFile = t.strict({
  version: t.literal("2025-01"),
  profiles: t.array(ProxyProfile),
});
