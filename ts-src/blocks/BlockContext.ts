import { DeskScriptStorage } from '../Storage';
import { DeskScriptEvaluator } from '../Evaluator';

export interface InternState {
  count: number;
  firstCallAt: number;
}

export type LockTargetType = 'drawer' | 'desk';

export interface ScheduledAction {
  targetName: string;
  targetType: LockTargetType;
  isLock: boolean;
}

/**
 * src/blocks/ 配下の各構文ブロックが共有する状態とヘルパー関数。
 * DeskExtensions.ts が1つ生成し、各ブロックの関数へ渡す。
 * （旧: DeskExtensions.ts 1ファイルに全部入っていたものを分割した際の共通基盤）
 */
export class BlockContext {
  public lockedDrawers: Set<string> = new Set();
  public lockedDesks: Set<string> = new Set(); // 名前.lock(type=desk, ...) 用のデスク単位ロック
  public internStates: Map<string, InternState> = new Map();
  public mailbox: Map<string, string> = new Map();
  public auditLog: string[] = [];

  // 名前.lock(type=drawer/desk, timing=desk:X.start/end) の遅延実行予約リスト
  public scheduledActions: Record<string, ScheduledAction[]> = {};

  // timing:var.名前.change{...} 用の直近値
  public lastVarValues: Map<string, any> = new Map();

  // class機能: 生成済みインスタンス
  public instanceCounter: Map<string, number> = new Map();
  public instances: Map<string, Record<string, any>> = new Map();

  // meeting:join からデスクを実行するためのコールバック。
  // DeskExtensions側で runDesk 実体をセットする（循環import回避のため後から注入）。
  public runDesk: (deskName: string, argValue: string) => string = () =>
    '[DeskScript Error]: runDesk が未初期化です。';

  // ★バグ修正: 各ブロック（if/for/lock:drawer等）が自分の中身(body)を実行する際、
  // これまで evaluator.buildOutput() だけを呼んでいたため、body の中にさらに
  // 別の拡張構文（例: if の中の for、lock:drawer の中の lock:drawer）が
  // ネストしていると一切処理されず、生テキストのまま壊れた出力になっていた。
  // DeskExtensions側で applyExtensions 実体を注入し、body を必ずそこへ
  // 通してから buildOutput するようにする（runBody 経由で使う）。
  public applyExtensions: (content: string, hostScope: Record<string, any>, disScope?: Record<string, any>) => string =
    (content) => content;

  constructor(
    public storage: DeskScriptStorage,
    public evaluator: DeskScriptEvaluator
  ) {}

  // ★バグ修正: ブロックのbodyを実行するときは、必ずこの runBody を使う。
  // applyExtensions を先に通す(=ネストした構文も処理する) → buildOutput、の順。
  public runBody(
    body: string,
    hostScope: Record<string, any>,
    disScope: Record<string, any> = {},
    strict = false
  ): string {
    const expanded = this.applyExtensions(body, hostScope, disScope);
    return this.evaluator.buildOutput(expanded, hostScope, disScope, {}, strict);
  }

