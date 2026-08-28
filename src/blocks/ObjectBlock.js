"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processObjectStatements = processObjectStatements;
exports.processObjectFieldAccess = processObjectFieldAccess;
/**
 * object:名前(type=global|host|null){ フィールド定義 } で宣言したスキーマに対する
 * インスタンス（レコード）の作成・参照・スキーマ自体の編集を行う構文。
 *
 *   object:名前.new(フィールド名:型=値,,,,,)   レコードを作成/上書き保存する
 *   object:名前.add(フィールド名:型)            スキーマへ新しいフィールド(行)を1つ追加する
 *   object:名前.delete(name=フィールド名)        スキーマから該当フィールド(行)を1つ削除する
 *   名前.フィールド名                          保存済みの値を参照する
 *
 * スコープ（object:名前(type=...)で決まる）:
 *   global … 同じ @object(name=名前) タグを付けた複数drawerで共有される共有メモリ
 *   host   … @object(name=名前) を付けた1つのdrawerだけの専用領域
 *   null   … スコープ指定なし。desk呼び出し1回のうちだけ有効なローカル値
 *
 * ★重要: new/add/delete を別々に regex.replace すると、同じ文中で
 * "object:X.add(...), object:X.new(...)" のように複数の操作が並んでいる場合に、
 * 実際に書かれた左→右の順ではなく処理タイプ単位の順で実行されてしまう
 * （ControlBlock.tsで踏んだのと同種のバグ）。これを避けるため3種類を
 * 1つの正規表現にまとめ、テキストに出てくる左から順に1つずつ処理する。
 */
const COMBINED_REGEX = /object:(\w+)\.(new\(([^)]*)\)|add\(\s*(\w+)\s*:\s*(\w+)\s*\)|delete\(\s*name\s*=\s*(\w+)\s*\))/;
function processObjectStatements(content, hostScope, disScope, ctx) {
    let out = content;
    let m;
    while ((m = COMBINED_REGEX.exec(out)) !== null) {
        const objName = m[1];
        const call = m[2];
        let message;
        if (call.startsWith('new(')) {
            message = doNew(objName, m[3] || '', hostScope, disScope, ctx);
        }
        else if (call.startsWith('add(')) {
            message = doAddField(objName, m[4], m[5], ctx);
        }
        else {
            message = doDeleteField(objName, m[6], ctx);
        }
        out = out.slice(0, m.index) + JSON.stringify(message) + out.slice(m.index + m[0].length);
    }
    return out;
}
function doNew(objName, argsRaw, hostScope, disScope, ctx) {
    const schema = ctx.storage.objectSchemas[objName];
    if (!schema) {
        return `[Object Error] object「${objName}」は未定義です。`;
    }
    // フィールド名:型=値 のトークンを、トップレベルのカンマだけで正しく分割する
    const tokens = ctx.evaluator.splitTopLevelTokens(argsRaw).map(t => t.trim()).filter(t => t !== '');
    const rawValues = {};
    for (const token of tokens) {
        const tm = token.match(/^(\w+)\s*:\s*(\w+)\s*=\s*([\s\S]+)$/);
        if (!tm)
            continue;
        const [, fieldName, , rawValue] = tm;
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
    return warnings.length > 0 ? `${summary}\n${warnings.join('\n')}` : summary;
}
// object:名前.add(フィールド名:型) — 既存スキーマへフィールド(行)を1つ追加する
function doAddField(objName, fieldName, fieldType, ctx) {
    const schema = ctx.storage.objectSchemas[objName];
    if (!schema) {
        return `[Object Error] object「${objName}」は未定義です。`;
    }
    if (schema.fields.some(f => f.name === fieldName)) {
        return `[Object Error] 「${objName}」には既に「${fieldName}」というフィールドがあります。`;
    }
    schema.fields.push({ name: fieldName, type: fieldType, notnull: false, len: null, regexSource: null });
    return `[Object] 「${objName}」にフィールド「${fieldName}:${fieldType}」を追加しました。`;
}
// object:名前.delete(name=フィールド名) — スキーマからフィールド(行)を1つ削除する（addの反対）
function doDeleteField(objName, fieldName, ctx) {
    const schema = ctx.storage.objectSchemas[objName];
    if (!schema) {
        return `[Object Error] object「${objName}」は未定義です。`;
    }
    const before = schema.fields.length;
    schema.fields = schema.fields.filter(f => f.name !== fieldName);
    if (schema.fields.length === before) {
        return `[Object Error] 「${objName}」に「${fieldName}」というフィールドはありません。`;
    }
    return `[Object] 「${objName}」からフィールド「${fieldName}」を削除しました。`;
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
