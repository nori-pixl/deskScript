import { DeskScriptStorage } from './src/Storage';
import { DeskScriptParser } from './src/Parser';
import { DeskScriptEvaluator } from './src/Evaluator';
import { DeskScriptExtensions } from './src/DeskExtensions';

export class DeskScriptEngine {
  private storage = new DeskScriptStorage();
  private parser = new DeskScriptParser(this.storage);
  private evaluator = new DeskScriptEvaluator(this.storage);
  // 追加構文パック（lock:drawer / shred:var / intern:desk / stamp /
  // meeting:join / outbox:send・inbox:receive / audit:trail / shift:morning・night）
  private extensions = new DeskScriptExtensions(this.storage, this.evaluator);

  public init(importPath: string, scriptPath: string) {
    this.storage.loadImports(importPath);
    return this.parser.loadScriptFile(scriptPath);
  }

  public run(commandLine: string): void {
    const line = commandLine.trim();
    if (!line || !line.startsWith("shell.log")) return;

    const logContentMatch = line.match(/shell\.log\s*\((.*)\)/);
    if (!logContentMatch) return;
    const innerContent = logContentMatch[1].trim(); 

    const loadDeskMatch = innerContent.match(/load\.desk:(\w+)\s*\((.*)\)/);
    if (!loadDeskMatch) return;

    const deskName = loadDeskMatch[1];
    const argValue = loadDeskMatch[2].replace(/^["']|["']$/g, '');

    // desk実行そのものは DeskScriptExtensions.runDesk に一本化
    // （meeting:join からも同じロジックを再利用するため）
    console.log(this.extensions.runDesk(deskName, argValue));
  }

  // 監査ログ（audit:trail）をまとめて取得したいときに使う
  public getAuditLog(): string[] {
    return this.extensions.getAuditLog();
  }
}

// --- 実際の実行トリガー ---
const engine = new DeskScriptEngine();
if (engine.init('./import.ds.txt', './main.ds')) {
  // 分割合流したゲーム用ロジックを動かす！
  engine.run('shell.log(load.desk:ultimateDesk("CriticalError"))');
}
