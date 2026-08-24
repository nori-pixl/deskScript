// inreturnの中身（生のテキスト）を、実行可能な「文（statement）」の並びに変換する司令塔。
// 各制御構文（if/switch/while/try/forever/for）の実際の解析は、対応する Block ファイルに任せる。
const IfBlock = require('./IfBlock');
const SwitchBlock = require('./SwitchBlock');
const WhileBlock = require('./WhileBlock');
const TryBlock = require('./TryBlock');
const ForeverBlock = require('./ForeverBlock');
const ForBlock = require('./ForBlock');
const { matchKeyword } = require('./BraceUtils');

// ブロックの開始キーワードと、それを解析する担当ファイルの対応表。
const BLOCK_PARSERS = [
  { keyword: 'if', parser: IfBlock },
  { keyword: 'switch', parser: SwitchBlock },
  { keyword: 'while', parser: WhileBlock },
  { keyword: 'try', parser: TryBlock },
  { keyword: 'forever', parser: ForeverBlock },
  { keyword: 'for', parser: ForBlock },
];

// テキストのpos位置が、いずれかの制御構文の開始キーワードと一致するかを調べる。
// 一致すれば { parser } を、しなければ null を返す。
function detectBlockStart(text, pos) {
  for (const { keyword, parser } of BLOCK_PARSERS) {
    if (matchKeyword(text, pos, keyword) !== -1) {
      return parser;
    }
  }
  return null;
}

// 文字列引数を「文の並び」に変換する。制御構文のネスト（入れ子）にも対応する
// （各Blockのbodyをこの関数で再帰的に解析するため）。
function parseStatements(text) {
  const nodes = [];
  let i = 0;
  let buffer = '';
  let inString = false;

  const flush = () => {
    if (buffer.length === 0) return;
    // 複数行のプレーンな出力文（カンマ区切り）は、1行ずつ独立した文として扱う。
    // こうすることで「行末にカンマが無い隣接行」が意図せず1つの式として
    // 結合されてしまう不具合を防ぐ。
    for (const line of buffer.split('\n')) {
      if (line.trim().length > 0) {
        nodes.push({ type: 'text', content: line });
      }
    }
    buffer = '';
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === '"' && text[i - 1] !== '\\') {
      inString = !inString;
      buffer += ch;
      i++;
      continue;
    }
    if (inString) {
      buffer += ch;
      i++;
      continue;
    }

    const blockParser = detectBlockStart(text, i);
    if (blockParser) {
      flush();
      const result = blockParser.parse(text, i, parseStatements);
      if (result) {
        nodes.push(result.node);
        i = result.endIndex;
        continue;
      }
      // 構文が崩れていて解析できなかった場合は、キーワード自体はテキストとして残し、
      // 通常のバグに気づけるよう出力に混ぜておく（エンジンを落とさない）。
    }

    buffer += ch;
    i++;
  }
  flush();
  return nodes;
}

module.exports = { parseStatements };
