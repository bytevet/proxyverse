/**
 * Translating SwitchyOmega's host regex conditions to shell expressions,
 * the patterns our domain rules match with `shExpMatch` (anchored, `*` = any
 * run, `?` = any one char). URL regexes need no translation: they map to
 * our `regex` rules.
 *
 * Only regexes with an exact equivalent are translated: literals, `.`,
 * `.*`, `.+`, optional parts and alternatives (expanded into several
 * patterns). Anything else (classes, `\d`, repeats of literals, lookarounds,
 * ...) returns undefined. The one approximation is an escaped `\?`, which
 * becomes the wildcard `?`: one char more permissive than a literal `?`.
 *
 * Output never contains `+()[]{}^$|\`: Firefox's `shExpMatch` builds a
 * regex escaping only `.`, so those would act as regex syntax there.
 */

/** The most patterns one regex may expand into. */
export const MAX_EXPANSION = 16;

// literal in a regex and safe in a shell expression on every browser
const SAFE_LITERAL = /[A-Za-z0-9\-_/:=&%~,;@!#'"<> `]/;
// escapes standing for a literal char (besides the ones above)
const SAFE_ESCAPE = /[.\-_/:=&%~,;@!#'"<> `?]/;

class Unsupported extends Error {}

/**
 * Shell expressions matching exactly what `new RegExp(re).test(s)` matches,
 * or undefined if `re` has no such translation.
 */
export function regexToWildcards(re: string): string[] | undefined {
  try {
    const patterns = new Parser(re).parseTop();
    return [...new Set(patterns.map((p) => p.replace(/\*+/g, "*")))];
  } catch (e) {
    if (e instanceof Unsupported) return;
    throw e;
  }
}

// Fragments are lists of alternative shell-expression strings.
const concat = (a: string[], b: string[]): string[] => {
  if (a.length * b.length > MAX_EXPANSION) throw new Unsupported();
  return a.flatMap((x) => b.map((y) => x + y));
};

class Parser {
  private pos = 0;
  constructor(private readonly src: string) {}

  private peek(offset = 0) {
    return this.src[this.pos + offset];
  }

  private get done() {
    return this.pos >= this.src.length;
  }

  /** Top level: alternatives, each unanchored unless it has `^` / `$`. */
  parseTop(): string[] {
    const ret: string[] = [];
    for (;;) {
      const anchoredStart = this.peek() === "^";
      if (anchoredStart) this.pos++;
      let seq = this.parseSeq(true);
      const anchoredEnd = this.peek() === "$";
      if (anchoredEnd) this.pos++;

      if (!anchoredStart) seq = seq.map((s) => "*" + s);
      if (!anchoredEnd) seq = seq.map((s) => s + "*");
      ret.push(...seq);
      if (ret.length > MAX_EXPANSION) throw new Unsupported();

      if (this.done) return ret;
      if (this.peek() !== "|") throw new Unsupported(); // stray `$`, `)`
      this.pos++;
    }
  }

  /** A group body: alternatives merged into one fragment. */
  private parseAlternation(): string[] {
    let ret = this.parseSeq(false);
    while (this.peek() === "|") {
      this.pos++;
      ret = ret.concat(this.parseSeq(false));
      if (ret.length > MAX_EXPANSION) throw new Unsupported();
    }
    return ret;
  }

  /** `$` may only end a top-level alternative. */
  private parseSeq(top: boolean): string[] {
    let ret = [""];
    while (!this.done && !"|)$".includes(this.peek())) {
      ret = concat(ret, this.parseQuantified());
    }
    if (this.peek() === "$") {
      const next = this.peek(1);
      if (!top || (next !== undefined && next !== "|")) {
        throw new Unsupported();
      }
    }
    return ret;
  }

  private parseQuantified(): string[] {
    const isDot = this.peek() === ".";
    const atom = this.parseAtom();
    const q = this.peek();
    if (q !== "?" && q !== "*" && q !== "+" && q !== "{") return atom;
    if (q === "{") throw new Unsupported();
    this.pos++;
    if (this.peek() === "?") this.pos++; // lazy: same set of matches

    if (q === "?") return ["", ...atom];
    if (!isDot) throw new Unsupported(); // repeats of anything but `.`
    return q === "*" ? ["*"] : ["?*"];
  }

  private parseAtom(): string[] {
    const c = this.peek();
    this.pos++;
    switch (c) {
      case ".":
        return ["?"];
      case "(": {
        if (this.peek() === "?") {
          if (this.peek(1) !== ":") throw new Unsupported(); // lookaround
          this.pos += 2;
        }
        const body = this.parseAlternation();
        if (this.peek() !== ")") throw new Unsupported();
        this.pos++;
        return body;
      }
      case "\\": {
        const e = this.peek();
        this.pos++;
        if (e !== undefined && SAFE_ESCAPE.test(e)) return [e];
        throw new Unsupported(); // \d, \b, backreferences, \*, \( ...
      }
      default:
        if (SAFE_LITERAL.test(c)) return [c];
        throw new Unsupported(); // `[`, `^` mid-pattern, `{`, ...
    }
  }
}
