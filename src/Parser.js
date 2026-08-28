"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeskScriptParser = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class DeskScriptParser {
    storage;
    currentDir = '.';
    constructor(storage) {
        this.storage = storage;
    }
    // openIndex ( source[openIndex] === '{' ) に対応する閉じ括弧の位置を、
    // 入れ子（if/for/switch等）も正しく数えて探す
    findMatchingBrace(source, openIndex) {
        let depth = 0;
        for (let i = openIndex; i < source.length; i++) {
            if (source[i] === '{')
                depth++;
            else if (source[i] === '}') {
                depth--;
                if (depth === 0)
                    return i;
            }
        }
        return -1;
    }
    // "self.型:引数" / "型:引数" 形式のトークンを { type, name } へ変換する
    // (isSelf が true なら "self." を剥がした上で解析する。self.でない場合もそのまま解析可)
    parseTypedField(token) {
        let t = token.trim();
        if (t.startsWith('self.'))
            t = t.slice(5);
        const colonIdx = t.indexOf(':');
        if (colonIdx === -1)
            return null;
        const type = t.slice(0, colonIdx).trim();
        const name = t.slice(colonIdx + 1).trim();
        if (!type || !name)
            return null;
        return { type, name };
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
        // functionの解析（ヘッダーだけ正規表現で見つけ、本体は波括弧の深さを数えて対応する'}'まで取得する）
        const funcHeaderRegex = /function\s*:\s*(\w+)\s*\(([^)]*)\)\s*\{/g;
        let funcMatch;
        while ((funcMatch = funcHeaderRegex.exec(cleanCode)) !== null) {
            const [, funcName, paramsStr] = funcMatch;
            const openIdx = funcMatch.index + funcMatch[0].length - 1;
            const closeIdx = this.findMatchingBrace(cleanCode, openIdx);
            if (closeIdx === -1)
                continue;
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
            if (closeIdx === -1)
                continue;
            const body = cleanCode.slice(openIdx + 1, closeIdx).trim();
            timingHeaderRegex.lastIndex = closeIdx + 1;
            if (!this.storage.timingHooks[key])
                this.storage.timingHooks[key] = [];
            this.storage.timingHooks[key].push(body);
        }
        // object:名前(type=global|host|null){ フィールド定義 } — オブジェクトスキーマ宣言
        // フィールド行の書き方: 名前:型 / 名前:型:notnull / 名前:型:len[N] / 名前:型:re[正規表現]
        const objectSchemaRegex = /object:(\w+)\(\s*type\s*=\s*(global|host|null)\s*\)\s*\{/g;
        let objectSchemaMatch;
        while ((objectSchemaMatch = objectSchemaRegex.exec(cleanCode)) !== null) {
            const [, objName, scopeType] = objectSchemaMatch;
            const openIdx = objectSchemaMatch.index + objectSchemaMatch[0].length - 1;
            const closeIdx = this.findMatchingBrace(cleanCode, openIdx);
            if (closeIdx === -1)
                continue;
            const body = cleanCode.slice(openIdx + 1, closeIdx);
            objectSchemaRegex.lastIndex = closeIdx + 1;
            const fieldLineRegex = /^(\w+)\s*:\s*(\w+)(?:\s*:\s*(notnull|len\[(\d+)\]|re\[([\s\S]+)\]))?$/;
            const fields = [];
            for (let rawLine of body.split('\n')) {
                let line = rawLine.trim();
                const commentIdx = line.indexOf('//');
                if (commentIdx !== -1)
                    line = line.slice(0, commentIdx).trim();
                if (line === '')
                    continue;
                const fm = line.match(fieldLineRegex);
                if (!fm)
                    continue;
                const [, fieldName, fieldType, constraint, lenStr, reStr] = fm;
                fields.push({
                    name: fieldName,
                    type: fieldType,
                    notnull: constraint === 'notnull',
                    len: lenStr !== undefined ? parseInt(lenStr, 10) : null,
                    regexSource: reStr !== undefined ? reStr : null,
                });
            }
            this.storage.objectSchemas[objName] = {
                name: objName,
                scopeType: scopeType,
                fields,
            };
        }
        // set:class(名前, 型:引数, 型:引数, ,,,) — クラスのフィールド・スキーマ宣言
        const setClassRegex = /set:class\(([^)]*)\)/g;
        let setClassMatch;
        while ((setClassMatch = setClassRegex.exec(cleanCode)) !== null) {
            const parts = setClassMatch[1].split(',').map(s => s.trim()).filter(Boolean);
            if (parts.length === 0)
                continue;
            const className = parts[0];
            const fields = parts.slice(1)
                .map(p => this.parseTypedField(p))
                .filter((f) => f !== null);
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
            if (closeIdx === -1)
                continue;
            const initBody = cleanCode.slice(openIdx + 1, closeIdx).trim();
            classHeaderRegex.lastIndex = closeIdx + 1;
            // class:名前(self, 型:引数, self.型:引数,,,) から self. 付きのフィールドだけ拾う
            const classParts = classParamsStr.split(',').map(s => s.trim()).filter(Boolean);
            const extraFields = [];
            for (const p of classParts) {
                if (p === 'self')
                    continue; // 目印なのでスキップ
                if (!p.startsWith('self.'))
                    continue;
                const f = this.parseTypedField(p);
                if (f)
                    extraFields.push(f);
            }
            // init(self.型:引数,,, | 値,値,,,) を "|" でパラメータ側とデフォルト側に分割
            const [initParamsRaw, initDefaultsRaw] = initParamsStr.split('|');
            const initParams = (initParamsRaw || '').split(',').map(s => s.trim()).filter(Boolean)
                .map(p => this.parseTypedField(p))
                .filter((f) => f !== null);
            const initDefaults = (initDefaultsRaw || '').split(',').map(s => s.trim()).filter(Boolean);
            const existing = this.storage.classes[className];
            const mergedFields = [...(existing?.fields || [])];
            for (const f of extraFields) {
                if (!mergedFields.some(mf => mf.name === f.name))
                    mergedFields.push(f);
            }
            for (const f of initParams) {
                if (!mergedFields.some(mf => mf.name === f.name))
                    mergedFields.push(f);
            }
            const classDef = {
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
            if (parts.length === 0)
                continue;
            const deskName = parts[0];
            const fieldSchema = parts.slice(1)
                .map(p => this.parseTypedField(p))
                .filter((f) => f !== null);
            const existingDesk = this.storage.desks[deskName];
            if (existingDesk) {
                existingDesk.fieldSchema = fieldSchema;
            }
            else {
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
            if (deskCloseIdx === -1)
                continue;
            const deskBody = cleanCode.slice(deskOpenIdx + 1, deskCloseIdx);
            deskHeaderRegex.lastIndex = deskCloseIdx + 1;
            const args = argsStr.split(/\s+/).filter(Boolean);
            const argName = args.length > 1 ? args[1] : (args[0] || null);
            const drawerHeaderRegex = /drawer:(\w+)\s*\(([^)]*)\)\s*\{/g;
            let drawerMatch;
            const drawers = {};
            while ((drawerMatch = drawerHeaderRegex.exec(deskBody)) !== null) {
                const [, drawerName] = drawerMatch;
                const drawerOpenIdx = drawerMatch.index + drawerMatch[0].length - 1;
                const drawerCloseIdx = this.findMatchingBrace(deskBody, drawerOpenIdx);
                if (drawerCloseIdx === -1)
                    continue;
                const drawerBody = deskBody.slice(drawerOpenIdx + 1, drawerCloseIdx);
                drawerHeaderRegex.lastIndex = drawerCloseIdx + 1;
                // @object(name=名前) タグ — このdrawer直前に書かれていれば、オブジェクトスキーマと紐付ける
                const beforeDrawer = deskBody.slice(0, drawerMatch.index);
                const objectTagMatch = beforeDrawer.match(/@object\(\s*name\s*=\s*(\w+)\s*\)\s*$/);
                const objectBinding = objectTagMatch ? objectTagMatch[1] : null;
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
                const inreturnHeaderRegex = /inreturn:(\w+)\s*\{/g;
                let inreturnMatch;
                const inreturns = {};
                while ((inreturnMatch = inreturnHeaderRegex.exec(drawerBody)) !== null) {
                    const [, retName] = inreturnMatch;
                    const retOpenIdx = inreturnMatch.index + inreturnMatch[0].length - 1;
                    const retCloseIdx = this.findMatchingBrace(drawerBody, retOpenIdx);
                    if (retCloseIdx === -1)
                        continue;
                    const retContent = drawerBody.slice(retOpenIdx + 1, retCloseIdx);
                    inreturns[retName] = retContent.trim();
                    inreturnHeaderRegex.lastIndex = retCloseIdx + 1;
                }
                drawers[drawerName] = { hostVariables, inreturns, objectBinding };
            }
            const outreturnHeaderMatch = deskBody.match(/outreturn\s*\{/);
            let outreturnTarget = null;
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
        // set:object(desk名, [drawer1, drawer2,,,]) —
        // @object(name=desk名) を列挙した各drawerへ1つずつ手動で書く代わりに、
        // desk名と同名のobjectスキーマへの紐付けを一括で行う。
        // desk本体の解析が全部終わったこの時点で処理する（対象drawerが先に登録済みである必要があるため）。
        const setObjectRegex = /set:object\(\s*(\w+)\s*,\s*\[([^\]]*)\]\s*\)/g;
        let setObjectMatch;
        while ((setObjectMatch = setObjectRegex.exec(cleanCode)) !== null) {
            const [, deskName, drawerListRaw] = setObjectMatch;
            const drawerNames = drawerListRaw.split(',').map(d => d.trim()).filter(d => d !== '');
            const targetDesk = this.storage.desks[deskName];
            if (!targetDesk)
                continue;
            for (const dName of drawerNames) {
                if (targetDesk.drawers[dName]) {
                    targetDesk.drawers[dName].objectBinding = deskName;
                }
            }
        }
    }
}
exports.DeskScriptParser = DeskScriptParser;
