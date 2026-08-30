"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeskScriptEvaluator = exports.DeskScriptRuntimeError = void 0;

// ★修正4(エラーの構造化): 評価に失敗したとき、文字列に "[Eval Warning]" を
// 埋め込んで握りつぶすのをやめ、専用の例外クラスとして投げる。
// buildOutput はここまで正常に組み立てられた出力を partialOutput として
// 例外に添付するので、呼び出し側（runDesk）は「どこまで実行できたか」を
// 失わずに失敗を検知できる。
class DeskScriptRuntimeError extends Error {
    partialOutput;
    constructor(message, partialOutput = '') {
        super(message);
        this.name = 'DeskScriptRuntimeError';
        this.partialOutput = partialOutput;
    }
}
exports.DeskScriptRuntimeError = DeskScriptRuntimeError;

// Node.js の vm モジュールを使えるかどうかを起動時に一度だけ判定する。
// ブラウザ実行(wnode.js)では vm が無いので、その場合は簡易denylist方式に
// フォールバックする（新しめの新Function実装は残しておく）。
// ★重要な限界: Node公式ドキュメントは
//   "The vm module is not a security mechanism. Do not use it to run untrusted code."
// と明記している。vm化はブラックリスト方式より脱出経路を塞げるが、
// これ自体は「絶対安全なサンドボックス」ではない。信頼できないコードの実行には
// 依然として向かない（真の隔離には別プロセス＋OSレベルの制限が必要）。
let vmModule = null;
try {
    vmModule = require('vm');
}
catch {
    vmModule = null;
}

class DeskScriptEvaluator {
    storage;
    vmContext = null;

    // 簡易denylist（vmが使えないブラウザ環境向けのフォールバック用）
    static DANGEROUS_PATTERN = /\b(process|require|globalThis|Function|eval|constructor|__proto__|Proxy|Reflect|WebAssembly|import|Deno|Bun)\b/;

    constructor(storage) {
        this.storage = storage;
        if (vmModule) {
            this._rebuildVmContext();
        }
    }

    // ★修正1(セキュリティ): import.ds.txtで明示的に許可されたライブラリと、
    // 最低限の安全な組み込みオブジェクトだけを持ち込んだ、隔離済みのvmコンテキストを作る。
    // （ホワイトリスト方式 — importedModulesに無いものはこの中に一切存在しない）
    //
    // ★二重の防御: importedModules 自体に process 等の危険なオブジェクトが
    // 紛れ込んでいた場合に備え（実際に Storage.js のバグでこれが起きていたことを
    // 確認済み）、ここでも既知の危険なキーは明示的に除外する。
    static FORBIDDEN_MODULE_KEYS = new Set(['process', 'require', 'module', 'exports', 'global', 'globalThis']);
    _rebuildVmContext() {
        const sandbox = Object.create(null);
        for (const key of Object.keys(this.storage.importedModules)) {
            if (DeskScriptEvaluator.FORBIDDEN_MODULE_KEYS.has(key)) {
                continue;
            }
            sandbox[key] = this.storage.importedModules[key];
        }
        sandbox.Math = Math;
        sandbox.JSON = JSON;
        sandbox.String = String;
        sandbox.Number = Number;
        sandbox.Boolean = Boolean;
        sandbox.Array = Array;
        sandbox.Date = Date;
        this.vmContext = vmModule.createContext(sandbox);
    }

    // 式の中に眠る計算式や変数をJavaScriptのパワーを借りて安全に評価
    evaluateExpression(expr, hostScope, disScope = {}) {
        let contextExpr = expr;
        const allVars = { ...this.storage.globalStorage, ...hostScope, ...disScope };
        for (let key in allVars) {
            const val = typeof allVars[key] === 'string' ? `"${allVars[key]}"` : allVars[key];
            contextExpr = contextExpr.replace(new RegExp(`\\b${key}\\b`, 'g'), val);
        }

        if (vmModule && this.vmContext) {
            // ★修正1+3: vmコンテキストでの隔離実行。timeoutは同期コードでも
            // 本当に強制中断できる（new Functionでは不可能だった機能）。
            try {
                return vmModule.runInContext(contextExpr, this.vmContext, { timeout: 500 });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                // ★修正4: 文字列に埋め込まず例外として投げる
                throw new DeskScriptRuntimeError(`式の評価に失敗しました: ${expr} (${message})`);
            }
        }

        // --- vmが使えない環境（ブラウザ）向けフォールバック ---
        if (DeskScriptEvaluator.DANGEROUS_PATTERN.test(contextExpr)) {
            throw new DeskScriptRuntimeError(`危険な可能性のある式のため評価を拒否しました: ${expr}`);
        }
        const moduleKeys = Object.keys(this.storage.importedModules);
        const moduleValues = Object.values(this.storage.importedModules);
        try {
            return new Function(...moduleKeys, `"use strict"; return (${contextExpr});`)(...moduleValues);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new DeskScriptRuntimeError(`式の評価に失敗しました: ${expr} (${message})`);
        }
    }

