import { parseScript } from "esprima";
import {
  AssignmentExpression,
  AssignmentOperator,
  CallExpression,
  Directive,
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
} from "estree";
import { ProxyServer } from "../profile";

export function parsePACScript(script: string): Statement[] {
  const program = parseScript(script);

  const ret: (Statement | Directive)[] = [];
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
  if (cfg.scheme == "direct") {
    return PACScriptHelper.newSimpleLiteral("DIRECT");
  }

  let host = cfg.host;
  if (cfg.port !== undefined) {
    host += `:${cfg.port}`;
  }

  if (["http", "https"].includes(cfg.scheme)) {
    return PACScriptHelper.newSimpleLiteral(
      `${cfg.scheme == "http" ? "PROXY" : "HTTPS"} ${host}`
    );
  }

  return PACScriptHelper.newSimpleLiteral(
    `${cfg.scheme.toUpperCase()} ${host}; SOCKS ${host}`
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
    };
  }
  static newExpressionStatement(expression: Expression): ExpressionStatement {
    return {
      type: "ExpressionStatement",
      expression,
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
        },
      ],
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
    };
  }

  static newObjectExpression(
    properties: Array<Property | SpreadElement>
  ): ObjectExpression {
    return {
      type: "ObjectExpression",
      properties,
    };
  }

  static newIdentifier(name: string): Identifier {
    return {
      type: "Identifier",
      name: name,
    };
  }

  static newSimpleLiteral(value: string | boolean | number | null): Literal {
    return {
      type: "Literal",
      value: value,
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
      },
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
      },
    };
  }

  static newReturnStatement(argument?: Expression): ReturnStatement {
    return {
      type: "ReturnStatement",
      argument,
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
      },
      alternate,
    };
  }
}
