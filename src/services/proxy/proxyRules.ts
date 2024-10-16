import { generate as generateJS } from "escodegen";
import {
  Program,
  FunctionDeclaration,
  Identifier,
  Statement,
  Literal,
  ReturnStatement,
  Expression,
  IfStatement,
  CallExpression,
  MemberExpression,
} from "estree";
import { IPv4, IPv6, isValidCIDR, parseCIDR } from "ipaddr.js";
import {
  ProxyConfigPreset,
  ProxyConfigSimple,
  ProxyServer,
  sanitizeProxyServer,
} from "../profile";
import { ProxyConfig, ProxyRules } from "@/adapters";

export function genSimpleProxyCfg(
  val: ProxyConfigSimple | ProxyConfigPreset
): ProxyConfig {
  switch (val.proxyType) {
    case "direct":
    case "system":
      return { mode: val.proxyType };

    case "pac":
      return {
        mode: "pac_script",
        pacScript: val.pacScript,
      };

    case "proxy":
      if (containsDirectRules(val)) {
        // @ts-ignore
        return genComplexRuleForProfile(val);
      }
      return genFixServerRuleForProfile(val);
  }

  // this case should never be happen
  console.error("unexpected proxy profile:", val);
  return { mode: "system" };
}

function genFixServerRuleForProfile(val: ProxyConfigSimple): ProxyConfig {
  const rules = val.proxyRules;
  const ret: ProxyConfig & { rules: ProxyRules } = {
    mode: "fixed_servers",
    rules: {
      bypassList: rules.bypassList,
    },
  };

  // simple proxy
  if (!rules.ftp && !rules.http && !rules.https) {
    ret.rules.singleProxy = sanitizeProxyServer(rules.default);
    return ret;
  }

  // advanced setting
  ret.rules.fallbackProxy = sanitizeProxyServer(rules.default);
  if (rules.ftp) ret.rules.proxyForFtp = sanitizeProxyServer(rules.ftp);
  if (rules.http) ret.rules.proxyForHttp = sanitizeProxyServer(rules.http);
  if (rules.https) ret.rules.proxyForHttps = sanitizeProxyServer(rules.https);

  return ret;
}

function containsDirectRules(val: ProxyConfigSimple): boolean {
  return [
    val.proxyRules.default.scheme,
    val.proxyRules.ftp?.scheme,
    val.proxyRules.http?.scheme,
    val.proxyRules.https?.scheme,
  ].includes("direct");
}

function allDirectRules(val: ProxyConfigSimple): boolean {
  return [
    val.proxyRules.default.scheme,
    val.proxyRules.ftp?.scheme,
    val.proxyRules.http?.scheme,
    val.proxyRules.https?.scheme,
  ].every((val) => val === "direct" || val === undefined);
}

function genComplexRuleForProfile(
  val: ProxyConfigSimple & { proxyType: "proxy" }
): ProxyConfig {
  if (allDirectRules(val)) {
    return {
      mode: "direct",
    };
  }

  return {
    mode: "pac_script",
    pacScript: {
      data: new SimplePacScriptForProfile().gen(val),
    },
  };
}

class SimplePacScriptForProfile<
  T extends ProxyConfigSimple & { proxyType: "proxy" }
