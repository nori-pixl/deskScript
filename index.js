const { DeskScriptStorage } = require('./src/Storage');
const { DeskScriptParser } = require('./src/Parser');
const { DeskScriptEvaluator } = require('./src/Evaluator');

class DeskScriptEngine {
  constructor() {
    this.storage = new DeskScriptStorage();
    this.parser = new DeskScriptParser(this.storage);
    this.evaluator = new DeskScriptEvaluator(this.storage);
  }

  init(importPath, scriptPath) {
    this.storage.loadImports(importPath);
    return this.parser.loadScriptFile(scriptPath);
  }

  run(commandLine) {
    const line = commandLine.trim();
    if (!line || !line.startsWith("shell.log")) return;

    const logContentMatch = line.match(/shell\.log\s*\((.*)\)/);
    if (!logContentMatch) return;
    const innerContent = logContentMatch[1].trim();

    const loadDeskMatch = innerContent.match(/load\.desk:(\w+)\s*\((.*)\)/);
    if (!loadDeskMatch) return;

    const deskName = loadDeskMatch[1];
    const argValue = loadDeskMatch[2].replace(/^["']|["']$/g, '');

    const desk = this.storage.desks[deskName];
    if (!desk) return console.log(`[DeskScript Error]: desk "${deskName}" がありません。`);

    const deskArgs = {};
    if (desk.argName) deskArgs[desk.argName] = argValue;

    let outputText = "";

    for (let dName in desk.drawers) {
      const drawer = desk.drawers[dName];
      const hostScope = {};

      for (let vName in drawer.hostVariables) {
        const src = drawer.hostVariables[vName].source;
        hostScope[vName] = deskArgs[src] !== undefined ? deskArgs[src] : (this.storage.globalStorage[src] || src);
      }

      if (desk.outreturnTarget && drawer.inreturns[desk.outreturnTarget]) {
        const rawContent = drawer.inreturns[desk.outreturnTarget];

        // forループ構文の簡易処理
        if (rawContent.includes('for(')) {
          const forRegex = /for\s*\(dis\.var\s*:\s*(\w+)\s+in\s+([\+\-\d]+)\)\s*:\s*(\d+)\s*\{([\s\S]*?)\}\s*end\s*\{([\s\S]*?)\}/;
          const forMatch = rawContent.match(forRegex);

          if (forMatch) {
            const varName = forMatch[1];
            const stepExpr = forMatch[2];
            const maxLoops = parseInt(forMatch[3]);
            const forBody = forMatch[4].trim();
            const endBody = forMatch[5].trim();

            let step = stepExpr.startsWith('--') ? -1 : 1;
            let currentVal = 1;

            let loopOutput = "";
            for (let l = 0; l < maxLoops; l++) {
              const disScope = {};
              disScope[varName] = currentVal;
              loopOutput += this.evaluator.buildOutput(forBody, hostScope, disScope);
              currentVal += step;
            }
            outputText = loopOutput + this.evaluator.buildOutput(endBody, hostScope);
          }
        } else {
          outputText = this.evaluator.buildOutput(rawContent, hostScope);
        }
      }
    }
    console.log(outputText);
  }
}

// --- 実際の実行トリガー ---
const engine = new DeskScriptEngine();
if (engine.init('./import.ds.txt', './main.ds')) {
  // 分割合流したゲーム用ロジックを動かす！
  engine.run('shell.log(load.desk:ultimateDesk("勇者アレン"))');
}

module.exports = { DeskScriptEngine };
