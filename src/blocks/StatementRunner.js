// parseStatementsが作った「文の並び」を、実際に順番に実行して1つの文字列に組み立てる司令塔。
const IfBlock = require('./IfBlock');
const SwitchBlock = require('./SwitchBlock');
const WhileBlock = require('./WhileBlock');
const TryBlock = require('./TryBlock');
const ForeverBlock = require('./ForeverBlock');
const ForBlock = require('./ForBlock');

const RUNNERS = {
  if: IfBlock,
  switch: SwitchBlock,
  while: WhileBlock,
  try: TryBlock,
  forever: ForeverBlock,
  for: ForBlock,
};

// ctx = { hostScope, disScope, evaluator, strict }
// strict が true の間（tryの中）は、式の評価エラーを握りつぶさずに投げる。
function runStatements(nodes, ctx) {
  let output = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      output += ctx.evaluator.buildOutput(node.content, ctx.hostScope, ctx.disScope, {}, !!ctx.strict);
      continue;
    }
    const runner = RUNNERS[node.type];
    if (!runner) continue; // 未知のノード種別は無視する（エンジンを落とさない）
    output += runner.run(node, ctx, runStatements);
  }
  return output;
}

module.exports = { runStatements };
