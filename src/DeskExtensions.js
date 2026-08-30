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
exports.DeskScriptExtensions = void 0;
const BlockContext_1 = require("./blocks/BlockContext");
const DrawerLock = __importStar(require("./blocks/DrawerLockBlock"));
const VarLifecycle = __importStar(require("./blocks/VarLifecycleBlock"));
const MeetingJoin = __importStar(require("./blocks/MeetingJoinBlock"));
const Mailbox = __importStar(require("./blocks/MailboxBlock"));
const AuditTrail = __importStar(require("./blocks/AuditTrailBlock"));
const ClassBlock = __importStar(require("./blocks/ClassBlock"));
const ControlBlock = __importStar(require("./blocks/ControlBlock"));
const ObjectBlock = __importStar(require("./blocks/ObjectBlock"));
const NestableDispatcher_1 = require("./blocks/NestableDispatcher");
/**
 * DeskScript 追加構文パック — オーケストレーター
 *
 * ★命名規則: @タグ(name=名前) と タグ:名前.method() は必ずペアにする
 * （例: @object(name=X) ⇔ object:X.new(...) / X.field、
 *      @setin(name=X, type=ctrl) ⇔ setin:X.stop()/.start()/.delete()/.add()）。
 * "set:" は set:var / set:class / set:desk と衝突するため @setin / setin: にしている。
 * 今後 @タグ を追加するときもこのペアリングに揃える。
 *
 * 実際の各構文の処理ロジックは src/blocks/ 配下のファイルに分割されている。
 *   src/blocks/BlockContext.ts        … 全ブロック共有の状態＆ヘルパー。
 *                                        ★修正3: reset() / executionDeadline を追加
 *   src/blocks/NestableDispatcher.ts  … if/switch/while/try/forever/for/lock:drawer/
 *                                        intern:desk/stamp/shift の統一ディスパッチャ。
 *                                        while/foreverは経過時間ベースで打ち切る（★修正3）
 *   src/blocks/DrawerLockBlock.ts     … unlock:drawer / @drawer タグ / 名前.lock・unlock文
 *   src/blocks/VarLifecycleBlock.ts   … shred:var / var:名前.delete()
 *   src/blocks/ControlBlock.ts        … setin:X.stop() 等
 *   src/blocks/ObjectBlock.ts         … object:X.new(...) / X.フィールド名
 *   src/blocks/MeetingJoinBlock.ts    … meeting:join(...)
 *   src/blocks/MailboxBlock.ts        … outbox:send / inbox:receive
 *   src/blocks/AuditTrailBlock.ts     … audit:trail(...)
 *   src/blocks/ClassBlock.ts          … class機能
 *
 * このファイル自身は「applyExtensions() でどの順番に呼ぶか」と、
 * デスク実行の共通ロジック runDesk() だけを担当する。
 */
