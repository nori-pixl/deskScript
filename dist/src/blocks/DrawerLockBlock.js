"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processDrawerTag = processDrawerTag;
exports.processLockUnlockStatements = processLockUnlockStatements;
exports.processUnlockDrawer = processUnlockDrawer;
/**
 * 1. lock:drawer(name){...} / unlock:drawer(name)  排他ロック付き引き出し
 *    @drawer(名前)                                  引き出しの目印タグ（出力には影響しない）
 *    名前.lock(type=drawer|desk, timing=now|desk:X.start|desk:X.end)
 *    名前.unlock(type=drawer|desk[, timing=...])
 */
// @drawer(名前) — このブロックは引き出し名前を指す、という目印タグ。実行に影響しないので取り除くだけ。
function processDrawerTag(content) {
    return content.replace(/@drawer\(\s*\w+\s*\)\s*/g, '');
}
// 名前.lock(type=drawer|desk, timing=...) / 名前.unlock(type=drawer|desk[, timing=...])
function processLockUnlockStatements(content, ctx) {
    let out = content;
    out = out.replace(/(\w+)\.lock\(\s*type\s*=\s*(drawer|desk)\s*,\s*timing\s*=\s*([\w:.]+)\s*\)/g, (_m, name, type, timing) => ctx.scheduleOrApplyLock(name, type, timing, true));
    out = out.replace(/(\w+)\.unlock\(\s*type\s*=\s*(drawer|desk)\s*(?:,\s*timing\s*=\s*([\w:.]+)\s*)?\)/g, (_m, name, type, timing) => ctx.scheduleOrApplyLock(name, type, timing || 'now', false));
    return out;
}
// lock:drawer(name){ ... } 本体の処理は src/blocks/NestableDispatcher.ts へ移設済み
// （ネスト順序バグの根本修正のため、if/for等と同じ統一ディスパッチャで扱う）
// unlock:drawer(name) 手動でのロック強制解除
function processUnlockDrawer(content, ctx) {
    const regex = /unlock:drawer\(([^)]+)\)/g;
    return content.replace(regex, (_match, nameRaw) => {
        const name = nameRaw.trim().replace(/^["']|["']$/g, '');
        const wasLocked = ctx.lockedDrawers.has(name);
        ctx.lockedDrawers.delete(name);
        const msg = wasLocked
            ? `[Unlock] 引き出し「${name}」のロックを強制解除しました。`
            : `[Unlock] 引き出し「${name}」はロックされていません。`;
        return JSON.stringify(msg);
    });
}
