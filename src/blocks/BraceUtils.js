// 括弧の対応を数える共通ユーティリティ。
// 文字列リテラル("...")の中にある括弧は無視する。
// Parser.js（desk/drawer/inreturnの切り出し）と、
// StatementParser.js（if/switch/while/try/forever/for の切り出し）の両方から使われる。

// text[openIndex] が "{" である前提で、対応する "}" のインデックスを返す。見つからなければ -1。
function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i - 1] !== '\\') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// text[openIndex] が "(" である前提で、対応する ")" のインデックスを返す。見つからなければ -1。
function findMatchingParen(text, openIndex) {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i - 1] !== '\\') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// pos以降の空白（半角スペース・タブ・改行）を読み飛ばした位置を返す。
function skipWs(text, pos) {
  let i = pos;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

// pos位置から、textが指定したliteral文字列（例: "if", "catch"）で始まっているかを、
// 単語境界（\b相当）を考慮してチェックする。一致すればliteralの直後の位置を、しなければ-1を返す。
function matchKeyword(text, pos, literal) {
  const slice = text.slice(pos, pos + literal.length);
  if (slice !== literal) return -1;
  const before = pos > 0 ? text[pos - 1] : '';
  const after = text[pos + literal.length] || '';
  const isWordChar = (c) => /[A-Za-z0-9_]/.test(c);
  if (isWordChar(before) || isWordChar(after)) return -1; // 単語の途中にマッチしたのはNG
  return pos + literal.length;
}

module.exports = { findMatchingBrace, findMatchingParen, skipWs, matchKeyword };
