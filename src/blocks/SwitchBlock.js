// switch(対象):case("値"){ ... } case("値"){ ... } default{ ... } を担当する。
const { skipWs, matchKeyword, findMatchingParen, findMatchingBrace } = require('./BraceUtils');

// text[pos] が "switch" で始まっている前提で解析する。
function parse(text, pos, parseStatements) {
  const afterSwitch = matchKeyword(text, pos, 'switch');
  if (afterSwitch === -1) return null;

  const parenOpen = skipWs(text, afterSwitch);
  if (text[parenOpen] !== '(') return null;
  const parenClose = findMatchingParen(text, parenOpen);
  if (parenClose === -1) return null;
  const target = text.slice(parenOpen + 1, parenClose);

  let cursor = skipWs(text, parenClose + 1);
  if (text[cursor] !== ':') return null;
  cursor = skipWs(text, cursor + 1);

  const cases = [];

  // 1つ目の case はヘッダーに融合されている: switch(target):case("value"){...}
  const first = parseCase(text, cursor, parseStatements);
  if (!first) return null;
  cases.push(first.caseNode);
  cursor = first.endIndex;

  // 続く case を読み続ける
  while (true) {
    const afterWs = skipWs(text, cursor);
    const next = parseCase(text, afterWs, parseStatements);
    if (!next) break;
    cases.push(next.caseNode);
    cursor = next.endIndex;
  }

  // default{...} があれば読む
  let defaultBody = null;
  const afterWs2 = skipWs(text, cursor);
  const defaultStart = matchKeyword(text, afterWs2, 'default');
  if (defaultStart !== -1) {
    const braceOpen = skipWs(text, defaultStart);
    if (text[braceOpen] === '{') {
      const braceClose = findMatchingBrace(text, braceOpen);
      if (braceClose !== -1) {
        defaultBody = parseStatements(text.slice(braceOpen + 1, braceClose));
        cursor = braceClose + 1;
      }
    }
  }

  return { node: { type: 'switch', target, cases, defaultBody }, endIndex: cursor };
}

// "case("値"){ 本体 }" を1つ読む。
function parseCase(text, pos, parseStatements) {
  const afterCase = matchKeyword(text, pos, 'case');
  if (afterCase === -1) return null;

  const parenOpen = skipWs(text, afterCase);
  if (text[parenOpen] !== '(') return null;
  const parenClose = findMatchingParen(text, parenOpen);
  if (parenClose === -1) return null;
  const rawValue = text.slice(parenOpen + 1, parenClose).trim();
  // 値は "文字列" の形を想定。クォートを外しておく。
  const value = rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;

  const braceOpen = skipWs(text, parenClose + 1);
  if (text[braceOpen] !== '{') return null;
  const braceClose = findMatchingBrace(text, braceOpen);
  if (braceClose === -1) return null;

  const body = parseStatements(text.slice(braceOpen + 1, braceClose));
  return { caseNode: { value, body }, endIndex: braceClose + 1 };
}

// AST(switch)ノードを実行する。targetを評価した結果と一致するcaseのbodyを実行し、
// どれとも一致しなければdefaultBody（あれば）を実行する。
function run(node, ctx, runStatements) {
  const { hostScope, disScope, evaluator, strict } = ctx;
  let targetValue;
  try {
    targetValue = evaluator.evaluateExpression(node.target, hostScope, disScope, !!strict);
  } catch {
    targetValue = undefined;
  }

  for (const c of node.cases) {
    if (String(targetValue) === c.value) {
      return runStatements(c.body, ctx);
    }
  }
  if (node.defaultBody) {
    return runStatements(node.defaultBody, ctx);
  }
  return '';
}

module.exports = { parse, run };
