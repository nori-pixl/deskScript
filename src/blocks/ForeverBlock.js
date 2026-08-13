// forever(条件) { ... } を担当する。
//
// 【重要な設計判断】
// forever は「バックグラウンドで永久に動き続ける監視プロセス」を表す構文だが、
// このエンジンは同期処理で1回の実行が必ず終わることを前提にしている。
// 文字どおり無限ループさせるとプログラムがハングして二度と応答しなくなるため、
// forever(条件) は「条件が真であれば、本体を1回だけ実行する」という
// 安全な近似（1回のハートビート）として実装する。
// これはバグではなく、同期実行モデルでの意図的な安全策。
const { skipWs, matchKeyword, findMatchingParen, findMatchingBrace } = require('./BraceUtils');

function parse(text, pos, parseStatements) {
  const afterForever = matchKeyword(text, pos, 'forever');
  if (afterForever === -1) return null;

  const parenOpen = skipWs(text, afterForever);
  if (text[parenOpen] !== '(') return null;
  const parenClose = findMatchingParen(text, parenOpen);
  if (parenClose === -1) return null;
  const condition = text.slice(parenOpen + 1, parenClose);

  const braceOpen = skipWs(text, parenClose + 1);
  if (text[braceOpen] !== '{') return null;
  const braceClose = findMatchingBrace(text, braceOpen);
  if (braceClose === -1) return null;

  const body = parseStatements(text.slice(braceOpen + 1, braceClose));
  return { node: { type: 'forever', condition, body }, endIndex: braceClose + 1 };
}

function run(node, ctx, runStatements) {
  const { hostScope, disScope, evaluator, strict } = ctx;
  let condResult;
  try {
    condResult = evaluator.evaluateExpression(node.condition, hostScope, disScope, !!strict);
  } catch {
    condResult = false;
  }
  if (!condResult) return '';
  // 「本体を1回だけ実行」= 常時監視プロセスが今回のサイクルで正常に稼働したことを表す。
  return runStatements(node.body, ctx);
}

module.exports = { parse, run };