> {
  private newIdentifier(name: string): Identifier {
    return {
      type: "Identifier",
      name: name,
    };
  }
  private newSimpleLiteral(value: string | boolean | number | null): Literal {
    return {
      type: "Literal",
      value: value,
    };
  }

  private newFunctionDeclartion(
    name: string,
    params: string[],
    body: Statement[]
  ): FunctionDeclaration {
    return {
      type: "FunctionDeclaration",
      id: this.newIdentifier(name),
      params: params.map((v) => this.newIdentifier(v)),
      body: {
        type: "BlockStatement",
        body: body,
      },
    };
  }

  private newReturnStatment(argument?: Expression): ReturnStatement {
    return {
      type: "ReturnStatement",
      argument,
    };
  }

  private newMemberExpression(
    object: Expression,
    property: Expression
  ): MemberExpression {
    return {
      type: "MemberExpression",
      object,
      property,
      computed: false,
      optional: false,
    };
  }

  private newCallExpression(
    callee: Expression,
    _arguments: Expression[]
  ): CallExpression {
    return {
      type: "CallExpression",
      optional: false,
      callee,
      arguments: _arguments,
    };
  }

  private newIfStatement(
    test: Expression,
    consequent: Statement[],
    alternate?: Statement | null
  ): IfStatement {
    return {
      type: "IfStatement",
      test: test,
      consequent: {
        type: "BlockStatement",
        body: consequent,
      },
      alternate,
    };
  }

  newProxyString(cfg: ProxyServer): Literal {
    if (cfg.scheme == "direct") {
      return this.newSimpleLiteral("DIRECT");
    }

    let host = cfg.host;
    if (cfg.port !== undefined) {
      host += `:${cfg.port}`;
    }

    if (["http", "https"].includes(cfg.scheme)) {
      return this.newSimpleLiteral(
        `${cfg.scheme == "http" ? "PROXY" : "HTTPS"} ${host}`
      );
    }

    return this.newSimpleLiteral(
      `${cfg.scheme.toUpperCase()} ${host}; SOCKS ${host}`
    );
  }

  private genAdvancedRules(val: T) {
    const ret = [];

    type KeyVal = "ftp" | "https" | "http";
    const keys: KeyVal[] = ["ftp", "https", "http"];
    const rules = val.proxyRules as Record<KeyVal, ProxyServer | undefined>;
    for (let item of keys) {
      const cfg = rules[item];
      if (!cfg) {
        continue;
      }

      ret.push(
        this.newIfStatement(
          this.newCallExpression(
            this.newMemberExpression(
              this.newIdentifier("url"),
              this.newIdentifier("startsWith")
            ),
            [this.newSimpleLiteral(`${item}:`)]
          ),
          [this.newReturnStatment(this.newProxyString(cfg))]
        )
      );
    }
    return ret;
  }

  private genBypassList(val: T) {
    const directExpr = this.newReturnStatment(this.newSimpleLiteral("DIRECT"));
    return val.proxyRules.bypassList.map((item) => {
      if (item == "<local>") {
        return this.newIfStatement(
          this.newCallExpression(this.newIdentifier("isPlainHostName"), [
            this.newIdentifier("host"),
          ]),
          [directExpr]
        );
      }

      // if it's a CIDR
      if (isValidCIDR(item)) {
        try {
          const [ip, maskPrefixLen] = parseCIDR(item);
          let mask = (
            ip.kind() == "ipv4" ? IPv4 : IPv6
          ).subnetMaskFromPrefixLength(maskPrefixLen);

          return this.newIfStatement(
            this.newCallExpression(this.newIdentifier("isInNet"), [
              this.newIdentifier("host"),
              this.newSimpleLiteral(ip.toString()),
              this.newSimpleLiteral(mask.toNormalizedString()),
            ]),
            [directExpr]
          );
        } catch (e) {
          console.error(e);
        }
      }

      return this.newIfStatement(
        this.newCallExpression(this.newIdentifier("shExpMatch"), [
          this.newIdentifier("host"),
          this.newSimpleLiteral(item),
        ]),
        [directExpr]
      );
    });
  }

  gen(val: T) {
    const astFindProxyForURL = this.newFunctionDeclartion(
      "FindProxyForURL",
      ["url", "host"],
      [
        ...this.genBypassList(val),
        ...this.genAdvancedRules(val),
        this.newReturnStatment(this.newProxyString(val.proxyRules.default)),
      ]
    );

    const astProgram: Program = {
      type: "Program",
      sourceType: "script",
      body: [astFindProxyForURL],
    };

    return generateJS(astProgram);
  }
}