class DeskScriptExtensions {
    ctx;
    constructor(storage, evaluator) {
        this.ctx = new BlockContext_1.BlockContext(storage, evaluator);
        this.ctx.runDesk = (deskName, argValue) => this.runDesk(deskName, argValue);
        this.ctx.applyExtensions = (content, hostScope, disScope) => this.applyExtensions(content, hostScope, disScope);
    }
    getAuditLog() {
        return this.ctx.auditLog;
    }
    // ★修正3(メモリ管理): 独立したスクリプト実行の間にこれを呼ぶと、
    // ロック状態・監査ログ・class/objectインスタンス・@setinハンドル等の
    // プロセス内に溜まり続ける状態を一括で破棄する。常駐サーバーでの使用を想定。
    reset() {
        this.ctx.reset();
    }
    applyExtensions(content, hostScope, disScope = {}) {
        let result = content;
        result = DrawerLock.processDrawerTag(result);
        result = DrawerLock.processUnlockDrawer(result, this.ctx);
        result = DrawerLock.processLockUnlockStatements(result, this.ctx);
        result = VarLifecycle.processVarDelete(result, hostScope, disScope, this.ctx);
        result = ControlBlock.processControlStatements(result, this.ctx);
        result = (0, NestableDispatcher_1.processNestableBlocks)(result, hostScope, disScope, this.ctx);
        result = MeetingJoin.processMeetingJoin(result, this.ctx);
        result = Mailbox.processOutboxSend(result, hostScope, disScope, this.ctx);
        result = Mailbox.processInboxReceive(result, this.ctx);
        result = AuditTrail.processAuditTrail(result, hostScope, disScope, this.ctx);
        result = ClassBlock.processNewInstance(result, hostScope, disScope, this.ctx);
        result = ClassBlock.processInstanceFieldAccess(result, this.ctx);
        result = ObjectBlock.processObjectStatements(result, hostScope, disScope, this.ctx);
        result = ObjectBlock.processObjectFieldAccess(result, disScope, this.ctx);
        result = VarLifecycle.processShredVar(result, hostScope, disScope);
        return result;
    }
    // ===================================================================
    // desk 実行の共通ロジック（index.ts から移設。meeting:join からも再利用する）
    //
    // ★修正4(エラーの構造化): 戻り値をプレーンな文字列から
    //   { success: boolean, output: string, error: string|null }
    // へ変更した。呼び出し側は「成功したか」「どこまで出力があるか」
    // 「失敗理由は何か」を明確に区別できる。
    // ===================================================================
    runDesk(deskName, argValue) {
        const desk = this.ctx.storage.desks[deskName];
        if (!desk) {
            return { success: false, output: '', error: `desk "${deskName}" がありません。` };
        }
        if (this.ctx.lockedDesks.has(deskName)) {
            return { success: false, output: '', error: `デスク「${deskName}」は現在ロック中のため実行できません。` };
        }
        // ★修正3(タイムアウト化): このdesk呼び出し全体に実行時間の締切を設定する。
        this.ctx.executionDeadline = Date.now() + this.ctx.executionTimeoutMs;
        let accumulated = '';
        try {
            accumulated += this.ctx.applyScheduledActions(`desk:${deskName}.start`);
            accumulated += this.ctx.fireTimingHooks(`desk:${deskName}.start`, {}, {});
            if (desk.fieldSchema && desk.fieldSchema.length > 0) {
                const primary = desk.fieldSchema[0];
                if (!this.ctx.matchesType(argValue, primary.type)) {
                    accumulated += `[set:desk 型警告] 「${deskName}」の引数「${primary.name}」は型「${primary.type}」を期待していますが、値は「${argValue}」でした。\n`;
                }
            }
            const deskArgs = {};
            if (desk.argName)
                deskArgs[desk.argName] = argValue;
            for (const dName in desk.drawers) {
                const drawer = desk.drawers[dName];
                const hostScope = {};
                this.ctx.currentDrawerName = dName;
                for (const vName in drawer.hostVariables) {
                    const src = drawer.hostVariables[vName].source;
                    const value = deskArgs[src] !== undefined ? deskArgs[src] : (this.ctx.storage.globalStorage[src] || src);
                    hostScope[vName] = value;
                    const prevValue = this.ctx.lastVarValues.get(vName);
                    if (prevValue !== undefined && prevValue !== value) {
                        accumulated += this.ctx.fireTimingHooks(`var.${vName}.change`, hostScope, {});
                    }
                    this.ctx.lastVarValues.set(vName, value);
                }
                if (desk.outreturnTarget && drawer.inreturns[desk.outreturnTarget]) {
                    let rawContent = drawer.inreturns[desk.outreturnTarget];
                    rawContent = this.applyExtensions(rawContent, hostScope, {});
                    accumulated += this.ctx.evaluator.buildOutput(rawContent, hostScope);
                }
            }
            accumulated += this.ctx.applyScheduledActions(`desk:${deskName}.end`);
            accumulated += this.ctx.fireTimingHooks(`desk:${deskName}.end`, {}, {});
            return { success: true, output: accumulated, error: null };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const partial = (err && typeof err.partialOutput === 'string') ? err.partialOutput : '';
            return { success: false, output: accumulated + partial, error: message };
        }
    }
}
exports.DeskScriptExtensions = DeskScriptExtensions;
