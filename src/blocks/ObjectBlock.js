"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processObjectNew = processObjectNew;
exports.processObjectFieldAccess = processObjectFieldAccess;
/**
 * object:名前(type=global|host|null){ フィールド定義 } で宣言したスキーマに対する
 * インスタンス（レコード）の作成・参照を行う構文。
 *
 *   object:名前.new(フィールド名:型=値,,,,,)   レコードを作成/上書き保存する
 *   名前.フィールド名                          保存済みの値を参照する
 *
 * スコープ（object:名前(type=...)で決まる）:
 *   global … 同じ @object(name=名前) タグを付けた複数drawerで共有される共有メモリ
 *   host   … @object(name=名前) を付けた1つのdrawerだけの専用領域
 *   null   … スコープ指定なし。desk呼び出し1回のうちだけ有効なローカル値
 */
// object:名前.new(フィールド名:型=値,,,,,)
function processObjectNew(content, hostScope, disScope, ctx) {
    const regex = /object:(\w+)\.new\(([^)]*)\)/g;
    return content.replace(regex, (_match, objName, argsRaw) => {
        const schema = ctx.storage.objectSchemas[objName];
        if (!schema) {
            return JSON.stringify(`[Object Error] object「${objName}」は未定義です。`);
        }
        // フィールド名:型=値 のトークンを、トップレベルのカンマだけで正しく分割する
        const tokens = ctx.evaluator.splitTopLevelTokens(argsRaw).map(t => t.trim()).filter(t => t !== '');
        const rawValues = {};
        for (const token of tokens) {
            const m = token.match(/^(\w+)\s*:\s*(\w+)\s*=\s*([\s\S]+)$/);
            if (!m)
                continue;
            const [, fieldName, , rawValue] = m;
            rawValues[fieldName] = ctx.resolveValue(rawValue.trim(), hostScope, disScope);
        }
        const warnings = [];
        const record = {};
        for (const field of schema.fields) {
            const v = rawValues[field.name];
            if (v === undefined || v === '') {
                if (field.notnull) {
                    warnings.push(`[Object 検証エラー] 「${field.name}」は notnull ですが値がありません。`);
                }
                record[field.name] = v ?? '';
                continue;
            }
            if (!ctx.matchesType(v, field.type)) {
                warnings.push(`[Object 型警告] 「${field.name}」は型「${field.type}」を期待していますが、値は「${v}」でした。`);
            }
            if (field.len !== null && v.length > field.len) {
                warnings.push(`[Object 検証エラー] 「${field.name}」は最大${field.len}文字ですが、実際は${v.length}文字でした。`);
            }
            if (field.regexSource !== null) {
                try {
                    const re = new RegExp(field.regexSource);
                    if (!re.test(v)) {
                        warnings.push(`[Object 検証エラー] 「${field.name}」が正規表現 ${field.regexSource} に一致しませんでした。`);
                    }
                }
                catch {
                    warnings.push(`[Object Error] 「${field.name}」の正規表現指定が不正です: ${field.regexSource}`);
                }
            }
            record[field.name] = v;
        }
        if (schema.scopeType === 'global') {
            ctx.objectStorageGlobal.set(objName, record);
        }
        else if (schema.scopeType === 'host') {
            const key = `${objName}::${ctx.currentDrawerName || '(unknown)'}`;
            ctx.objectStorageHost.set(key, record);
        }
        else {
            // null: このdesk呼び出しの中だけ有効なローカル値として disScope に埋め込む
            disScope[`__object_local_${objName}`] = record;
        }
        const summary = `[Object] 「${objName}」(${schema.scopeType})を保存しました。`;
        const message = warnings.length > 0 ? `${summary}\n${warnings.join('\n')}` : summary;
        return JSON.stringify(message);
    });
}
// 名前.フィールド名 の参照解決（objectスキーマとして登録されている名前だけを対象にする）
function processObjectFieldAccess(content, disScope, ctx) {
    const regex = /(\w+)\.(\w+)/g;
    return content.replace(regex, (fullMatch, objName, fieldName) => {
        const schema = ctx.storage.objectSchemas[objName];
        if (!schema)
            return fullMatch; // objectスキーマ名でなければ触らない（他の用途のドット参照を壊さない）
        let record;
        if (schema.scopeType === 'global') {
            record = ctx.objectStorageGlobal.get(objName);
        }
        else if (schema.scopeType === 'host') {
            record = ctx.objectStorageHost.get(`${objName}::${ctx.currentDrawerName || '(unknown)'}`);
        }
        else {
            record = disScope[`__object_local_${objName}`];
        }
        if (!record || !(fieldName in record)) {
            return JSON.stringify(`[Object Error] 「${objName}.${fieldName}」はまだ保存されていません。`);
        }
        return JSON.stringify(String(record[fieldName]));
    });
}
