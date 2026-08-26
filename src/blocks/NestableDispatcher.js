"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processNestableBlocks = processNestableBlocks;
const MAX_WHILE_ITERATIONS = 1000; // ★変更: 以前は5回で強制打ち切りだったが、
// @setin(name=名前, type=ctrl) を付ければ setin:名前.stop() で明示的に止められるようにしたため、
// 自動打ち切りの上限自体は「暴走防止の安全弁」として引き上げた（本当の無限は同期JSでは危険なため設けない）
// --- if(条件):true{...} elif(条件):true{...} else{...} ---
function processIfAt(out, m, hostScope, disScope, ctx) {
    const branches = [];
    let openIdx = m.index + m[0].length - 1;
    let closeIdx = ctx.findMatchingBrace(out, openIdx);
    if (closeIdx === -1)
        return null;
    branches.push({ condition: m[1], body: out.slice(openIdx + 1, closeIdx) });
    let cursor = closeIdx + 1;
    while (true) {
        const rest = out.slice(cursor);
        const elifMatch = rest.match(/^\s*elif\s*\(([^)]*)\)\s*:\s*true\s*\{/);
        if (!elifMatch)
            break;
        const elifOpenIdx = cursor + elifMatch[0].length - 1;
        const elifCloseIdx = ctx.findMatchingBrace(out, elifOpenIdx);
        if (elifCloseIdx === -1)
            break;
        branches.push({ condition: elifMatch[1], body: out.slice(elifOpenIdx + 1, elifCloseIdx) });
        cursor = elifCloseIdx + 1;
    }
    let elseBody = null;
    const elseMatch = out.slice(cursor).match(/^\s*else\s*\{/);
    if (elseMatch) {
        const elseOpenIdx = cursor + elseMatch[0].length - 1;
        const elseCloseIdx = ctx.findMatchingBrace(out, elseOpenIdx);
        if (elseCloseIdx !== -1) {
            elseBody = out.slice(elseOpenIdx + 1, elseCloseIdx);
            cursor = elseCloseIdx + 1;
        }
    }
    let output = '';
    let matched = false;
    for (const branch of branches) {
        const condResult = ctx.evaluator.evaluateExpression(branch.condition, hostScope, disScope);
        if (condResult === true || condResult === 'true') {
            output = ctx.runBody(branch.body.trim(), hostScope, disScope);
            matched = true;
            break;
        }
    }
    if (!matched && elseBody !== null) {
        output = ctx.runBody(elseBody.trim(), hostScope, disScope);
    }
    return { output, spanEnd: cursor - 1 };
}
// --- switch(対象):case("値"){...} case(...){...} default{...} ---
function processSwitchAt(out, m, hostScope, disScope, ctx) {
    const cases = [];
    const rawFirstValue = m[2].trim();
    const firstValue = rawFirstValue.startsWith('"') && rawFirstValue.endsWith('"') ? rawFirstValue.slice(1, -1) : rawFirstValue;
    let openIdx = m.index + m[0].length - 1;
    let closeIdx = ctx.findMatchingBrace(out, openIdx);
    if (closeIdx === -1)
        return null;
    cases.push({ value: firstValue, body: out.slice(openIdx + 1, closeIdx) });
    let cursor = closeIdx + 1;
    while (true) {
        const rest = out.slice(cursor);
        const caseMatch = rest.match(/^\s*case\s*\(([^)]*)\)\s*\{/);
        if (!caseMatch)
            break;
        const caseOpenIdx = cursor + caseMatch[0].length - 1;
        const caseCloseIdx = ctx.findMatchingBrace(out, caseOpenIdx);
        if (caseCloseIdx === -1)
            break;
        const rawValue = caseMatch[1].trim();
        const value = rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;
        cases.push({ value, body: out.slice(caseOpenIdx + 1, caseCloseIdx) });
        cursor = caseCloseIdx + 1;
    }
    let defaultBody = null;
    const defaultMatch = out.slice(cursor).match(/^\s*default\s*\{/);
    if (defaultMatch) {
        const defaultOpenIdx = cursor + defaultMatch[0].length - 1;
        const defaultCloseIdx = ctx.findMatchingBrace(out, defaultOpenIdx);
        if (defaultCloseIdx !== -1) {
            defaultBody = out.slice(defaultOpenIdx + 1, defaultCloseIdx);
            cursor = defaultCloseIdx + 1;
        }
    }
    const targetValue = ctx.evaluator.evaluateExpression(m[1], hostScope, disScope);
    let output = '';
    let matched = false;
    for (const c of cases) {
        if (String(targetValue) === c.value) {
            output = ctx.runBody(c.body.trim(), hostScope, disScope);
            matched = true;
            break;
        }
    }
    if (!matched && defaultBody !== null) {
        output = ctx.runBody(defaultBody.trim(), hostScope, disScope);
    }
    return { output, spanEnd: cursor - 1 };
}
// --- while(条件):true{...} （安全のため最大反復回数あり。@setinで名前を付ければsetin:名前.stop()で明示制御できる） ---
function processWhileAt(out, m, hostScope, disScope, ctx) {
    const controlName = m[1] || null;
    const condition = m[2];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = ctx.findMatchingBrace(out, openIdx);
    if (closeIdx === -1)
        return null;
    const body = out.slice(openIdx + 1, closeIdx).trim();
    const control = controlName ? ctx.getOrCreateControl(controlName) : null;
    if (control && control.deletedAs !== null) {
        const label = control.deletedAs === 'comp' ? '完全削除(comp)済み' : '削除中(leav)';
        return { output: `[Control] 「${controlName}」は${label}のため while は実行されません。`, spanEnd: closeIdx };
    }
    let output = '';
    let count = 0;
    while (count < MAX_WHILE_ITERATIONS) {
        if (control && control.stopped)
            break;
        const condResult = ctx.evaluator.evaluateExpression(condition, hostScope, disScope);
        if (!(condResult === true || condResult === 'true'))
            break;
        output += ctx.runBody(body, hostScope, disScope);
        count++;
    }
    if (count >= MAX_WHILE_ITERATIONS) {
        output += `\n[DeskScript Warning]: while条件が${MAX_WHILE_ITERATIONS}回を超えて真のままだったため、安全のため打ち切りました。\n`;
    }
    return { output, spanEnd: closeIdx };
}
// --- try{...} catch(dis.var:名前){...} end{...} ---
function processTryAt(out, m, hostScope, disScope, ctx) {
    const tryOpenIdx = m.index + m[0].length - 1;
    const tryCloseIdx = ctx.findMatchingBrace(out, tryOpenIdx);
    if (tryCloseIdx === -1)
        return null;
    const tryBody = out.slice(tryOpenIdx + 1, tryCloseIdx).trim();
    const afterTry = out.slice(tryCloseIdx + 1);
    const catchMatch = afterTry.match(/^\s*catch\s*\(\s*dis\.var\s*:\s*(\w+)\s*\)\s*\{/);
    if (!catchMatch)
        return null;
    const catchVarName = catchMatch[1];
    const catchOpenIdx = tryCloseIdx + 1 + catchMatch[0].length - 1;
    const catchCloseIdx = ctx.findMatchingBrace(out, catchOpenIdx);
    if (catchCloseIdx === -1)
        return null;
    const catchBody = out.slice(catchOpenIdx + 1, catchCloseIdx).trim();
    let cursor = catchCloseIdx + 1;
    let endBody = '';
    const endMatch = out.slice(catchCloseIdx + 1).match(/^\s*end\s*\{/);
    if (endMatch) {
        const endOpenIdx = catchCloseIdx + 1 + endMatch[0].length - 1;
        const endCloseIdx = ctx.findMatchingBrace(out, endOpenIdx);
        if (endCloseIdx !== -1) {
            endBody = out.slice(endOpenIdx + 1, endCloseIdx).trim();
            cursor = endCloseIdx + 1;
        }
    }
    let output = '';
    try {
        output += ctx.runBody(tryBody, hostScope, disScope, true); // strict=true: 評価失敗を本物の例外にする
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        output += ctx.runBody(catchBody, hostScope, { ...disScope, [catchVarName]: errorMessage });
    }
    if (endBody)
        output += ctx.runBody(endBody, hostScope, disScope);
    return { output, spanEnd: cursor - 1 };
}
// --- forever{...} （★構文変更: 条件引数は廃止。@setin(name=名前, type=ctrl) を直前に置くと
//     setin:名前.stop()/setin:名前.start()/setin:名前.delete()/setin:名前.add() で外部制御できる。
//     本当の無限ループは同期JSではハングするため、安全上限つきで実行する。
//     timing:forever.start{...} を先に発火してから本体ループに入るので、
//     そのフック内で setin:名前.stop() を呼べば、本体を一度も実行せずに止められる） ---
const FOREVER_SAFETY_CAP = 1000;
function processForeverAt(out, m, hostScope, disScope, ctx) {
    const controlName = m[1] || null;
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = ctx.findMatchingBrace(out, openIdx);
    if (closeIdx === -1)
        return null;
    const body = out.slice(openIdx + 1, closeIdx).trim();
    const control = controlName ? ctx.getOrCreateControl(controlName) : null;
    if (control && control.deletedAs !== null) {
        const label = control.deletedAs === 'comp' ? '完全削除(comp)済み' : '削除中(leav)';
        return { output: `[Control] 「${controlName}」は${label}のため forever は実行されません。`, spanEnd: closeIdx };
    }
    // forever.start フックを先に発火する。ここで setin:名前.stop() が呼ばれれば、
    // 下のループは条件チェックで即座に抜けるので、本体は一度も実行されない。
    let output = ctx.fireTimingHooks('forever.start', hostScope, disScope);
    let count = 0;
    while (count < FOREVER_SAFETY_CAP) {
        if (control && control.stopped)
            break;
        output += ctx.runBody(body, hostScope, disScope);
        count++;
    }
    if (count >= FOREVER_SAFETY_CAP && !(control && control.stopped)) {
        output += `\n[DeskScript Warning]: foreverが安全上限(${FOREVER_SAFETY_CAP}回)に達したため打ち切りました。無限ループはハングの原因になるため意図的な制限です。\n`;
    }
    output += ctx.fireTimingHooks('forever.end', hostScope, disScope);
    return { output, spanEnd: closeIdx };
}
// --- for(dis.var:名前 in ++1):N{...} end{...} ---
function processForAt(out, m, hostScope, _disScope, ctx) {
    const varName = m[1];
    const stepExpr = m[2];
    const maxLoops = parseInt(m[3], 10);
    const bodyOpenIdx = m.index + m[0].length - 1;
    const bodyCloseIdx = ctx.findMatchingBrace(out, bodyOpenIdx);
    if (bodyCloseIdx === -1)
        return null;
    const forBody = out.slice(bodyOpenIdx + 1, bodyCloseIdx).trim();
    let cursor = bodyCloseIdx + 1;
    let endBody = '';
    const endMatch = out.slice(bodyCloseIdx + 1).match(/^\s*end\s*\{/);
    if (endMatch) {
        const endOpenIdx = bodyCloseIdx + 1 + endMatch[0].length - 1;
        const endCloseIdx = ctx.findMatchingBrace(out, endOpenIdx);
        if (endCloseIdx !== -1) {
            endBody = out.slice(endOpenIdx + 1, endCloseIdx).trim();
            cursor = endCloseIdx + 1;
        }
    }
    const step = stepExpr.startsWith('--') ? -1 : 1;
    let currentVal = 1;
    let loopOutput = ctx.fireTimingHooks('for.start', hostScope, {});
    for (let l = 0; l < maxLoops; l++) {
        const iterDisScope = { [varName]: currentVal };
        loopOutput += ctx.runBody(forBody, hostScope, iterDisScope);
        currentVal += step;
    }
    loopOutput += ctx.fireTimingHooks('for.end', hostScope, {});
    const output = loopOutput + (endBody ? ctx.runBody(endBody, hostScope) : '');
    return { output, spanEnd: cursor - 1 };
}
// --- lock:drawer(名前){...} ---
function processLockDrawerAt(out, m, hostScope, disScope, ctx) {
    const drawerName = m[1].trim().replace(/^["']|["']$/g, '');
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = ctx.findMatchingBrace(out, openIdx);
    if (closeIdx === -1)
        return null;
    const body = out.slice(openIdx + 1, closeIdx);
    let output;
    if (ctx.lockedDrawers.has(drawerName)) {
        output = `[Lock Error] 引き出し「${drawerName}」は現在ロック中のため処理をスキップしました。`;
    }
    else {
        ctx.lockedDrawers.add(drawerName);
        output = ctx.runBody(body.trim(), hostScope, disScope);
        ctx.lockedDrawers.delete(drawerName);
    }
    return { output, spanEnd: closeIdx };
}
// --- intern:desk(名前, ttl=N|Ns){...} ---
function processInternDeskAt(out, m, hostScope, disScope, ctx) {
    const internName = m[1];
    const ttlExpr = m[2].trim();
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = ctx.findMatchingBrace(out, openIdx);
    if (closeIdx === -1)
        return null;
    const body = out.slice(openIdx + 1, closeIdx);
    let state = ctx.internStates.get(internName);
    if (!state) {
        state = { count: 0, firstCallAt: Date.now() };
        ctx.internStates.set(internName, state);
    }
    let expired;
    if (ttlExpr.endsWith('s')) {
        expired = (Date.now() - state.firstCallAt) / 1000 > parseFloat(ttlExpr.slice(0, -1));
    }
    else {
        expired = state.count >= parseInt(ttlExpr, 10);
    }
    let output;
    if (expired) {
        output = `[Intern Expired] 一時デスク「${internName}」は契約期間満了により消滅しました。`;
    }
    else {
        state.count++;
        output = ctx.runBody(body.trim(), hostScope, disScope);
    }
    return { output, spanEnd: closeIdx };
}
// --- stamp(式):approved{...} :rejected{...} ---
function processStampAt(out, m, hostScope, disScope, ctx) {
    const approvedOpenIdx = m.index + m[0].length - 1;
    const approvedCloseIdx = ctx.findMatchingBrace(out, approvedOpenIdx);
    if (approvedCloseIdx === -1)
        return null;
    const approvedBody = out.slice(approvedOpenIdx + 1, approvedCloseIdx);
    let spanEnd = approvedCloseIdx;
    let rejectedBody = null;
    const rejectedMatch = out.slice(approvedCloseIdx + 1).match(/^\s*:\s*rejected\s*\{/);
    if (rejectedMatch) {
        const rejectedOpenIdx = approvedCloseIdx + 1 + rejectedMatch[0].length - 1;
        const rejectedCloseIdx = ctx.findMatchingBrace(out, rejectedOpenIdx);
        if (rejectedCloseIdx !== -1) {
            rejectedBody = out.slice(rejectedOpenIdx + 1, rejectedCloseIdx);
            spanEnd = rejectedCloseIdx;
        }
    }
    const evaluated = ctx.evaluator.evaluateExpression(m[1].trim(), hostScope, disScope);
    const isApproved = evaluated === true || String(evaluated).trim() === 'approved' || evaluated === 1;
    let output = '';
    if (isApproved) {
        output = ctx.runBody(approvedBody.trim(), hostScope, disScope);
    }
    else if (rejectedBody !== null) {
        output = ctx.runBody(rejectedBody.trim(), hostScope, disScope);
    }
    return { output, spanEnd };
}
// --- shift:morning{...} shift:night{...} ---
function processShiftAt(out, m, _hostScope, _disScope, ctx) {
    let morningBody = null;
    let nightBody = null;
    let spanEnd;
    if (m[0].startsWith('shift:morning')) {
        const openIdx = m.index + m[0].length - 1;
        const closeIdx = ctx.findMatchingBrace(out, openIdx);
        if (closeIdx === -1)
            return null;
        morningBody = out.slice(openIdx + 1, closeIdx);
        spanEnd = closeIdx;
        const nightMatch = out.slice(closeIdx + 1).match(/^\s*shift:night\s*\{/);
        if (nightMatch) {
            const nightOpenIdx = closeIdx + 1 + nightMatch[0].length - 1;
            const nightCloseIdx = ctx.findMatchingBrace(out, nightOpenIdx);
            if (nightCloseIdx !== -1) {
                nightBody = out.slice(nightOpenIdx + 1, nightCloseIdx);
                spanEnd = nightCloseIdx;
            }
        }
    }
    else {
        const openIdx = m.index + m[0].length - 1;
        const closeIdx = ctx.findMatchingBrace(out, openIdx);
        if (closeIdx === -1)
            return null;
        nightBody = out.slice(openIdx + 1, closeIdx);
        spanEnd = closeIdx;
    }
    const hour = new Date().getHours();
    const isMorning = hour >= 6 && hour < 18;
    const chosenBody = isMorning ? morningBody : nightBody;
    const output = chosenBody !== null ? ctx.runBody(chosenBody.trim(), {}, {}) : '';
    return { output, spanEnd };
}
const DETECTORS = [
    { regex: /if\s*\(([^)]*)\)\s*:\s*true\s*\{/, processAt: processIfAt },
    { regex: /switch\s*\(([^)]*)\)\s*:\s*case\s*\(([^)]*)\)\s*\{/, processAt: processSwitchAt },
    // ★変更: while/forever は直前に @setin(name=名前, type=ctrl) を書けるようになった。
    // 正規表現の先頭で任意マッチにしているので、@setinが無い場合は今まで通り動く。
    { regex: /(?:@setin\(\s*name\s*=\s*(\w+)\s*,\s*type\s*=\s*ctrl\s*\)\s*)?while\s*\(([^)]*)\)\s*:\s*true\s*\{/, processAt: processWhileAt },
    { regex: /try\s*\{/, processAt: processTryAt },
    // ★構文変更: forever(条件) → forever（引数なし）。@setinで名前を付けて外部制御する設計に変更。
    { regex: /(?:@setin\(\s*name\s*=\s*(\w+)\s*,\s*type\s*=\s*ctrl\s*\)\s*)?forever\s*\{/, processAt: processForeverAt },
    { regex: /for\s*\(dis\.var\s*:\s*(\w+)\s+in\s+([\+\-\d]+)\)\s*:\s*(\d+)\s*\{/, processAt: processForAt },
    { regex: /lock:drawer\(([^)]*)\)\s*\{/, processAt: processLockDrawerAt },
    { regex: /intern:desk\(\s*(\w+)\s*,\s*ttl\s*=\s*([^\)]+)\)\s*\{/, processAt: processInternDeskAt },
    { regex: /stamp\(([^)]*)\)\s*:\s*approved\s*\{/, processAt: processStampAt },
    { regex: /shift:morning\s*\{|shift:night\s*\{/, processAt: processShiftAt },
];
// content中で最も左（外側）にある対象構文から順に処理する
function processNestableBlocks(content, hostScope, disScope, ctx) {
    let out = content;
    let safety = 0;
    const SAFETY_LIMIT = 500; // 万一の無限ループ防止
    while (safety++ < SAFETY_LIMIT) {
        let best = null;
        for (const detector of DETECTORS) {
            const m = detector.regex.exec(out);
            if (m && (best === null || m.index < best.index)) {
                best = { index: m.index, match: m, detector };
            }
        }
        if (!best)
            break; // これ以上、対象構文は見つからない
        const result = best.detector.processAt(out, best.match, hostScope, disScope, ctx);
        if (!result) {
            // 構文が壊れていて閉じ括弧等が見つからない場合、無限ループ防止のため
            // このヘッダー部分だけを見なかったことにして次を探す
            out = out.slice(0, best.index) + '\u0000'.repeat(best.match[0].length) + out.slice(best.index + best.match[0].length);
            continue;
        }
        out = out.slice(0, best.index) + JSON.stringify(result.output) + out.slice(result.spanEnd + 1);
    }
    // 万一 \u0000 のダミー埋めが残っていたら取り除く
    return out.replace(/\u0000/g, '');
}
