// while(条件):true { ... } を担当する。
const { skipWs, matchKeyword, findMatchingParen, findMatchingBrace } = require('./BraceUtils');

// 安全装置: DeskScriptのwhileには「条件を再評価するたびに状態が変わる」仕組みがなく、
// `while(1 < 2):true` のように恒久的に真となる条件も書けてしまう。
// 実行がハングしないよう、最大繰り返し回数に上限を設ける。
const MAX_ITERATIONS = 5;

function parse(text, pos, parseStatements) {
  const afterWhile = matchKeyword(text, pos, 'while');
  if (afterWhile === -1) return null;

  const parenOpen = skipWs(text, afterWhile);
  if (text[parenOpen] !== '(') return null;
  const parenClose = findMatchingParen(text, parenOpen);
  if (parenClose === -1) return null;
  const condition = text.slice(parenOpen + 1, parenClose);

  let cursor = skipWs(text, parenClose + 1);
  if (text[cursor] !== ':') return null;
  cursor = skipWs(text, cursor + 1);
  const afterTrue = matchKeyword(text, cursor, 'true');
  if (afterTrue === -1) return null;

  const braceOpen = skipWs(text, afterTrue);
  if (text[braceOpen] !== '{') return null;
  const braceClose = findMatchingBrace(text, braceOpen);
  if (braceClose === -1) return null;

  const body = parseStatements(text.slice(braceOpen + 1, braceClose));
  return { node: { type: 'while', condition, body }, endIndex: braceClose + 1 };
}

function run(node, ctx, runStatements) {
  const { hostScope, disScope, evaluator, strict } = ctx;
  let output = '';
  let count = 0;

  while (count < MAX_ITERATIONS) {
    let condResult;
    try {
      condResult = evaluator.evaluateExpression(node.condition, hostScope, disScope, !!strict);
    } catch {
      break;
    }
    if (!condResult) break;
    output += runStatements(node.body, ctx);
    count++;
  }

  if (count >= MAX_ITERATIONS) {
    output += `\n[DeskScript Warning]: while条件が${MAX_ITERATIONS}回を超えて真のままだったため、安全のため打ち切りました。\n`;
  }

  return output;
}

module.exports = { parse, run, MAX_ITERATIONS };
