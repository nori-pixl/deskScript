// try { ... } catch(dis.var:変数名) { ... } end { ... } を担当する。
const { skipWs, matchKeyword, findMatchingBrace } = require('./BraceUtils');

// text[pos] が "try" で始まっている前提で解析する。
function parse(text, pos, parseStatements) {
  const afterTry = matchKeyword(text, pos, 'try');
  if (afterTry === -1) return null;

  const tryBraceOpen = skipWs(text, afterTry);
  if (text[tryBraceOpen] !== '{') return null;
  const tryBraceClose = findMatchingBrace(text, tryBraceOpen);
  if (tryBraceClose === -1) return null;
  const tryBody = parseStatements(text.slice(tryBraceOpen + 1, tryBraceClose));

  let cursor = skipWs(text, tryBraceClose + 1);
  const afterCatch = matchKeyword(text, cursor, 'catch');
  if (afterCatch === -1) return null;

  const parenOpen = skipWs(text, afterCatch);
  if (text[parenOpen] !== '(') return null;
  const parenCloseIdx = text.indexOf(')', parenOpen);
  if (parenCloseIdx === -1) return null;
  const catchParam = text.slice(parenOpen + 1, parenCloseIdx).trim();
  const varMatch = catchParam.match(/^dis\.var\s*:\s*(\w+)$/);
  if (!varMatch) return null;
  const catchVarName = varMatch[1];

  const catchBraceOpen = skipWs(text, parenCloseIdx + 1);
  if (text[catchBraceOpen] !== '{') return null;
  const catchBraceClose = findMatchingBrace(text, catchBraceOpen);
  if (catchBraceClose === -1) return null;
  const catchBody = parseStatements(text.slice(catchBraceOpen + 1, catchBraceClose));

  cursor = skipWs(text, catchBraceClose + 1);
  const afterEnd = matchKeyword(text, cursor, 'end');
  if (afterEnd === -1) return null;

  const endBraceOpen = skipWs(text, afterEnd);
  if (text[endBraceOpen] !== '{') return null;
  const endBraceClose = findMatchingBrace(text, endBraceOpen);
  if (endBraceClose === -1) return null;
  const endBody = parseStatements(text.slice(endBraceOpen + 1, endBraceClose));

  return {
    node: { type: 'try', tryBody, catchVarName, catchBody, endBody },
    endIndex: endBraceClose + 1,
  };
}

// AST(try)ノードを実行する。tryBodyの評価中に本物のエラーが起きたらcatchBodyへ、
// エラーの有無にかかわらず最後に必ずendBodyを実行する。
function run(node, ctx, runStatements) {
  let output = '';
  try {
    // tryの中だけは「厳密モード」で評価し、式の評価エラーを握りつぶさずに投げる。
    output += runStatements(node.tryBody, { ...ctx, strict: true });
  } catch (err) {
    const errorMessage = err && err.message ? err.message : String(err);
    const newDisScope = { ...ctx.disScope, [node.catchVarName]: errorMessage };
    output += runStatements(node.catchBody, { ...ctx, disScope: newDisScope, strict: false });
  }
  output += runStatements(node.endBody, { ...ctx, strict: false });
  return output;
}

module.exports = { parse, run };
