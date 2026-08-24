import * as fs from 'fs';
import * as path from 'path';
import { DeskScriptStorage } from './Storage';
import { HostVariable, Drawer, TypedField, ClassDef } from './Types';

export class DeskScriptParser {
  private currentDir: string = '.';

  constructor(private storage: DeskScriptStorage) {}

  // openIndex ( source[openIndex] === '{' ) に対応する閉じ括弧の位置を、
  // 入れ子（if/for/switch等）も正しく数えて探す
  private findMatchingBrace(source: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  // "self.型:引数" / "型:引数" 形式のトークンを { type, name } へ変換する
  // (isSelf が true なら "self." を剥がした上で解析する。self.でない場合もそのまま解析可)
  private parseTypedField(token: string): TypedField | null {
    let t = token.trim();
    if (t.startsWith('self.')) t = t.slice(5);
    const colonIdx = t.indexOf(':');
    if (colonIdx === -1) return null;
    const type = t.slice(0, colonIdx).trim();
    const name = t.slice(colonIdx + 1).trim();
    if (!type || !name) return null;
    return { type, name };
  }

  public loadScriptFile(filePath: string): boolean {
    if (path.extname(filePath) !== '.ds') {
      console.log(`[DeskScript Error]: 拡張子が .ds ではありません。 -> ${filePath}`);
      return false;
    }
    this.currentDir = path.dirname(filePath);
    const sourceCode = fs.readFileSync(filePath, 'utf-8');
    this.parseCode(sourceCode);
    return true;
  }

  private parseCode(sourceCode: string): void {
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

    // functionの解析（ヘッダーだけ正規表現で見つけ、本体は波括弧の深さを数えて対応する'}'まで取得する）
    const funcHeaderRegex = /function\s*:\s*(\w+)\s*\(([^)]*)\)\s*\{/g;
    let funcMatch;
    while ((funcMatch = funcHeaderRegex.exec(cleanCode)) !== null) {
      const [, funcName, paramsStr] = funcMatch;
      const openIdx = funcMatch.index + funcMatch[0].length - 1;
      const closeIdx = this.findMatchingBrace(cleanCode, openIdx);
      if (closeIdx === -1) continue;
      const funcBody = cleanCode.slice(openIdx + 1, closeIdx);
      const paramNames = paramsStr.split(',').map(p => p.trim()).filter(Boolean).map(p => p.split(/\s+/)[1] || p);
      this.storage.functions[funcName] = { paramNames, body: funcBody.trim() };
      funcHeaderRegex.lastIndex = closeIdx + 1;
    }

    // timing:キー { 処理 } — イベントフックの登録
    // キー例: var.hp.change / var:token.delete / desk:ultimateDesk.start / desk:ultimateDesk.end /
    //         desk:ultimateDesk.lock / desk:ultimateDesk.unlock / for.start / for.end
    // ※ if/switch/while は現状のランタイムで本当のブロック単位実行になっていないため、
    //    それらの .start/.end フックは実質的に発火しない（実装できているのは desk/for/var のみ）。
    const timingHeaderRegex = /timing:([\w:.]+)\s*\{/g;
    let timingMatch;
    while ((timingMatch = timingHeaderRegex.exec(cleanCode)) !== null) {
      const key = timingMatch[1];
      const openIdx = timingMatch.index + timingMatch[0].length - 1;
      const closeIdx = this.findMatchingBrace(cleanCode, openIdx);
      if (closeIdx === -1) continue;
      const body = cleanCode.slice(openIdx + 1, closeIdx).trim();
      timingHeaderRegex.lastIndex = closeIdx + 1;

      if (!this.storage.timingHooks[key]) this.storage.timingHooks[key] = [];
      this.storage.timingHooks[key].push(body);
    }

    // set:class(名前, 型:引数, 型:引数, ,,,) — クラスのフィールド・スキーマ宣言
    const setClassRegex = /set:class\(([^)]*)\)/g;
    let setClassMatch;
    while ((setClassMatch = setClassRegex.exec(cleanCode)) !== null) {
      const parts = setClassMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length === 0) continue;
      const className = parts[0];
      const fields = parts.slice(1)
        .map(p => this.parseTypedField(p))
        .filter((f): f is TypedField => f !== null);

      const existing = this.storage.classes[className];
      this.storage.classes[className] = {
        name: className,
        fields,
        initParams: existing?.initParams || [],
        initDefaults: existing?.initDefaults || [],
        initBody: existing?.initBody || '',
      };
    }

    // class:名前(self, 型:引数, self.型:引数,,,), init(self.型:引数,,,|値,値,,,) { 処理 }
    // "|" は init(...) の中でパラメータ宣言とデフォルト値を区切る新構文
    const classHeaderRegex = /class:(\w+)\s*\(([^)]*)\)\s*,\s*init\s*\(([^)]*)\)\s*\{/g;
    let classMatch;
    while ((classMatch = classHeaderRegex.exec(cleanCode)) !== null) {
      const [, className, classParamsStr, initParamsStr] = classMatch;
      const openIdx = classMatch.index + classMatch[0].length - 1;
      const closeIdx = this.findMatchingBrace(cleanCode, openIdx);
      if (closeIdx === -1) continue;
      const initBody = cleanCode.slice(openIdx + 1, closeIdx).trim();
      classHeaderRegex.lastIndex = closeIdx + 1;

      // class:名前(self, 型:引数, self.型:引数,,,) から self. 付きのフィールドだけ拾う
      const classParts = classParamsStr.split(',').map(s => s.trim()).filter(Boolean);
      const extraFields: TypedField[] = [];
      for (const p of classParts) {
        if (p === 'self') continue; // 目印なのでスキップ
        if (!p.startsWith('self.')) continue;
        const f = this.parseTypedField(p);
        if (f) extraFields.push(f);
      }

      // init(self.型:引数,,, | 値,値,,,) を "|" でパラメータ側とデフォルト側に分割
      const [initParamsRaw, initDefaultsRaw] = initParamsStr.split('|');
      const initParams = (initParamsRaw || '').split(',').map(s => s.trim()).filter(Boolean)
        .map(p => this.parseTypedField(p))
        .filter((f): f is TypedField => f !== null);
      const initDefaults = (initDefaultsRaw || '').split(',').map(s => s.trim()).filter(Boolean);

      const existing = this.storage.classes[className];
      const mergedFields = [...(existing?.fields || [])];
      for (const f of extraFields) {
        if (!mergedFields.some(mf => mf.name === f.name)) mergedFields.push(f);
      }
      for (const f of initParams) {
        if (!mergedFields.some(mf => mf.name === f.name)) mergedFields.push(f);
      }

      const classDef: ClassDef = {
        name: className,
        fields: mergedFields,
        initParams,
        initDefaults,
        initBody,
      };
      this.storage.classes[className] = classDef;
    }

    // set:desk(名前, 型:引数, 型:引数, ,,,) — 型付きデスク・スキーマ宣言（型検証に使う軽量デスク宣言）
    const setDeskRegex = /set:desk\(([^)]*)\)/g;
    let setDeskMatch;
    while ((setDeskMatch = setDeskRegex.exec(cleanCode)) !== null) {
      const parts = setDeskMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length === 0) continue;
      const deskName = parts[0];
      const fieldSchema = parts.slice(1)
        .map(p => this.parseTypedField(p))
        .filter((f): f is TypedField => f !== null);

      const existingDesk = this.storage.desks[deskName];
      if (existingDesk) {
        existingDesk.fieldSchema = fieldSchema;
      } else {
        this.storage.desks[deskName] = {
          argName: fieldSchema[0]?.name || null,
          drawers: {},
          outreturnTarget: null,
          fieldSchema,
        };
      }
    }

    // deskの解析
    const deskHeaderRegex = /desk:(\w+)\s*\(([^)]*)\)\s*\{/g;
    let match;
    while ((match = deskHeaderRegex.exec(cleanCode)) !== null) {
      const [, deskName, argsStr] = match;
      const deskOpenIdx = match.index + match[0].length - 1;
      const deskCloseIdx = this.findMatchingBrace(cleanCode, deskOpenIdx);
      if (deskCloseIdx === -1) continue;
      const deskBody = cleanCode.slice(deskOpenIdx + 1, deskCloseIdx);
      deskHeaderRegex.lastIndex = deskCloseIdx + 1;

      const args = argsStr.split(/\s+/).filter(Boolean); 
      const argName = args.length > 1 ? args[1] : (args[0] || null); 

      const drawerHeaderRegex = /drawer:(\w+)\s*\(([^)]*)\)\s*\{/g;
      let drawerMatch;
      const drawers: Record<string, Drawer> = {};

      while ((drawerMatch = drawerHeaderRegex.exec(deskBody)) !== null) {
        const [, drawerName] = drawerMatch;
        const drawerOpenIdx = drawerMatch.index + drawerMatch[0].length - 1;
        const drawerCloseIdx = this.findMatchingBrace(deskBody, drawerOpenIdx);
        if (drawerCloseIdx === -1) continue;
        const drawerBody = deskBody.slice(drawerOpenIdx + 1, drawerCloseIdx);
        drawerHeaderRegex.lastIndex = drawerCloseIdx + 1;

        const varLines = drawerBody.split("\n");
        const hostVariables: Record<string, HostVariable> = {};

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

        const inreturnHeaderRegex = /inreturn:(\w+)\s*\{/g;
        let inreturnMatch;
        const inreturns: Record<string, string> = {};
        while ((inreturnMatch = inreturnHeaderRegex.exec(drawerBody)) !== null) {
          const [, retName] = inreturnMatch;
          const retOpenIdx = inreturnMatch.index + inreturnMatch[0].length - 1;
          const retCloseIdx = this.findMatchingBrace(drawerBody, retOpenIdx);
          if (retCloseIdx === -1) continue;
          const retContent = drawerBody.slice(retOpenIdx + 1, retCloseIdx);
          inreturns[retName] = retContent.trim();
          inreturnHeaderRegex.lastIndex = retCloseIdx + 1;
        }

        drawers[drawerName] = { hostVariables, inreturns };
      }

      const outreturnHeaderMatch = deskBody.match(/outreturn\s*\{/);
      let outreturnTarget: string | null = null;
      if (outreturnHeaderMatch && outreturnHeaderMatch.index !== undefined) {
        const outOpenIdx = outreturnHeaderMatch.index + outreturnHeaderMatch[0].length - 1;
        const outCloseIdx = this.findMatchingBrace(deskBody, outOpenIdx);
        if (outCloseIdx !== -1) {
          outreturnTarget = deskBody.slice(outOpenIdx + 1, outCloseIdx).trim();
        }
      }

      const existingDeskEntry = this.storage.desks[deskName];
      this.storage.desks[deskName] = {
        argName,
        drawers,
        outreturnTarget,
        fieldSchema: existingDeskEntry?.fieldSchema,
      };
    }
  }
}
