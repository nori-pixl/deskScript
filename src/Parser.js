const fs = require('fs');
const path = require('path');

class DeskScriptParser {
  constructor(storage) {
    this.storage = storage;
    this.currentDir = '.';
  }

  // openIndex は開き括弧 "{" の位置。文字列リテラル("...")内の { } は無視しつつ、
  // 対応する閉じ括弧のインデックスを深さカウントで求める。見つからなければ -1。
  findMatchingBrace(text, openIndex) {
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

  // headerRegex は本体直前までにマッチし、最後のキャプチャグループの直後に "{" が続く前提。
  // ヘッダーのキャプチャ群と、括弧対応で切り出した本体(トリム前)を順に返す。
  extractBlocks(text, headerRegex) {
    const results = [];
    let m;
    headerRegex.lastIndex = 0;
    while ((m = headerRegex.exec(text)) !== null) {
      const openIndex = m.index + m[0].length - 1; // マッチ末尾の "{"
      if (text[openIndex] !== '{') continue;
      const closeIndex = this.findMatchingBrace(text, openIndex);
      if (closeIndex === -1) continue;
      const body = text.slice(openIndex + 1, closeIndex);
      // start/end はブロック全体（ヘッダー〜閉じ括弧）の範囲。
      // トップレベルの run(...) 呼び出しを拾う際に、本体の中身を除外するために使う。
      results.push({ groups: m.slice(1), body, start: m.index, end: closeIndex + 1 });
      headerRegex.lastIndex = closeIndex + 1;
    }
    return results;
  }

  loadScriptFile(filePath) {
    if (path.extname(filePath) !== '.ds') {
      console.log(`[DeskScript Error]: 拡張子が .ds ではありません。 -> ${filePath}`);
      return false;
    }
    this.currentDir = path.dirname(filePath);
    const sourceCode = fs.readFileSync(filePath, 'utf-8');
    this.parseCode(sourceCode);
    return true;
  }

  parseCode(sourceCode) {
    const cleanCode = sourceCode.replace(/\/\/.*$/gm, "");

    // load.file: の再帰読み込み
    const loadFileRegex = /load\.file\s*:\s*([\w\.-/]+)/g;
    let fileMatch;
    while ((fileMatch = loadFileRegex.exec(cleanCode)) !== null) {
      const targetPath = path.join(this.currentDir, fileMatch[1]);
      if (fs.existsSync(targetPath)) {
        const subCode = fs.readFileSync(targetPath, 'utf-8');
        this.parseCode(subCode);
      }
    }

    // set:var (global変数) の解析
    const setRegex = /set:var\(([^,]+),\s*global\/[^/]+\/(\w+)\)\s*=\s*(.+)/g;
    let setMatch;
    while ((setMatch = setRegex.exec(cleanCode)) !== null) {
      const [_, type, varName, valueStr] = setMatch;
      this.storage.globalStorage[varName] = valueStr.trim().replace(/^"|"$/g, '');
    }

    // functionの解析
    const funcBlocks = this.extractBlocks(cleanCode, /function\s*:\s*(\w+)\s*\(([^)]*)\)\s*\{/g);
    for (const { groups, body } of funcBlocks) {
      const [funcName, paramsStr] = groups;
      const paramNames = paramsStr.split(',').map(p => p.trim()).filter(Boolean).map(p => p.split(/\s+/)[1] || p);
      this.storage.functions[funcName] = { paramNames, body: body.trim() };
    }

    // deskの解析（直前に @worker("名前","パスワード") が書かれていれば担当workerとして紐付ける）
    const deskBlocks = this.extractBlocks(
      cleanCode,
      /(?:@worker\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)\s*)?desk:(\w+)\s*\(([^)]*)\)\s*\{/g
    );
    for (const { groups, body: deskBody } of deskBlocks) {
      const [workerName, workerPassword, deskName, argsStr] = groups;
      const args = argsStr.split(/\s+/).filter(Boolean);
      const argName = args.length > 1 ? args[1] : (args[0] || null);

      const drawerBlocks = this.extractBlocks(deskBody, /drawer:(\w+)\s*\(([^)]*)\)\s*\{/g);
      const drawers = {};

      for (const { groups: drawerGroups, body: drawerBody } of drawerBlocks) {
        const [drawerName] = drawerGroups;
        const varLines = drawerBody.split("\n");
        const hostVariables = {};

        for (let line of varLines) {
          line = line.trim();
          if (line.startsWith("host.var.")) {
            const vMatch = line.match(/host\.var\.\w+:(\w+)\s*\(([^)]+)\)/);
            if (vMatch) {
              const [___, varName, params] = vMatch;
              const paramArray = params.split(",").map(p => p.trim());
              hostVariables[varName] = { source: paramArray.length > 1 ? paramArray[1] : paramArray[0] };
            }
          }
        }

        const inreturnBlocks = this.extractBlocks(drawerBody, /inreturn:(\w+)\s*\{/g);
        const inreturns = {};
        for (const { groups: retGroups, body: retContent } of inreturnBlocks) {
          const [retName] = retGroups;
          inreturns[retName] = retContent.trim();
        }

        drawers[drawerName] = { hostVariables, inreturns };
      }

      const outreturnBlocks = this.extractBlocks(deskBody, /outreturn\s*\{/g);
      const outreturnTarget = outreturnBlocks.length > 0 ? outreturnBlocks[0].body.trim() : null;

      // このdeskに担当workerが指定されていれば記録しておく（run時に認証で使う）
      const worker = workerName ? { name: workerName, password: workerPassword } : null;

      this.storage.desks[deskName] = { argName, drawers, outreturnTarget, worker };
    }

    // run(desk名(引数)) / run("desk名","worker名","パスワード") の解析。
    // desk/function の本体の"外側"（トップレベル）に書かれたものだけを拾いたいので、
    // 本体部分は同じ長さの空白に置き換えてから run(...) を探す。
    let topLevelCode = cleanCode;
    const bodySpans = [...funcBlocks, ...deskBlocks].sort((a, b) => b.start - a.start);
    for (const span of bodySpans) {
      topLevelCode =
        topLevelCode.slice(0, span.start) +
        ' '.repeat(span.end - span.start) +
        topLevelCode.slice(span.end);
    }

    // worker（deskを扱う働き者）の登録は静的な宣言として先に処理する（関数/deskの定義と同じ扱い）。
    const setWorkerRegex = /\bset:worker\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/g;
    let setWorkerMatch;
    while ((setWorkerMatch = setWorkerRegex.exec(topLevelCode)) !== null) {
      const [, workerName, password] = setWorkerMatch;
      this.storage.workers[workerName] = { password, hired: false };
    }

    // hire(...) / dism(...) / run(...) は「書かれた順番」が意味を持つので、
    // 1本の正規表現でまとめて出現順にスキャンし、アクション列として記録する。
    // 実際の雇用/解雇/実行は index.js 側で順番どおりに処理する。
    const actionRegex =
      /\bhire\s*\(\s*"([^"]*)"\s*\)|\bdism\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)|\brun\s*\(\s*(?:(\w+)\s*\(([^()]*)\)|"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)")\s*\)/g;
    let actionMatch;
    while ((actionMatch = actionRegex.exec(topLevelCode)) !== null) {
      const [, hireWorker, dismWorker, dismPassword, runOldDesk, runOldArg, runNewDesk, runNewWorker, runNewPassword] = actionMatch;

      if (hireWorker !== undefined) {
        this.storage.actions.push({ type: 'hire', workerName: hireWorker });
      } else if (dismWorker !== undefined) {
        this.storage.actions.push({ type: 'dism', workerName: dismWorker, password: dismPassword });
      } else if (runOldDesk !== undefined) {
        // ① run(desk名(引数)) … workerなしの従来形式
        const argValue = runOldArg.trim().replace(/^["']|["']$/g, '');
        this.storage.actions.push({ type: 'run', deskName: runOldDesk, argValue, workerName: null, workerPassword: null });
      } else {
        // ② run("desk名","worker名","パスワード") … worker認証つき呼び出し
        this.storage.actions.push({ type: 'run', deskName: runNewDesk, argValue: '', workerName: runNewWorker, workerPassword: runNewPassword });
      }
    }
  }
}

module.exports = { DeskScriptParser };
