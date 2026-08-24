import { DeskScriptStorage } from './Storage';
import { DeskScriptEvaluator } from './Evaluator';
import { BlockContext } from './blocks/BlockContext';
import * as DrawerLock from './blocks/DrawerLockBlock';
import * as VarLifecycle from './blocks/VarLifecycleBlock';
import * as MeetingJoin from './blocks/MeetingJoinBlock';
import * as Mailbox from './blocks/MailboxBlock';
import * as AuditTrail from './blocks/AuditTrailBlock';
import * as ClassBlock from './blocks/ClassBlock';
import { processNestableBlocks } from './blocks/NestableDispatcher';

/**
 * DeskScript 追加構文パック — オーケストレーター
 *
 * 実際の各構文の処理ロジックは src/blocks/ 配下のファイルに分割されている。
 *   src/blocks/BlockContext.ts        … 全ブロック共有の状態＆ヘルパー
 *   src/blocks/NestableDispatcher.ts  … ★if/switch/while/try/forever/for/lock:drawer/
 *                                        intern:desk/stamp/shift を「テキスト中で最も左
 *                                        （＝外側）にあるものから」処理する統一ディスパッチャ。
 *                                        固定パイプライン順だと「forの中のif」のような
 *                                        ネストが誤ったスコープで評価されるバグがあり、
 *                                        その根本修正として導入した（詳しくはファイル内コメント）。
 *   src/blocks/DrawerLockBlock.ts     … unlock:drawer / @drawer タグ / 名前.lock・unlock文
 *                                        （lock:drawer(){...} 本体はNestableDispatcher側）
 *   src/blocks/VarLifecycleBlock.ts   … shred:var / var:名前.delete()
 *   src/blocks/MeetingJoinBlock.ts    … meeting:join(...)
 *   src/blocks/MailboxBlock.ts        … outbox:send / inbox:receive
 *   src/blocks/AuditTrailBlock.ts     … audit:trail(...)
 *   src/blocks/ClassBlock.ts          … class機能（set:class / class: / new: / インスタンス.フィールド）
 *
 * このファイル自身は「applyExtensions() でどの順番に呼ぶか」と、
 * デスク実行の共通ロジック runDesk() だけを担当する。
 */
export class DeskScriptExtensions {
  private ctx: BlockContext;

  constructor(storage: DeskScriptStorage, evaluator: DeskScriptEvaluator) {
    this.ctx = new BlockContext(storage, evaluator);
    // meeting:join から desk を実行できるようにコールバックを注入する（循環import回避）
    this.ctx.runDesk = (deskName, argValue) => this.runDesk(deskName, argValue);
    // 各ブロックが自分のbodyを実行する際にネストした構文も処理できるよう、
    // applyExtensions 自体もコールバックとして注入する（循環import回避）
    this.ctx.applyExtensions = (content, hostScope, disScope) => this.applyExtensions(content, hostScope, disScope);
  }

  public getAuditLog(): string[] {
    return this.ctx.auditLog;
  }

  /**
   * 各拡張構文を処理し、それぞれの実行結果を文字列リテラルへ
   * 差し替えた content を返す。desk 実行前 (rawContent に対して) に呼ぶ。
   */
  public applyExtensions(content: string, hostScope: Record<string, any>, disScope: Record<string, any> = {}): string {
    let result = content;
    result = DrawerLock.processDrawerTag(result);
    result = DrawerLock.processUnlockDrawer(result, this.ctx);
    result = DrawerLock.processLockUnlockStatements(result, this.ctx);
    result = VarLifecycle.processVarDelete(result, hostScope, disScope, this.ctx);

    // ★根本バグ修正: if/switch/while/try/forever/for/lock:drawer/intern:desk/stamp/shift は
    // すべてここで「テキスト上で一番左（外側）にあるものから」まとめて処理する。
    // 個別に固定順で処理すると、たとえば for の中の if が for より先に処理されてしまい、
    // ループ変数が存在しないスコープで評価される、といったネストバグが起きるため。
    result = processNestableBlocks(result, hostScope, disScope, this.ctx);

    result = MeetingJoin.processMeetingJoin(result, this.ctx);
    result = Mailbox.processOutboxSend(result, hostScope, disScope, this.ctx);
    result = Mailbox.processInboxReceive(result, this.ctx);
    result = AuditTrail.processAuditTrail(result, hostScope, disScope, this.ctx);
    result = ClassBlock.processNewInstance(result, hostScope, disScope, this.ctx);
    result = ClassBlock.processInstanceFieldAccess(result, this.ctx);
    // shred:var は他の構文が hostScope/disScope の値を参照し終えた後、最後に処理する
    result = VarLifecycle.processShredVar(result, hostScope, disScope);
    return result;
  }

