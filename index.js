"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeskScriptEngine = void 0;
const Storage_1 = require("./src/Storage");
const Parser_1 = require("./src/Parser");
const Evaluator_1 = require("./src/Evaluator");
const DeskExtensions_1 = require("./src/DeskExtensions");
class DeskScriptEngine {
    storage = new Storage_1.DeskScriptStorage();
    parser = new Parser_1.DeskScriptParser(this.storage);
    evaluator = new Evaluator_1.DeskScriptEvaluator(this.storage);
    // 追加構文パック（lock:drawer / shred:var / intern:desk / stamp /
    // meeting:join / outbox:send・inbox:receive / audit:trail / shift:morning・night）
    extensions = new DeskExtensions_1.DeskScriptExtensions(this.storage, this.evaluator);
    init(importPath, scriptPath) {
        this.storage.loadImports(importPath);
        return this.parser.loadScriptFile(scriptPath);
    }
    run(commandLine) {
        const line = commandLine.trim();
        if (!line || !line.startsWith("shell.log"))
            return;
        const logContentMatch = line.match(/shell\.log\s*\((.*)\)/);
        if (!logContentMatch)
            return;
        const innerContent = logContentMatch[1].trim();
        const loadDeskMatch = innerContent.match(/load\.desk:(\w+)\s*\((.*)\)/);
        if (!loadDeskMatch)
            return;
        const deskName = loadDeskMatch[1];
        const argValue = loadDeskMatch[2].replace(/^["']|["']$/g, '');
        // desk実行そのものは DeskScriptExtensions.runDesk に一本化
        // （meeting:join からも同じロジックを再利用するため）
        // ★修正4対応: runDeskの戻り値が {success, output, error} の構造化オブジェクトに
        // なったので、成否に応じて表示を分ける（失敗時は途中経過とエラー内容の両方を出す）。
        const result = this.extensions.runDesk(deskName, argValue);
        if (result.success) {
            console.log(result.output);
        }
        else {
            console.error(`[DeskScript Error] ${result.error}`);
            if (result.output) {
                console.log(result.output);
            }
        }
    }
    // 監査ログ（audit:trail）をまとめて取得したいときに使う
    getAuditLog() {
        return this.extensions.getAuditLog();
    }
}
exports.DeskScriptEngine = DeskScriptEngine;
// --- 実際の実行トリガー ---
const engine = new DeskScriptEngine();
if (engine.init('./import.ds.txt', './main.ds')) {
    engine.run('shell.log(load.desk:ultimateDesk("CriticalError"))');
}
