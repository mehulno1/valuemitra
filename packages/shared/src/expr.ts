// A small, safe expression language for configuration: field derivations, check conditions
// and wording templates. No access to JS globals; only whitelisted functions.
//
//   AREA.BUA / (1 + RULE.loading_pct / 100)
//   abs(VAL.FMV - VAL.GUIDELINE) / VAL.GUIDELINE >= RULE.gv_variation_pct / 100
//   "We have not been provided with {{ join(DOC.NOT_RECEIVED, ', ') }}"
//
// Missing identifiers evaluate to null; arithmetic on null yields null, so a derived value
// stays "pending" until all of its inputs exist.

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' };

const OPS = ['&&', '||', '==', '!=', '<=', '>=', '??', '+', '-', '*', '/', '%', '<', '>', '!', '(', ')', ',', '?', ':', '[', ']'];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j++;
      out.push({ t: 'num', v: Number(src.slice(i, j).replace(/_/g, '')) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
        s += src[j++];
      }
      if (j >= src.length) throw new ExprError('Unterminated string');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j).replace(/\.$/, '') });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected character "${c}"`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  out.push({ t: 'eof' });
  return out;
}

export class ExprError extends Error {}

export type Node =
  | { k: 'lit'; v: unknown }
  | { k: 'id'; name: string }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'cond'; c: Node; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] }
  | { k: 'list'; items: Node[] };

const PREC: Record<string, number> = { '??': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7 };

export function parse(src: string): Node {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = peek(); return t.t === 'op' && t.v === v; };
  const expect = (v: string) => { if (!isOp(v)) throw new ExprError(`Expected "${v}"`); p++; };

  function primary(): Node {
    const t = toks[p++];
    if (t.t === 'num' || t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'id') {
      if (t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (isOp('(')) {
        p++;
        const args: Node[] = [];
        if (!isOp(')')) { do { args.push(expr()); } while (isOp(',') && ++p); }
        expect(')');
        return { k: 'call', fn: t.v, args };
      }
      return { k: 'id', name: t.v };
    }
    if (t.t === 'op' && t.v === '(') { const e = expr(); expect(')'); return e; }
    if (t.t === 'op' && t.v === '[') {
      const items: Node[] = [];
      if (!isOp(']')) { do { items.push(expr()); } while (isOp(',') && ++p); }
      expect(']');
      return { k: 'list', items };
    }
    if (t.t === 'op' && (t.v === '-' || t.v === '!')) return { k: 'un', op: t.v, a: unary() };
    throw new ExprError('Unexpected token');
  }
  function unary(): Node { return primary(); }
  function binary(minPrec: number): Node {
    let a = unary();
    for (;;) {
      const t = peek();
      if (t.t !== 'op' || !(t.v in PREC) || PREC[t.v] < minPrec) return a;
      p++;
      const b = binary(PREC[t.v] + 1);
      a = { k: 'bin', op: t.v, a, b };
    }
  }
  function expr(): Node {
    const c = binary(1);
    if (isOp('?')) { p++; const a = expr(); expect(':'); const b = expr(); return { k: 'cond', c, a, b }; }
    return c;
  }
  const n = expr();
  if (peek().t !== 'eof') throw new ExprError('Unexpected trailing input');
  return n;
}

export type Resolver = (name: string) => unknown;

// Strings count as numbers only when they are numbers ("12,800", "Rs. 59,60,000/-", "465 sq.ft."),
// never when they are words.
const num = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '' || typeof x === 'boolean') return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).replace(/^\s*rs\.?\s*/i, '').replace(/\/-\s*$/, '').replace(/\s*sq\.?\s*(ft|m)\.?\s*$/i, '').replace(/,/g, '').trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};
const present = (x: unknown) => !(x === null || x === undefined || x === '' || (Array.isArray(x) && x.length === 0));

const FUNCS: Record<string, (...a: unknown[]) => unknown> = {
  abs: (x) => (num(x) === null ? null : Math.abs(num(x)!)),
  round: (x, step) => { const n = num(x); if (n === null) return null; const s = num(step) ?? 1; return Math.round(n / s) * s; },
  floor: (x, step) => { const n = num(x); if (n === null) return null; const s = num(step) ?? 1; return Math.floor(n / s) * s; },
  ceil: (x, step) => { const n = num(x); if (n === null) return null; const s = num(step) ?? 1; return Math.ceil(n / s) * s; },
  min: (...a) => { const v = a.map(num).filter((n): n is number => n !== null); return v.length ? Math.min(...v) : null; },
  max: (...a) => { const v = a.map(num).filter((n): n is number => n !== null); return v.length ? Math.max(...v) : null; },
  num: (x) => num(x),
  coalesce: (...a) => a.find(present) ?? null,
  present: (x) => present(x),
  len: (x) => (Array.isArray(x) ? x.length : typeof x === 'string' ? x.length : 0),
  join: (x, sep) => (Array.isArray(x) ? x.filter(present).join(String(sep ?? ', ')) : x ?? null),
  contains: (x, y) => (Array.isArray(x) ? x.includes(y) : typeof x === 'string' ? x.toLowerCase().includes(String(y).toLowerCase()) : false),
  upper: (x) => (x === null || x === undefined ? null : String(x).toUpperCase()),
  lower: (x) => (x === null || x === undefined ? null : String(x).toLowerCase()),
  concat: (...a) => (a.some((x) => !present(x)) ? null : a.map(String).join('')),
  text: (...a) => a.filter(present).map(String).join(''),
  pct: (x) => (num(x) === null ? null : `${Math.round(Math.abs(num(x)!) * 100)}%`),
  ifelse: (c, a, b) => (c ? a : b),
  inr: (x) => { const n = num(x); if (n === null) return null; return formatInr(n); },
};

function formatInr(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return (n < 0 ? '-' : '') + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3);
}

export function evaluate(node: Node, resolve: Resolver, extraFns: Record<string, (...a: unknown[]) => unknown> = {}): unknown {
  const ev = (n: Node): unknown => {
    switch (n.k) {
      case 'lit': return n.v;
      case 'id': { const v = resolve(n.name); return v === undefined ? null : v; }
      case 'list': return n.items.map(ev);
      case 'un': { const a = ev(n.a); return n.op === '!' ? !a : num(a) === null ? null : -num(a)!; }
      case 'cond': return ev(n.c) ? ev(n.a) : ev(n.b);
      case 'call': {
        const f = extraFns[n.fn] ?? FUNCS[n.fn];
        if (!f) throw new ExprError(`Unknown function ${n.fn}()`);
        return f(...n.args.map(ev));
      }
      case 'bin': {
        if (n.op === '&&') return ev(n.a) ? ev(n.b) : false;
        if (n.op === '||') { const a = ev(n.a); return a ? a : ev(n.b); }
        if (n.op === '??') { const a = ev(n.a); return present(a) ? a : ev(n.b); }
        const a = ev(n.a);
        const b = ev(n.b);
        if (n.op === '==') return a == b; // eslint-disable-line eqeqeq
        if (n.op === '!=') return a != b; // eslint-disable-line eqeqeq
        // "+" adds only when both sides are numbers; otherwise it joins text
        if (n.op === '+' && (typeof a === 'string' || typeof b === 'string') && (num(a) === null || num(b) === null)) {
          return a === null || b === null ? null : String(a) + String(b);
        }
        const x = num(a);
        const y = num(b);
        if (x === null || y === null) return n.op === '<' || n.op === '>' || n.op === '<=' || n.op === '>=' ? false : null;
        switch (n.op) {
          case '+': return x + y;
          case '-': return x - y;
          case '*': return x * y;
          case '/': return y === 0 ? null : x / y;
          case '%': return y === 0 ? null : x % y;
          case '<': return x < y;
          case '>': return x > y;
          case '<=': return x <= y;
          case '>=': return x >= y;
        }
      }
    }
    return null;
  };
  return ev(node);
}

const cache = new Map<string, Node>();
export function evalExpr(src: string, resolve: Resolver, extraFns?: Record<string, (...a: unknown[]) => unknown>): unknown {
  let n = cache.get(src);
  if (!n) { n = parse(src); cache.set(src, n); }
  return evaluate(n, resolve, extraFns);
}

/** Identifiers referenced by an expression (used to build dependency graphs and pending reasons). */
export function identifiers(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === 'id') out.add(n.name);
    else if (n.k === 'un') walk(n.a);
    else if (n.k === 'bin') { walk(n.a); walk(n.b); }
    else if (n.k === 'cond') { walk(n.c); walk(n.a); walk(n.b); }
    else if (n.k === 'call') n.args.forEach(walk);
    else if (n.k === 'list') n.items.forEach(walk);
  };
  walk(parse(src));
  return [...out];
}

/** Interpolate {{ expr }} blocks inside wording text. Returns null if any block is null (pending). */
export function interpolate(text: string, resolve: Resolver, opts: { allowMissing?: boolean } = {}): string | null {
  let missing = false;
  const out = text.replace(/\{\{([\s\S]+?)\}\}/g, (_, e: string) => {
    const v = evalExpr(e.trim(), resolve);
    if (!present(v)) { missing = true; return ''; }
    return Array.isArray(v) ? v.join(', ') : String(v);
  });
  return missing && !opts.allowMissing ? null : out;
}

export function templateIdentifiers(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/\{\{([\s\S]+?)\}\}/g)) identifiers(m[1].trim()).forEach((i) => ids.add(i));
  return [...ids];
}
