// react:desk:名前(...) { ... } を、実際に動くReactコンポーネントのソースコード（文字列）に変換する。
//
// 【重要な制約】
// このエンジンはNode.js上で動く「テキストを組み立てるだけ」のインタプリタであり、
// ブラウザでもReactのレンダラーでもない。そのため react:desk: は他の構文と違い、
// 実行結果を直接出力するのではなく、「.jsxファイルの中身（ソースコード文字列）」を生成する。
// 生成された .jsx は、実際のReactプロジェクトに配置して初めて動く。
//
// 【host.var の双方向バインディングについて】
// host.var は React の useState に変換される。
// "<input ... value='" の直後にその host.var が続き、"' ..." で閉じられている
// という決まったパターン（README記載の例と同じ書き方）を検出したときだけ、
// 自動的に value={変数} と onChange={e => set変数(e.target.value)} を差し込んで
// 制御されたinputにする。それ以外の使われ方は、単純な {変数} 埋め込みになる
// （＝入力を打ち込んでも自動連動はしない）。これはヒューリスティック（発見的手法）であり、
// 万能ではない。

function toPascalCase(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// カンマ区切り（文字列内のカンマは無視）でトップレベルのトークンに分割する。
function splitTopLevelCommas(text) {
  const tokens = [];
  let buf = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i - 1] !== '\\') inString = !inString;
    if (ch === ',' && !inString) {
      tokens.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim().length > 0) tokens.push(buf);
  return tokens.map(t => t.trim());
}

// desk定義（storage.reactDesksに入っているもの）を受け取り、.jsxのソースコード文字列を返す。
// storageを渡すと、グローバル変数（global.xxx / 裸の変数名）を実際の値に解決してから埋め込む
// （生成されたコンポーネント単体では storage にアクセスできないため）。
// 対応できない・空のdeskの場合は null を返す。
function transpile(deskName, desk, storage = null) {
  const drawerName = Object.keys(desk.drawers)[0];
  if (!drawerName) return null;
  const drawer = desk.drawers[drawerName];
  const hostVarNames = Object.keys(drawer.hostVariables);
  const inreturn = desk.outreturnTarget ? drawer.inreturns[desk.outreturnTarget] : null;
  if (!inreturn) return null;

  const tokens = splitTopLevelCommas(inreturn.raw);

  // 各トークンを「生のJSXテキスト」か「{式}として埋め込む式」かに分類する。
  const parts = tokens.map((token) => {
    if (token.startsWith('"') && token.endsWith('"')) {
      return { type: 'raw', text: token.slice(1, -1) };
    }
    if (hostVarNames.includes(token)) {
      return { type: 'expr', code: token, isHostVar: true, varName: token };
    }
    // グローバル変数（global.xxx / 裸の名前）は、生成後のコンポーネント単体では
    // 参照できないので、分かっている値をこの時点でリテラルとして埋め込んでおく。
    let code = token.replace(/\bglobal\.(\w+)/g, '$1');
    if (storage) {
      for (const key in storage.globalStorage) {
        const val = storage.globalStorage[key];
        const literal = typeof val === 'string' && isNaN(Number(val)) ? JSON.stringify(val) : val;
        code = code.replace(new RegExp(`\\b${key}\\b`, 'g'), literal);
      }
    }
    return { type: 'expr', code };
  });

  // "value='" で終わる raw の直後に host.var、その直後に "'" で始まる raw が続くパターンを、
  // 制御されたinput（value={...} + onChange={...}）に自動変換する。
  const merged = [];
  for (let i = 0; i < parts.length; i++) {
    const cur = parts[i];
    const next = parts[i + 1];
    const afterNext = parts[i + 2];
    if (
      cur.type === 'raw' && /value=['"]$/.test(cur.text) &&
      next && next.type === 'expr' && next.isHostVar &&
      afterNext && afterNext.type === 'raw' && afterNext.text.startsWith("'")
    ) {
      const varName = next.varName;
      const prefix = cur.text.slice(0, cur.text.length - "value='".length);
      const suffix = afterNext.text.slice(1);
      merged.push({
        type: 'raw',
        text: `${prefix}value={${varName}} onChange={e => set${toPascalCase(varName)}(e.target.value)}${suffix}`,
      });
      i += 2; // next と afterNext は既に取り込んだのでスキップ
      continue;
    }
    merged.push(cur);
  }

  let jsxBody = '';
  for (const part of merged) {
    jsxBody += part.type === 'raw' ? part.text : `{${part.code}}`;
  }

  const componentName = toPascalCase(deskName);
  const stateLines = hostVarNames
    .map((v) => `  const [${v}, set${toPascalCase(v)}] = useState('');`)
    .join('\n');

  return `import React, { useState } from 'react';

// このファイルは DeskScript の react:desk:${deskName} から自動生成されました。
// host.var は useState に変換されています。
// value='...' の直後に host.var が続く <input> は、自動的に
// value={} + onChange={} を持つ「制御されたinput」に変換されています
// （それ以外の入力要素は手動でイベントハンドラを追加してください）。
export default function ${componentName}() {
${stateLines}

  return (
    ${jsxBody}
  );
}
`;
}

module.exports = { transpile };
