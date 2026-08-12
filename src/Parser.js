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
      results.push({ groups: m.slice(1), body });
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

    // deskの解析
    const deskBlocks = this.extractBlocks(cleanCode, /desk:(\w+)\s*\(([^)]*)\)\s*\{/g);
    for (const { groups, body: deskBody } of deskBlocks) {
      const [deskName, argsStr] = groups;
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

      this.storage.desks[deskName] = { argName, drawers, outreturnTarget };
    }
  }
}

module.exports = { DeskScriptParser };
