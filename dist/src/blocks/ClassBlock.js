"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processNewInstance = processNewInstance;
exports.processInstanceFieldAccess = processInstanceFieldAccess;
/**
 * class機能:
 *  set:class(名前, 型:引数,,,)                          クラスのフィールド・スキーマ宣言
 *  class:名前(self, 型:引数, self.型:引数,,,), init(self.型:引数,,,|値,値,,,){処理}
 *                                                        クラス本体 + コンストラクタ（"|" はデフォルト値の新構文）
 *  new:名前(値,値,,,)                                    インスタンス生成（式として使う）
 *  インスタンスID.フィールド名                            生成済みインスタンスのフィールド参照
 */
// a. new:名前(値,値,,,) インスタンス生成
function processNewInstance(content, hostScope, disScope, ctx) {
    const regex = /new:(\w+)\(([^)]*)\)/g;
    return content.replace(regex, (_match, className, argsRaw) => {
        const classDef = ctx.storage.classes[className];
        if (!classDef) {
            return JSON.stringify(`[Class Error] クラス「${className}」は未定義です。`);
        }
        const argTokens = ctx.splitTopLevel(argsRaw, ',').map(a => a.trim()).filter(a => a !== '');
        const resolvedArgs = argTokens.map(a => ctx.resolveValue(a, hostScope, disScope));
        const warnings = [];
        const fieldValues = {};
        // init(self.型:引数,,,|値,値,,,) の順に、呼び出し引数 -> 足りなければデフォルト値で埋める
        classDef.initParams.forEach((param, i) => {
            const rawDefault = classDef.initDefaults[i] !== undefined
                ? classDef.initDefaults[i].trim().replace(/^["']|["']$/g, '')
                : '';
            const value = resolvedArgs[i] !== undefined ? resolvedArgs[i] : rawDefault;
            if (value !== '' && !ctx.matchesType(String(value), param.type)) {
                warnings.push(`[set:class 型警告] 「${param.name}」は型「${param.type}」を期待していますが、値は「${value}」でした。`);
            }
            fieldValues[param.name] = value;
        });
        // initParams に含まれない set:class 由来のフィールドは空文字で初期化しておく
        for (const f of classDef.fields) {
            if (!(f.name in fieldValues))
                fieldValues[f.name] = '';
        }
        const count = (ctx.instanceCounter.get(className) || 0) + 1;
        ctx.instanceCounter.set(className, count);
        const instanceId = `${className}#${count}`;
        ctx.instances.set(instanceId, fieldValues);
        // initBody 実行用スコープ: "self.フィールド名" という文字通りのキーで値を渡す
        const selfScope = {};
        for (const key in fieldValues)
            selfScope[`self.${key}`] = fieldValues[key];
        const bodyOutput = classDef.initBody
            ? ctx.runBody(classDef.initBody, { ...hostScope, ...selfScope }, disScope)
            : '';
        const summary = `[Class] 「${className}」のインスタンス「${instanceId}」を生成しました。`;
        const combined = [summary, ...warnings, bodyOutput].filter(Boolean).join('\n');
        return JSON.stringify(combined);
    });
}
// b. インスタンスID.フィールド名 の参照解決
function processInstanceFieldAccess(content, ctx) {
    const regex = /(\w+#\d+)\.(\w+)/g;
    return content.replace(regex, (_match, instanceId, fieldName) => {
        const inst = ctx.instances.get(instanceId);
        if (!inst || !(fieldName in inst)) {
            return JSON.stringify(`[Class Error] 「${instanceId}」に「${fieldName}」は存在しません。`);
        }
        return JSON.stringify(String(inst[fieldName]));
    });
}
