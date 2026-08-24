"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processAuditTrail = processAuditTrail;
// 9. audit:trail(name) 変数の変更履歴を自動記録
function processAuditTrail(content, hostScope, disScope, ctx) {
    const regex = /audit:trail\(([^)]+)\)/g;
    return content.replace(regex, (_match, nameRaw) => {
        const name = nameRaw.trim();
        const value = ctx.resolveValue(name, hostScope, disScope);
        const entry = `[${new Date().toISOString()}] ${name} = ${value}`;
        ctx.auditLog.push(entry);
        return JSON.stringify(`[Audit] 変数「${name}」の値「${value}」を監査ログに記録しました。`);
    });
}