  // ===================================================================
  // desk 実行の共通ロジック（index.ts から移設。meeting:join からも再利用する）
  // ===================================================================
  public runDesk(deskName: string, argValue: string): string {
    const desk = this.ctx.storage.desks[deskName];
    if (!desk) return `[DeskScript Error]: desk "${deskName}" がありません。`;

    // 名前.lock(type=desk, timing=now) で即時ロックされていれば実行を拒否する
    if (this.ctx.lockedDesks.has(deskName)) {
      return `[Desk Lock Error] デスク「${deskName}」は現在ロック中のため実行できません。`;
    }

    // desk:${deskName}.start のタイミングで予約されたロック/アンロック実行 と timing:フック
    let startLog = '';
    startLog += this.ctx.applyScheduledActions(`desk:${deskName}.start`);
    startLog += this.ctx.fireTimingHooks(`desk:${deskName}.start`, {}, {});

    // set:desk(名前, 型:引数,,,) で型スキーマが宣言されていれば、最初の引数の型を軽く検証する
    let typeWarning = '';
    if (desk.fieldSchema && desk.fieldSchema.length > 0) {
      const primary = desk.fieldSchema[0];
      if (!this.ctx.matchesType(argValue, primary.type)) {
        typeWarning = `[set:desk 型警告] 「${deskName}」の引数「${primary.name}」は型「${primary.type}」を期待していますが、値は「${argValue}」でした。\n`;
      }
    }

    const deskArgs: Record<string, string> = {};
    if (desk.argName) deskArgs[desk.argName] = argValue;

    let outputText = '';
    let varChangeLog = '';

    for (const dName in desk.drawers) {
      const drawer = desk.drawers[dName];
      const hostScope: Record<string, any> = {};

      for (const vName in drawer.hostVariables) {
        const src = drawer.hostVariables[vName].source;
        const value = deskArgs[src] !== undefined ? deskArgs[src] : (this.ctx.storage.globalStorage[src] || src);
        hostScope[vName] = value;

        // timing:var.名前.change{...} — 前回実行時と値が変わっていれば発火する
        const prevValue = this.ctx.lastVarValues.get(vName);
        if (prevValue !== undefined && prevValue !== value) {
          varChangeLog += this.ctx.fireTimingHooks(`var.${vName}.change`, hostScope, {});
        }
        this.ctx.lastVarValues.set(vName, value);
      }

      if (desk.outreturnTarget && drawer.inreturns[desk.outreturnTarget]) {
        let rawContent = drawer.inreturns[desk.outreturnTarget];

        // 拡張構文（if/for/lockなど全部）を先に処理し、結果を文字列リテラルへ差し替える。
        rawContent = this.applyExtensions(rawContent, hostScope, {});
        outputText = this.ctx.evaluator.buildOutput(rawContent, hostScope);
      }
    }

    // desk:${deskName}.end のタイミングで予約されたロック/アンロック実行 と timing:フック
    let endLog = '';
    endLog += this.ctx.applyScheduledActions(`desk:${deskName}.end`);
    endLog += this.ctx.fireTimingHooks(`desk:${deskName}.end`, {}, {});

    return startLog + typeWarning + varChangeLog + outputText + endLog;
  }
}
