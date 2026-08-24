import { DeskScriptStorage } from './Storage';

export class DeskScriptEvaluator {
  constructor(private storage: DeskScriptStorage) {}

  // ★修正1(セキュリティ): new Function に渡す式の中に、サンドボックス脱出や
  // 危険なグローバルへアクセスしうる単語が含まれていないかチェックする。
  // 完全なサンドボックスではない（正規表現による簡易denylist）が、
  // process.mainModule.require(...) のような典型的な脱出経路は塞げる。
  // 注意: "global" は DSL自体が global.envType 等の正規構文として使うため対象外。
  // "process" 等は単語単位でマッチするので "global.process.exit(...)" のような
  // 迂回も引き続きブロックされる。
  private static readonly DANGEROUS_PATTERN =
    /\b(process|require|globalThis|Function|eval|constructor|__proto__|Proxy|Reflect|WebAssembly|import|Deno|Bun)\b/;

  // 式の中に眠る計算式や変数をJavaScriptのパワーを借りて安全に評価
  // strict=true の場合、評価に失敗したら警告文字列を返さず例外を投げ直す
  // （try{...}catch(...){...} が本物の例外として捕まえられるようにするため）
  public evaluateExpression(
    expr: string,
    hostScope: Record<string, any>,
    disScope: Record<string, any> = {},
    strict = false
  ): any {
    let contextExpr = expr;
    const allVars = { ...this.storage.globalStorage, ...hostScope, ...disScope };

    for (let key in allVars) {
      const val = typeof allVars[key] === 'string' ? `"${allVars[key]}"` : allVars[key];
      contextExpr = contextExpr.replace(new RegExp(`\\b${key}\\b`, 'g'), val);
    }

    // ★修正1(セキュリティ): 危険な可能性のあるパターンを含む式は実行前に拒否する
    if (DeskScriptEvaluator.DANGEROUS_PATTERN.test(contextExpr)) {
      const msg = `危険な可能性のある式のため評価を拒否しました: ${expr}`;
      if (strict) throw new Error(msg);
      return `[Security Blocked] ${msg}`;
    }

    const moduleKeys = Object.keys(this.storage.importedModules);
    const moduleValues = Object.values(this.storage.importedModules);

    try {
      return new Function(...moduleKeys, `"use strict"; return (${contextExpr});`)(...moduleValues);
    } catch (err) {
      if (strict) throw err;
      // ★修正3: 失敗を握りつぶして元の生テキストを返すのではなく、
      // 失敗したことが分かるようにプレフィックスを付けて返す。
      const message = err instanceof Error ? err.message : String(err);
      return `[Eval Warning] 式の評価に失敗しました: ${expr} (${message})`;
    }
  }

  // functionの呼び出し処理
  public callFunction(funcName: string, argsStr: string, hostScope: Record<string, any>, disScope: Record<string, any>): string {
    const fn = this.storage.functions[funcName];
    if (!fn) return `[Function Error: ${funcName} は未定義]`;
    const argValues = this.splitTopLevelTokens(argsStr).map(a => a.trim().replace(/^["']|["']$/g, ''));
    const funcScope: Record<string, any> = {};
    fn.paramNames.forEach((name, index) => {
      funcScope[name] = argValues[index] !== undefined ? argValues[index] : '';
    });
    return this.buildOutput(fn.body, hostScope, disScope, funcScope);
  }

  // ★修正2: content.split(",") は文字列リテラルや () {} [] の中のカンマも
  // 無条件に区切ってしまい、"a, b" のような引数や for ループの出力が壊れる
  // バグの温床だった。括弧の深さと引用符（" '）の中かどうかを見ながら、
  // トップレベルのカンマだけで分割する。
  public splitTopLevelTokens(str: string): string[] {
    const tokens: string[] = [];
    let depth = 0;
    let current = '';
    let inString: '"' | "'" | null = null;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];

      if (inString) {
        current += ch;
        if (ch === '\\' && i + 1 < str.length) {
          // エスケープシーケンスは次の1文字も無条件に取り込む（\" 等の誤検出防止）
          i++;
          current += str[i];
          continue;
        }
        if (ch === inString) inString = null;
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
    if (current.trim() !== '') tokens.push(current.trim());
    return tokens;
  }

  // 出力用文字列の組み立て
  // strict=true の場合、式の評価失敗を警告文字列にせず例外として投げ直す（try用）
  public buildOutput(
    content: string,
    hostScope: Record<string, any>,
    disScope: Record<string, any> = {},
    funcScope: Record<string, any> = {},
    strict = false
  ): string {
    let replacedContent = content;
    for (let fName in this.storage.functions) {
      const funcCallRegex = new RegExp(`${fName}\\s*\\(([^)]*)\\)`, 'g');
      replacedContent = replacedContent.replace(funcCallRegex, (_, args) => {
        return `"${this.callFunction(fName, args, hostScope, disScope)}"`;
      });
    }

    // ★修正2: split(",") をやめ、括弧/引用符の深さを見るトークナイザに置き換え
    const tokens = this.splitTopLevelTokens(replacedContent);
    let result = "";
    for (let token of tokens) {
      if (token.startsWith('"') && token.endsWith('"')) {
        result += token.slice(1, -1);
      } else if (funcScope[token] !== undefined) {
        result += funcScope[token];
      } else if (disScope[token] !== undefined) {
        result += disScope[token];
      } else if (hostScope[token] !== undefined) {
        result += hostScope[token];
      } else if (this.storage.globalStorage[token] !== undefined) {
        result += this.storage.globalStorage[token];
      } else if (token === '\\n' || token === '"\\n"') {
        result += '\n';
      } else {
        result += this.evaluateExpression(token, hostScope, disScope, strict);
      }
    }
    return result;
  }
}
