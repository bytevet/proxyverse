import { parse } from "espree";
import type {
  AssignmentExpression,
  AssignmentOperator,
  CallExpression,
  Expression,
  ExpressionStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  IfStatement,
  Literal,
  LogicalExpression,
  MemberExpression,
  ObjectExpression,
  Pattern,
  Property,
  ReturnStatement,
  SpreadElement,
  Statement,
  VariableDeclaration,
} from "acorn";
import { ProxyServer } from "../profile";

export function parsePACScript(script: string): Statement[] {
  const program = parse(script);

  const ret: Statement[] = [];
  for (const stmt of program.body) {
    switch (stmt.type) {
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
      case "ExportAllDeclaration":
        throw new Error(`${stmt.type} is not allowed in PAC script"`);
    }
    ret.push(stmt);
  }
  return ret;
}

export const newProxyString = (cfg: ProxyServer) => {
  const scheme = cfg.scheme || "http";
  if (scheme == "direct") {
    return PACScriptHelper.newSimpleLiteral("DIRECT");
  }

  let host = cfg.host;
  if (cfg.port !== undefined) {
    host += `:${cfg.port}`;
  }

  if (["http", "https"].includes(scheme)) {
    return PACScriptHelper.newSimpleLiteral(
      `${cfg.scheme == "http" ? "PROXY" : "HTTPS"} ${host}`
    );
  }

  return PACScriptHelper.newSimpleLiteral(
    `${scheme.toUpperCase()} ${host}; SOCKS ${host}`
  );
};

export class PACScriptHelper {
  static newAssignmentExpression(
    operator: AssignmentOperator,
    left: Pattern | MemberExpression,
    right: Expression
  ): AssignmentExpression {
    return {
      type: "AssignmentExpression",
      operator,
      left,
      right,
      start: 0, // dummy
      end: 0, // dummy
    };
  }
  static newExpressionStatement(expression: Expression): ExpressionStatement {
    return {
      type: "ExpressionStatement",
      expression,
      start: 0, // dummy
      end: 0, // dummy
    };
  }
  static newVariableDeclaration(
    name: string,
    init?: Expression
  ): VariableDeclaration {
    return {
      type: "VariableDeclaration",
      kind: "var",
      declarations: [
        {
          type: "VariableDeclarator",
          id: this.newIdentifier(name),
          init: init,
          start: 0, // dummy
          end: 0, // dummy
        },
      ],
      start: 0, // dummy
      end: 0, // dummy
    };
  }

  static newLogicalExpression(
    operator: "||" | "&&",
    left: Expression,
    right: Expression
  ): LogicalExpression {
    return {
      type: "LogicalExpression",
      operator,
      left,
      right,
      start: 0, // dummy
      end: 0, // dummy
    };
  }

  static newObjectExpression(
    properties: Array<Property | SpreadElement>
  ): ObjectExpression {
    return {
      type: "ObjectExpression",
      properties,
      start: 0, // dummy
      end: 0, // dummy
    };
  }

  static newIdentifier(name: string): Identifier {
    return {
      type: "Identifier",
      name: name,
      start: 0, // dummy
      end: 0, // dummy
    };
  }

  static newSimpleLiteral(value: string | boolean | number | null): Literal {
    return {
      type: "Literal",
      value: value,
      start: 0, // dummy
      end: 0, // dummy
    };
  }

  static newFunctionDeclaration(
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
        start: 0, // dummy
        end: 0, // dummy
      },
      generator: false,
      expression: false,
      async: false,
      start: 0, // dummy
      end: 0, // dummy
    };
  }

  static newFunctionExpression(
    params: string[],
    body: Statement[]
  ): FunctionExpression {
    return {
      type: "FunctionExpression",
      params: params.map((v) => this.newIdentifier(v)),
      body: {
        type: "BlockStatement",
        body: body,
        start: 0, // dummy
        end: 0, // dummy
      },
      generator: false,
      expression: false,
      async: false,
      start: 0, // dummy
      end: 0, // dummy
    };
  }

  static newReturnStatement(argument?: Expression): ReturnStatement {
    return {
      type: "ReturnStatement",
      argument,
      start: 0, // dummy
      end: 0, // dummy
    };
  }

  static newMemberExpression(
    object: Expression,
    property: Expression,
    computed: boolean = false
  ): MemberExpression {
    return {
      type: "MemberExpression",
      object,
      property,
      computed,
      optional: false,
      start: 0, // dummy
      end: 0, // dummy
    };
  }

  static newCallExpression(
    callee: Expression,
    _arguments: Expression[]
  ): CallExpression {
    return {
      type: "CallExpression",
      optional: false,
      callee,
      arguments: _arguments,
      start: 0, // dummy
      end: 0, // dummy
    };
  }

  static newIfStatement(
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
        start: 0, // dummy
        end: 0, // dummy
      },
      alternate,
      start: 0, // dummy
      end: 0, // dummy
    };
  }
}
