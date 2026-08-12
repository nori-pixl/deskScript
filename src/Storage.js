const fs = require('fs');

class DeskScriptStorage {
  constructor() {
    this.globalStorage = {};
    this.desks = {};
    this.functions = {};
    this.importedModules = { process };
    // .ds ファイル内に書かれた hire(...) / dism(...) / run(...) を、
    // 書かれた順番どおりに実行するためのアクション列。
    // 例: [{type:'hire',...}, {type:'run',...}, {type:'dism',...}, {type:'run',...}]
    this.actions = [];
    // worker（deskを扱う働き者）の管理。名前 -> { password, hired }
    this.workers = {};
  }

  // import.ds.txt からJSライブラリをロード
  loadImports(importFilePath) {
    if (!fs.existsSync(importFilePath)) return;
    const content = fs.readFileSync(importFilePath, 'utf-8');
    const modules = content.split(/[\n,]/).map(m => m.trim()).filter(Boolean);

    for (const modName of modules) {
      try {
        this.importedModules[modName] = require(modName);
      } catch {
        console.log(`[DeskScript Error]: ライブラリ「${modName}」の読込失敗。`);
      }
    }
  }
}

module.exports = { DeskScriptStorage };