  // --- 波括弧 / 丸括弧の対応を、ネストを数えて正しく探す ---
  public findMatchingBrace(source: string, openIndex: number, open = '{', close = '}'): number {
    let depth = 0;
    for (let i = openIndex; i < source.length; i++) {
      if (source[i] === open) depth++;
      else if (source[i] === close) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  // トップレベル（括弧の外）の区切り文字だけで分割する
  // ★修正2: 独自の甘い分割ロジックをやめ、Evaluatorの引用符/括弧を正しく
  // 見分けるトークナイザに統一する（meeting:join / outbox:send 等の
  // 引数分割で同種のバグが起きるのを防ぐ）。
  public splitTopLevel(str: string, sep = ','): string[] {
    if (sep === ',') return this.evaluator.splitTopLevelTokens(str);
    // カンマ以外の区切り文字が指定された場合のみ、従来の簡易実装にフォールバックする
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of str) {
      if (ch === '(' || ch === '{') depth++;
      else if (ch === ')' || ch === '}') depth--;
      if (ch === sep && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim() !== '') parts.push(current);
    return parts;
  }

  public resolveValue(token: string, hostScope: Record<string, any>, disScope: Record<string, any>): string {
    const t = token.trim().replace(/^["']|["']$/g, '');
    if (disScope[t] !== undefined) return String(disScope[t]);
    if (hostScope[t] !== undefined) return String(hostScope[t]);
    if (this.storage.globalStorage[t] !== undefined) return String(this.storage.globalStorage[t]);
    return t; // 変数として見つからなければリテラルそのまま
  }

  // set:class / set:desk で宣言された型に対して、実際の値が合っているか簡易チェックする
  public matchesType(value: string, type: string): boolean {
    const t = type.trim().toLowerCase();
    switch (t) {
      case 'int':
      case 'number':
      case 'float':
        return /^-?\d+(\.\d+)?$/.test(value.trim());
      case 'bool':
      case 'boolean':
        return value.trim() === 'true' || value.trim() === 'false';
      case 'string':
      default:
        return true;
    }
  }

  // timing:キー{処理} で登録済みのフック本体を実行し、出力をまとめて返す
  public fireTimingHooks(key: string, hostScope: Record<string, any>, disScope: Record<string, any>): string {
    const bodies = this.storage.timingHooks[key];
    if (!bodies || bodies.length === 0) return '';
    return bodies.map(b => this.runBody(b, hostScope, disScope)).join('\n') + '\n';
  }

  // 名前.lock(type=..., timing=desk:X.start/end) で予約されたロック/アンロックを、
  // 該当タイミング（"desk:X.start" 等）が来たときにまとめて実行する
  public applyScheduledActions(key: string): string {
    const actions = this.scheduledActions[key];
    if (!actions || actions.length === 0) return '';
    delete this.scheduledActions[key]; // 一度実行したら消費する
    const logs: string[] = [];
    for (const a of actions) {
      const set = a.targetType === 'drawer' ? this.lockedDrawers : this.lockedDesks;
      if (a.isLock) set.add(a.targetName); else set.delete(a.targetName);
      const typeLabel = a.targetType === 'drawer' ? '引き出し' : 'デスク';
      logs.push(`[${a.isLock ? 'Lock' : 'Unlock'}実行] ${typeLabel}「${a.targetName}」を${key}のタイミングで${a.isLock ? 'ロック' : 'アンロック'}しました。`);
      if (a.targetType === 'desk') {
        logs.push(this.fireTimingHooks(`desk:${a.targetName}.${a.isLock ? 'lock' : 'unlock'}`, {}, {}));
      }
    }
    return logs.filter(Boolean).join('\n') + '\n';
  }

  // 名前.lock(type=drawer|desk, timing=now|desk:X.start|desk:X.end) /
  // 名前.unlock(type=drawer|desk[, timing=...]) の実処理
  public scheduleOrApplyLock(targetName: string, targetType: LockTargetType, timing: string, isLock: boolean): string {
    const targetSet = targetType === 'drawer' ? this.lockedDrawers : this.lockedDesks;
    const typeLabel = targetType === 'drawer' ? '引き出し' : 'デスク';
    const actionLabel = isLock ? 'ロック' : 'アンロック';

    if (timing === 'now') {
      if (isLock) targetSet.add(targetName); else targetSet.delete(targetName);
      let hookOutput = '';
      if (targetType === 'desk') {
        hookOutput = this.fireTimingHooks(`desk:${targetName}.${isLock ? 'lock' : 'unlock'}`, {}, {});
      }
      return JSON.stringify(`[${isLock ? 'Lock' : 'Unlock'}] ${typeLabel}「${targetName}」を即時${actionLabel}しました。${hookOutput}`);
    }

    const timingMatch = timing.match(/^desk:(\w+)\.(start|end)$/);
    if (timingMatch) {
      const [, deskName, phase] = timingMatch;
      const key = `desk:${deskName}.${phase}`;
      if (!this.scheduledActions[key]) this.scheduledActions[key] = [];
      this.scheduledActions[key].push({ targetName, targetType, isLock });
      const phaseLabel = phase === 'start' ? '開始時' : '終了時';
      return JSON.stringify(`[${isLock ? 'Lock' : 'Unlock'}予約] ${typeLabel}「${targetName}」の${actionLabel}を「${deskName}」の${phaseLabel}に予約しました。`);
    }

    return JSON.stringify(`[Lock Error] 不正なtiming指定です: ${timing}`);
  }
}
