class DeskScriptEvaluator {
  constructor(storage) {
    this.storage = storage;
  }

  // 式の中に眠る計算式や変数をJavaScriptのパワーを借りて安全に評価
  evaluateExpression(expr, hostScope, disScope = {}) {
    let contextExpr = expr;
    const allVars = { ...this.storage.globalStorage, ...hostScope, ...disScope };

    for (let key in allVars) {
      const val = typeof allVars[key] === 'string' ? `"${allVars[key]}"` : allVars[key];
      contextExpr = contextExpr.replace(new RegExp(`\\b${key}\\b`, 'g'), val);
    }

    const moduleKeys = Object.keys(this.storage.importedModules);
    const moduleValues = Object.values(this.storage.importedModules);

    try {
      return new Function(...moduleKeys, `return (${contextExpr});`)(...moduleValues);
    } catch {
      return expr;
    }
  }

  // functionの呼び出し処理
  callFunction(funcName, argsStr, hostScope, disScope) {
    const fn = this.storage.functions[funcName];
    if (!fn) return `[Function Error: ${funcName} は未定義]`;
    const argValues = argsStr.split(',').map(a => a.trim().replace(/^["']|["']$/g, ''));
    const funcScope = {};
    fn.paramNames.forEach((name, index) => {
      funcScope[name] = argValues[index] !== undefined ? argValues[index] : '';
    });
    return this.buildOutput(fn.body, hostScope, disScope, funcScope);
  }

  // 出力用文字列の組み立て
  buildOutput(content, hostScope, disScope = {}, funcScope = {}) {
    let replacedContent = content;
    for (let fName in this.storage.functions) {
      const funcCallRegex = new RegExp(`${fName}\\s*\\(([^)]*)\\)`, 'g');
      replacedContent = replacedContent.replace(funcCallRegex, (_, args) => {
        return `"${this.callFunction(fName, args, hostScope, disScope)}"`;
      });
    }

    const tokens = replacedContent.split(",").map(t => t.trim());
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
        result += this.evaluateExpression(token, hostScope, disScope);
      }
    }
    return result;
  }
}

module.exports = { DeskScriptEvaluator };