    // functionの呼び出し処理
    callFunction(funcName, argsStr, hostScope, disScope) {
        const fn = this.storage.functions[funcName];
        if (!fn)
            return `[Function Error: ${funcName} は未定義]`;
        const argValues = this.splitTopLevelTokens(argsStr).map(a => a.trim().replace(/^["']|["']$/g, ''));
        const funcScope = {};
        fn.paramNames.forEach((name, index) => {
            funcScope[name] = argValues[index] !== undefined ? argValues[index] : '';
        });
        return this.buildOutput(fn.body, hostScope, disScope, funcScope);
    }

    // トップレベルのカンマ（括弧・引用符の外）だけで分割する
    splitTopLevelTokens(str) {
        const tokens = [];
        let depth = 0;
        let current = '';
        let inString = null;
        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (inString) {
                current += ch;
                if (ch === '\\' && i + 1 < str.length) {
                    i++;
                    current += str[i];
                    continue;
                }
                if (ch === inString)
                    inString = null;
                continue;
            }
            if (ch === '"' || ch === "'") {
                inString = ch;
                current += ch;
                continue;
            }
            if (ch === '(' || ch === '{' || ch === '[') {
                depth++;
                current += ch;
                continue;
            }
            if (ch === ')' || ch === '}' || ch === ']') {
                depth--;
                current += ch;
                continue;
            }
            if (ch === ',' && depth === 0) {
                tokens.push(current.trim());
                current = '';
                continue;
            }
            current += ch;
        }
        if (current.trim() !== '')
            tokens.push(current.trim());
        return tokens;
    }

    // 出力用文字列の組み立て。
    // ★修正4: 途中のトークンで評価に失敗したら、それまでに組み立てられた
    // 出力(result)を例外へ添付してから投げ直す。呼び出し側は「どこまで
    // 実行できたか」を失わない。第5引数(strict)は過去互換のため残しているが、
    // 現在はすべての評価が常に例外を投げる設計になったため使われない。
    buildOutput(content, hostScope, disScope = {}, funcScope = {}, _strict = false) {
        let replacedContent = content;
        for (let fName in this.storage.functions) {
            const funcCallRegex = new RegExp(`${fName}\\s*\\(([^)]*)\\)`, 'g');
            replacedContent = replacedContent.replace(funcCallRegex, (_, args) => {
                return `"${this.callFunction(fName, args, hostScope, disScope)}"`;
            });
        }
        const tokens = this.splitTopLevelTokens(replacedContent);
        let result = "";
        for (let token of tokens) {
            try {
                if (token.startsWith('"') && token.endsWith('"')) {
                    result += token.slice(1, -1);
                    continue;
                }
                if (funcScope[token] !== undefined) {
                    result += funcScope[token];
                    continue;
                }
                if (disScope[token] !== undefined) {
                    result += disScope[token];
                    continue;
                }
                if (hostScope[token] !== undefined) {
                    result += hostScope[token];
                    continue;
                }
                if (this.storage.globalStorage[token] !== undefined) {
                    result += this.storage.globalStorage[token];
                    continue;
                }
                if (token === '\\n' || token === '"\\n"') {
                    result += '\n';
                    continue;
                }
                result += this.evaluateExpression(token, hostScope, disScope);
            }
            catch (err) {
                if (err instanceof DeskScriptRuntimeError) {
                    err.partialOutput = result;
                    throw err;
                }
                const message = err instanceof Error ? err.message : String(err);
                throw new DeskScriptRuntimeError(message, result);
            }
        }
        return result;
    }
}
exports.DeskScriptEvaluator = DeskScriptEvaluator;
