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

  // desk名と引数を渡して1つのdeskを実行し、outreturnの結果を「戻り値として」返す。
  // console.logはしない（呼び出し側が使い道を選べるように）。
  // workerName/workerPasswordは、そのdeskに担当worker（@worker）が指定されている場合のみ必要。
  callDesk(deskName, argValue, workerName = null, workerPassword = null) {
    const desk = this.storage.desks[deskName];
    if (!desk) {
      console.log(`[DeskScript Error]: desk "${deskName}" がありません。`);
      return null;
    }

    // このdeskに担当workerが指定されている場合は認証を行う
    if (desk.worker) {
      if (!workerName || !workerPassword) {
        console.log(`[DeskScript Error]: desk "${deskName}" はworker認証が必要です。`);
        return null;
      }
      if (workerName !== desk.worker.name || workerPassword !== desk.worker.password) {
        console.log(`[DeskScript Error]: worker "${workerName}" にはdesk "${deskName}" を操作する権限がありません。`);
        return null;
      }
      const worker = this.storage.workers[workerName];
      if (!worker) {
        console.log(`[DeskScript Error]: worker "${workerName}" は登録されていません（set:workerが必要です）。`);
        return null;
      }
      if (worker.password !== workerPassword) {
        console.log(`[DeskScript Error]: worker "${workerName}" のパスワードが違います。`);
        return null;
      }
      if (!worker.hired) {
        console.log(`[DeskScript Error]: worker "${workerName}" は解雇されているため、desk "${deskName}" を操作できません。`);
        return null;
      }
    }

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
    return outputText;
  }

  // shell.log(load.desk:デスク名("引数")) 形式のコマンド文字列を1つ実行する（従来互換）。
  // 結果はconsole.logで出力しつつ、戻り値としても返す。
  run(commandLine) {
    const line = commandLine.trim();
    if (!line || !line.startsWith("shell.log")) return null;

    const logContentMatch = line.match(/shell\.log\s*\((.*)\)/);
    if (!logContentMatch) return null;
    const innerContent = logContentMatch[1].trim();

    const loadDeskMatch = innerContent.match(/load\.desk:(\w+)\s*\((.*)\)/);
    if (!loadDeskMatch) return null;

    const deskName = loadDeskMatch[1];
    const argValue = loadDeskMatch[2].replace(/^["']|["']$/g, '');

    const result = this.callDesk(deskName, argValue);
    if (result !== null) console.log(result);
    return result;
  }

  // .ds ファイル内に書かれた hire(...) / dism(...) / run(...) / command.log.print(...) を、
  // 書かれた順番どおりに実行する（解雇より前のrunは成功、後のrunは失敗、という順序が正しく反映される）。
  // run結果のみを {deskName, argValue, workerName, result} の配列で返す。
  runAll() {
    const results = [];
    for (const action of this.storage.actions) {
      if (action.type === 'hire') {
        const worker = this.storage.workers[action.workerName];
        if (!worker) {
          console.log(`[DeskScript Error]: worker "${action.workerName}" は未登録です（set:workerが先に必要です）。`);
          continue;
        }
        worker.hired = true;
      } else if (action.type === 'dism') {
        const worker = this.storage.workers[action.workerName];
        if (!worker) {
          console.log(`[DeskScript Error]: worker "${action.workerName}" は未登録です。`);
          continue;
        }
        if (worker.password !== action.password) {
          console.log(`[DeskScript Error]: worker "${action.workerName}" の解雇に失敗（パスワード不一致）。`);
          continue;
        }
        worker.hired = false;
      } else if (action.type === 'run') {
        const { deskName, argValue, workerName, workerPassword } = action;
        const result = this.callDesk(deskName, argValue, workerName, workerPassword);
        if (result !== null) console.log(result);
        results.push({ deskName, argValue, workerName, result });
      } else if (action.type === 'print') {
        // command.log.print("文字", 変数名, 関数名(), desk名(引数), "文字") の中身を評価する。
        // ① まず desk名(引数) の呼び出しを、認証不要なdeskに限って先に解決する
        //   （worker認証が必要なdeskは、資格情報を渡す手段がないのでここでは呼べない）。
        let content = action.content;
        for (const deskName in this.storage.desks) {
          const desk = this.storage.desks[deskName];
          const deskCallRegex = new RegExp(`\\b${deskName}\\s*\\(([^()]*)\\)`, 'g');
          content = content.replace(deskCallRegex, (_, argsRaw) => {
            if (desk.worker) {
              // このDSLの文字列トークンはエスケープを解釈しないため、メッセージ内で "や\は使わない。
              return `"[DeskScript Error]: desk ${deskName} はworker認証が必要なため、command.log.printから直接は呼べません。run(...)でworker認証つきで呼び出してください。"`;
            }
            const argValue = argsRaw.trim().replace(/^["']|["']$/g, '');
            const result = this.callDesk(deskName, argValue);
            return `"${result || ''}"`;
          });
        }
        // ② 残り（文字列/グローバル変数/function呼び出し）を通常どおり評価する
        //   （desk/drawerの外側に書く構文のため、hostScope/disScopeは持たない）。
        const text = this.evaluator.buildOutput(content, {}, {});
        console.log(text);
      }
    }
    return results;
  }
}

// --- 実際の実行トリガー ---
// .ds ファイル側に書かれた run(desk名(引数)) を、書かれた数だけ順番に実行する。
const engine = new DeskScriptEngine();
if (engine.init('./import.ds.txt', './main.ds')) {
  engine.runAll();
}

module.exports = { DeskScriptEngine };
