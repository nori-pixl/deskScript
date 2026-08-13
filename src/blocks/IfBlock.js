// if(条件):true { ... } elif(条件):true { ... } else { ... } を担当する。
const { skipWs, matchKeyword, findMatchingParen, findMatchingBrace } = require('./BraceUtils');

// text[pos] が "if" で始まっている前提で解析する。
// 戻り値: { node, endIndex } または、構文が崩れていれば null（呼び出し側でフォールバックする）。
function parse(text, pos, parseStatements) {
  const branches = [];
  let cursor = pos;

  // 1つ目の分岐（if）を読む
  const first = parseBranchHeader(text, cursor, 'if', parseStatements);
  if (!first) return null;
  branches.push(first.branch);
  cursor = first.endIndex;

  // elif が続く限り読み続ける
  while (true) {
    const afterWs = skipWs(text, cursor);
    const elifStart = matchKeyword(text, afterWs, 'elif');
    if (elifStart === -1) break;
    const elifResult = parseBranchHeader(text, afterWs, 'elif', parseStatements);
    if (!elifResult) break;
    branches.push(elifResult.branch);
    cursor = elifResult.endIndex;
  }

  // else{...} があれば読む（条件なし）
  let elseBody = null;
  const afterWs2 = skipWs(text, cursor);
  const elseStart = matchKeyword(text, afterWs2, 'else');
  if (elseStart !== -1) {
    const braceOpen = skipWs(text, elseStart);
    if (text[braceOpen] === '{') {
      const braceClose = findMatchingBrace(text, braceOpen);
      if (braceClose !== -1) {
        elseBody = parseStatements(text.slice(braceOpen + 1, braceClose));
        cursor = braceClose + 1;
      }
    }
  }

  return { node: { type: 'if', branches, elseBody }, endIndex: cursor };
}

// "if(条件):true { 本体 }" または "elif(条件):true { 本体 }" を1つ読む。
function parseBranchHeader(text, pos, keyword, parseStatements) {
  const afterKeyword = matchKeyword(text, pos, keyword);
  if (afterKeyword === -1) return null;

  const parenOpen = skipWs(text, afterKeyword);
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
  return { branch: { condition, body }, endIndex: braceClose + 1 };
}

// AST(if)ノードを実行する。最初に条件が真になった分岐のbodyだけを実行し、
// どれも真でなければelseBody（あれば）を実行する。
function run(node, ctx, runStatements) {
  const { hostScope, disScope, evaluator, strict } = ctx;
  for (const branch of node.branches) {
    let condResult;
    try {
      condResult = evaluator.evaluateExpression(branch.condition, hostScope, disScope, !!strict);
    } catch {
      condResult = false;
    }
    if (condResult) {
      return runStatements(branch.body, ctx);
    }
  }
  if (node.elseBody) {
    return runStatements(node.elseBody, ctx);
  }
  return '';
}

module.exports = { parse, run };
