"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processMeetingJoin = processMeetingJoin;
// 7. meeting:join(deskA("arg"), deskB("arg2")) 複数デスクの並列実行＆合流
function processMeetingJoin(content, ctx) {
    let out = content;
    const headerRegex = /meeting:join\(/;
    let m;
    while ((m = headerRegex.exec(out)) !== null) {
        const openParenIdx = m.index + m[0].length - 1;
        const closeParenIdx = ctx.findMatchingBrace(out, openParenIdx, '(', ')');
        if (closeParenIdx === -1)
            break;
        const argsStr = out.slice(openParenIdx + 1, closeParenIdx);
        const calls = ctx.splitTopLevel(argsStr, ',');
        const results = [];
        for (const call of calls) {
            const callMatch = call.trim().match(/^(\w+)\(([^)]*)\)$/);
            if (!callMatch)
                continue;
            const [, subDeskName, subArgRaw] = callMatch;
            const subArg = subArgRaw.trim().replace(/^["']|["']$/g, '');
            // ★修正4対応: runDeskの戻り値が {success, output, error} の構造化オブジェクトに
            // なったので、meeting:join からの利用側もそれに合わせて表示を組み立てる。
            const subResult = ctx.runDesk(subDeskName, subArg);
            const subOutput = subResult.success
                ? subResult.output
                : `[Error] ${subResult.error}${subResult.output ? `\n(途中経過: ${subResult.output})` : ''}`;
            results.push(`【${subDeskName}】\n${subOutput}`);
        }
        const output = `--- 会議室（meeting:join）合流結果 ---\n${results.join('\n---\n')}\n--- 会議終了 ---`;
        out = out.slice(0, m.index) + JSON.stringify(output) + out.slice(closeParenIdx + 1);
    }
    return out;
              }
