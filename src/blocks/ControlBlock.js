"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processControlStatements = processControlStatements;
/**
 * @setin(name=名前, type=ctrl) で forever{...} / while(...):true{...} に付けた
 * 名前付き制御ハンドルを操作する構文。
 *
 * ★命名統一: @object(name=名前) ⇔ object:名前.new(...) と同じパターンに揃えるため、
 * @set は @setin に、呼び出しも 名前.stop() ではなく setin:名前.stop() の形にした
 * （"set:" は set:var / set:class / set:desk と衝突するため setin にしている）。
 *
 *   setin:名前.stop()                  次回以降のループ実行を止める
 *   setin:名前.start()                 停止状態を解除する（type=comp で削除済みなら不可）
 *   setin:名前.start(引数)              ↑と同じ＋次回実行時に使う値を渡す
 *   setin:名前.delete(type=comp)        完全削除。以後この名前は二度と復元できない
 *   setin:名前.delete(type=leav)        一時的に無効化。setin:名前.add() で復元できる
 *   setin:名前.add()                    type=leav で削除された名前を復元する
 *
 * ★重要: 4つの操作を別々に regex.replace すると、同じ文中で
 * "setin:myctrl.delete(type=comp), setin:myctrl.start()" のように複数の操作が
 * 並んでいる場合に、実際に書かれた左→右の順ではなく「stopを全部処理→
 * startを全部処理→...」という処理タイプ単位の順で実行されてしまい、
 * 「削除したのに後のstartが成功する」といった不整合が起きる。
 * これを避けるため、4種類を1つの正規表現にまとめ、
 * テキストに出てくる左から順に1つずつ処理する。
 */
const COMBINED_REGEX = /setin:(\w+)\.(stop\(\)|start\(\s*([^)]*)\s*\)|delete\(\s*type\s*=\s*(comp|leav)\s*\)|add\(\))/;
function processControlStatements(content, ctx) {
    let out = content;
    let m;
    while ((m = COMBINED_REGEX.exec(out)) !== null) {
        const name = m[1];
        const call = m[2];
        const c = ctx.getOrCreateControl(name);
        let message;
        if (call === 'stop()') {
            if (c.deletedAs !== null) {
                message = `[Control Error] 「${name}」は削除済みのため停止できません。`;
            }
            else {
                c.stopped = true;
                message = `[Control] 「${name}」を停止しました。`;
            }
        }
        else if (call.startsWith('start(')) {
            const argRaw = (m[3] || '').trim().replace(/^["']|["']$/g, '');
            if (c.deletedAs === 'comp') {
                message = `[Control Error] 「${name}」は完全削除(comp)済みのため再開できません。`;
            }
            else if (c.deletedAs === 'leav') {
                message = `[Control Error] 「${name}」は削除中(leav)です。先にadd操作で復元してください。`;
            }
            else {
                c.stopped = false;
                c.startArg = argRaw !== '' ? argRaw : null;
                message = `[Control] 「${name}」を再開しました。${argRaw !== '' ? `(引数: ${argRaw})` : ''}`;
            }
        }
        else if (call.startsWith('delete(')) {
            const type = m[4];
            if (c.deletedAs === 'comp') {
                message = `[Control Error] 「${name}」は既に完全削除(comp)済みです。`;
            }
            else {
                c.deletedAs = type;
                c.stopped = true;
                // ★注意: メッセージ文中に "setin:名前.add()" のような実行可能な構文パターンを
                // そのまま書くと、次回のスキャンで本物の呼び出しとして誤って再実行されて
                // しまうバグがあったため、あえて実行構文に見えない言い回しにしている。
                const label = type === 'comp'
                    ? '完全削除(comp)しました。この構文は二度と使えません。'
                    : 'add操作（type=leav解除）で復元できます。';
                message = type === 'comp'
                    ? `[Control] 「${name}」を${label}`
                    : `[Control] 「${name}」を一時削除(leav)しました。${label}`;
            }
        }
        else {
            // add()
            if (c.deletedAs === 'comp') {
                message = `[Control Error] 「${name}」は完全削除(comp)済みのため復元できません。`;
            }
            else if (c.deletedAs === null) {
                message = `[Control] 「${name}」は削除されていません。`;
            }
            else {
                c.deletedAs = null;
                message = `[Control] 「${name}」を復元しました。`;
            }
        }
        out = out.slice(0, m.index) + JSON.stringify(message) + out.slice(m.index + m[0].length);
    }
    return out;
}
