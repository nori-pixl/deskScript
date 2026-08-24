"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processShredVar = processShredVar;
exports.processVarDelete = processVarDelete;
/**
 * 2. shred:var(name)        使い捨て変数の即時強制廃棄
 *    var:名前.delete()       同上の別名構文。timing:var:名前.delete も発火する
 */
// shred:var(name) 使い捨て変数の即時強制廃棄
function processShredVar(content, hostScope, disScope) {
    const regex = /shred:var\(([^)]+)\)/g;
    return content.replace(regex, (_match, nameRaw) => {
        const name = nameRaw.trim();
        const existed = disScope[name] !== undefined || hostScope[name] !== undefined;
        delete disScope[name];
        delete hostScope[name];
        const msg = existed
            ? `[Shred] 変数「${name}」をメモリから即時抹消しました。`
            : `[Shred] 変数「${name}」は既に存在しません。`;
        return JSON.stringify(msg);
    });
}
// var:名前.delete() — shred:var の別名構文。削除時に timing:var:名前.delete を発火する
function processVarDelete(content, hostScope, disScope, ctx) {
    const regex = /var:(\w+)\.delete\(\)/g;
    return content.replace(regex, (_match, name) => {
        const existed = disScope[name] !== undefined || hostScope[name] !== undefined;
        delete disScope[name];
        delete hostScope[name];
        const hookOutput = ctx.fireTimingHooks(`var:${name}.delete`, hostScope, disScope);
        const msg = existed
            ? `[Delete] 変数「${name}」を削除しました。`
            : `[Delete] 変数「${name}」は存在しません。`;
        return JSON.stringify(msg + (hookOutput ? '\n' + hookOutput : ''));
    });
}
