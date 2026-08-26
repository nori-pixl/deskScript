"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlockContext = void 0;
/**
 * src/blocks/ 配下の各構文ブロックが共有する状態とヘルパー関数。
 * DeskExtensions.ts が1つ生成し、各ブロックの関数へ渡す。
 * （旧: DeskExtensions.ts 1ファイルに全部入っていたものを分割した際の共通基盤）
 */
class BlockContext {
    storage;
    evaluator;
    lockedDrawers = new Set();
    lockedDesks = new Set(); // 名前.lock(type=desk, ...) 用のデスク単位ロック
    internStates = new Map();
    mailbox = new Map();
    auditLog = [];
    // 名前.lock(type=drawer/desk, timing=desk:X.start/end) の遅延実行予約リスト
    scheduledActions = {};
    // timing:var.名前.change{...} 用の直近値
    lastVarValues = new Map();
    // class機能: 生成済みインスタンス
    instanceCounter = new Map();
    instances = new Map();
    // @set(name=名前, type=ctrl) で登録された名前付き制御ハンドル（forever/while用）
    namedControls = new Map();
    // 名前が未登録なら新規作成して返す。deletedAs='comp'なら永久に無効。
    getOrCreateControl(name) {
        let c = this.namedControls.get(name);
        if (!c) {
            c = { stopped: false, deletedAs: null, startArg: null };
            this.namedControls.set(name, c);
        }
        return c;
    }
    // object:名前(type=global){...} 用の共有ストレージ（objectName -> レコード）。
    // 同じ @object(name=X) タグを付けた複数drawerで共有される。
    objectStorageGlobal = new Map();
    // object:名前(type=host){...} 用のストレージ（`${objectName}::${drawerName}` -> レコード）。
    // 付けたdrawer単体だけの専用領域になる。
    objectStorageHost = new Map();
    // runDesk() がdrawerごとの処理に入るたびにセットする、現在実行中のdrawer名。
    // object(type=host)のストレージキー解決に使う。
    currentDrawerName = null;
    // meeting:join からデスクを実行するためのコールバック。
    // DeskExtensions側で runDesk 実体をセットする（循環import回避のため後から注入）。
    runDesk = () => '[DeskScript Error]: runDesk が未初期化です。';
    // ★バグ修正: 各ブロック（if/for/lock:drawer等）が自分の中身(body)を実行する際、
    // これまで evaluator.buildOutput() だけを呼んでいたため、body の中にさらに
    // 別の拡張構文（例: if の中の for、lock:drawer の中の lock:drawer）が
    // ネストしていると一切処理されず、生テキストのまま壊れた出力になっていた。
    // DeskExtensions側で applyExtensions 実体を注入し、body を必ずそこへ
    // 通してから buildOutput するようにする（runBody 経由で使う）。
    applyExtensions = (content) => content;
    constructor(storage, evaluator) {
        this.storage = storage;
        this.evaluator = evaluator;
    }
    // ★バグ修正: ブロックのbodyを実行するときは、必ずこの runBody を使う。
    // applyExtensions を先に通す(=ネストした構文も処理する) → buildOutput、の順。
    runBody(body, hostScope, disScope = {}, strict = false) {
        const expanded = this.applyExtensions(body, hostScope, disScope);
        return this.evaluator.buildOutput(expanded, hostScope, disScope, {}, strict);
    }
    // --- 波括弧 / 丸括弧の対応を、ネストを数えて正しく探す ---
    findMatchingBrace(source, openIndex, open = '{', close = '}') {
        let depth = 0;
        for (let i = openIndex; i < source.length; i++) {
            if (source[i] === open)
                depth++;
            else if (source[i] === close) {
                depth--;
                if (depth === 0)
                    return i;
            }
        }
        return -1;
    }
    // トップレベル（括弧の外）の区切り文字だけで分割する
    // ★修正2: 独自の甘い分割ロジックをやめ、Evaluatorの引用符/括弧を正しく
    // 見分けるトークナイザに統一する（meeting:join / outbox:send 等の
    // 引数分割で同種のバグが起きるのを防ぐ）。
    splitTopLevel(str, sep = ',') {
        if (sep === ',')
            return this.evaluator.splitTopLevelTokens(str);
        // カンマ以外の区切り文字が指定された場合のみ、従来の簡易実装にフォールバックする
        const parts = [];
        let depth = 0;
        let current = '';
        for (const ch of str) {
            if (ch === '(' || ch === '{')
                depth++;
            else if (ch === ')' || ch === '}')
                depth--;
            if (ch === sep && depth === 0) {
                parts.push(current);
                current = '';
            }
            else {
                current += ch;
            }
        }
        if (current.trim() !== '')
            parts.push(current);
        return parts;
    }
    resolveValue(token, hostScope, disScope) {
        const t = token.trim().replace(/^["']|["']$/g, '');
        if (disScope[t] !== undefined)
            return String(disScope[t]);
        if (hostScope[t] !== undefined)
            return String(hostScope[t]);
        if (this.storage.globalStorage[t] !== undefined)
            return String(this.storage.globalStorage[t]);
        return t; // 変数として見つからなければリテラルそのまま
    }
    // set:class / set:desk で宣言された型に対して、実際の値が合っているか簡易チェックする
    matchesType(value, type) {
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
    fireTimingHooks(key, hostScope, disScope) {
        const bodies = this.storage.timingHooks[key];
        if (!bodies || bodies.length === 0)
            return '';
        return bodies.map(b => this.runBody(b, hostScope, disScope)).join('\n') + '\n';
    }
    // 名前.lock(type=..., timing=desk:X.start/end) で予約されたロック/アンロックを、
    // 該当タイミング（"desk:X.start" 等）が来たときにまとめて実行する
    applyScheduledActions(key) {
        const actions = this.scheduledActions[key];
        if (!actions || actions.length === 0)
            return '';
        delete this.scheduledActions[key]; // 一度実行したら消費する
        const logs = [];
        for (const a of actions) {
            const set = a.targetType === 'drawer' ? this.lockedDrawers : this.lockedDesks;
            if (a.isLock)
                set.add(a.targetName);
            else
                set.delete(a.targetName);
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
    scheduleOrApplyLock(targetName, targetType, timing, isLock) {
        const targetSet = targetType === 'drawer' ? this.lockedDrawers : this.lockedDesks;
        const typeLabel = targetType === 'drawer' ? '引き出し' : 'デスク';
        const actionLabel = isLock ? 'ロック' : 'アンロック';
        if (timing === 'now') {
            if (isLock)
                targetSet.add(targetName);
            else
                targetSet.delete(targetName);
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
            if (!this.scheduledActions[key])
                this.scheduledActions[key] = [];
            this.scheduledActions[key].push({ targetName, targetType, isLock });
            const phaseLabel = phase === 'start' ? '開始時' : '終了時';
            return JSON.stringify(`[${isLock ? 'Lock' : 'Unlock'}予約] ${typeLabel}「${targetName}」の${actionLabel}を「${deskName}」の${phaseLabel}に予約しました。`);
        }
        return JSON.stringify(`[Lock Error] 不正なtiming指定です: ${timing}`);
    }
}
exports.BlockContext = BlockContext;
