import * as fs from 'fs';
import { Desk, DSFunction, ClassDef } from './Types';

export class DeskScriptStorage {
  public globalStorage: Record<string, any> = {};
  public desks: Record<string, Desk> = {};
  public functions: Record<string, DSFunction> = {};
  public classes: Record<string, ClassDef> = {}; // set:class / class: で登録されるクラス定義
  // timing:キー{処理} で登録されるイベントフック本体（キー例: "desk:x.start", "var.hp.change", "var:token.delete", "for.start"）
  public timingHooks: Record<string, string[]> = {};
  public importedModules: Record<string, any> = { process };

  // import.ds.txt からJSライブラリをロード
  public loadImports(importFilePath: string): void {
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
