// for(dis.var:変数名 in 増減式):回数 { ... } end { ... } を担当する。
const { skipWs, matchKeyword, findMatchingParen, findMatchingBrace } = require('./BraceUtils');

function parse(text, pos, parseStatements) {
  const afterFor = matchKeyword(text, pos, 'for');
  if (afterFor === -1) return null;

  const parenOpen = skipWs(text, afterFor);
  if (text[parenOpen] !== '(') return null;
  const parenClose = findMatchingParen(text, parenOpen);
  if (parenClose === -1) return null;
  const header = text.slice(parenOpen + 1, parenClose);

  const headerMatch = header.match(/dis\.var\s*:\s*(\w+)\s+in\s+([+\-]+\d+)/);
  if (!headerMatch) return null;
  const varName = headerMatch[1];
  const stepExpr = headerMatch[2];

  let cursor = skipWs(text, parenClose + 1);
  if (text[cursor] !== ':') return null;
  cursor = skipWs(text, cursor + 1);
  const countMatch = text.slice(cursor).match(/^\d+/);
  if (!countMatch) return null;
  const maxLoops = parseInt(countMatch[0], 10);
  cursor += countMatch[0].length;

  const bodyBraceOpen = skipWs(text, cursor);
  if (text[bodyBraceOpen] !== '{') return null;
  const bodyBraceClose = findMatchingBrace(text, bodyBraceOpen);
  if (bodyBraceClose === -1) return null;
  const body = parseStatements(text.slice(bodyBraceOpen + 1, bodyBraceClose));

  cursor = skipWs(text, bodyBraceClose + 1);
  const afterEnd = matchKeyword(text, cursor, 'end');
  if (afterEnd === -1) return null;

  const endBraceOpen = skipWs(text, afterEnd);
  if (text[endBraceOpen] !== '{') return null;
  const endBraceClose = findMatchingBrace(text, endBraceOpen);
  if (endBraceClose === -1) return null;
  const endBody = parseStatements(text.slice(endBraceOpen + 1, endBraceClose));

  return {
    node: { type: 'for', varName, stepExpr, maxLoops, body, endBody },
    endIndex: endBraceClose + 1,
  };
}

// AST(for)ノードを実行する。ループを抜けた瞬間、使い捨て変数(dis.var)は
// 新しいdisScopeオブジェクトを都度作っているため、endBody実行時には既に存在しない
// （＝「シュレッダーにかけられた」状態が自然に再現される）。
function run(node, ctx, runStatements) {
  const { varName, stepExpr, maxLoops } = node;
  const step = stepExpr.startsWith('--') ? -1 : 1;
  let currentVal = 1;
  let output = '';

  for (let i = 0; i < maxLoops; i++) {
    const disScope = { ...ctx.disScope, [varName]: currentVal };
    output += runStatements(node.body, { ...ctx, disScope });
    currentVal += step;
  }

  // endBody実行時は、ループ用に作ったdisScopeを引き継がない（変数は消滅している）。
  output += runStatements(node.endBody, ctx);
  return output;
}

module.exports = { parse, run };
