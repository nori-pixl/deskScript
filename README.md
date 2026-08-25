# deskScript v0.2.1　開発バージョン
# deskScript

deskScriptは、「オフィスの引き出し（desk / drawer）」という比喩でプログラムの流れを表現する、実験的な自作スクリプト言語（DSL）です。ファイル拡張子は `.ds`。Node.js製のインタプリタで動きます。

```
desk:greetDesk(string name){
   drawer:greetDrawer(action01){
      host.var.string:userName(id, name)
      inreturn:greetReturn{
         "こんにちは、", userName, "さん！\n"
      }
   }
   outreturn{
      greetReturn
   }
}
```

## deskScriptとは

- 処理のまとまりを `desk`（デスク）、その中の実処理を `drawer`（引き出し）として書きます。デスクに引数を渡して呼び出す（≒関数呼び出し）と、対応するdrawerの `inreturn` ブロックが評価され、`outreturn` で指定した結果が文字列として返ります。
- `set:var(型, global/スコープ/変数名) = 値` でプロセス内グローバル変数を定義できます。
- `function:名前(引数){...}` で再利用可能な処理を定義できます。
- `if(条件):true{...} elif(条件):true{...} else{...}` / `switch(対象):case("値"){...} default{...}` / `while(条件):true{...}` / `try{...} catch(dis.var:変数){...} end{...}` / `forever(条件){...}` / `for(dis.var:名前 in ++1):N{...} end{...}` といった制御構文が使えます。
- `set:class(...)` / `class:名前(...), init(...){...}` / `new:名前(...)` でごく簡単なクラス（フィールド＋コンストラクタ）が使えます。
- `lock:drawer(名前){...}` / `unlock:drawer(名前)` / `名前.lock(type=drawer|desk, timing=now|desk:X.start|desk:X.end)` / `名前.unlock(...)` で、引き出しやデスク単位の排他ロックができます。
- `shred:var(名前)` / `var:名前.delete()` で変数を即座に破棄できます。
- `meeting:join(deskA("arg"), deskB("arg2"))` で複数デスクを呼び出し結果を合流させたり、`outbox:send(key, value)` / `inbox:receive(key)` でデスク間にメッセージを渡したりできます。
- `audit:trail(変数名)` で変数の変更履歴を記録できます。
- `timing:キー{...}` で各種イベント（デスク開始/終了、ロック/アンロック、変数変更/削除、forループ開始/終了）にフックできます。
- `HTML.document.〜` を `import.ds.txt` に `HTML` と書くだけで、ブラウザ実行時に本物のDOM操作（`document.getElementById(...)` など）がそのまま呼べます（後述のブラウザ実行の項を参照）。

このリポジトリには2つのエンジン実装が同梱されています。

| ディレクトリ | 内容 |
|---|---|
| `index.js` / `src/*.js`（ルート直下） | 最初期からある純JS実装 |
| `dist/`（`ts-src/` がソース） | 今回の作業で追加・修正したTypeScript実装のコンパイル済みJS。`src/blocks/` に各構文の実装を機能ごとに分割してあり、`if`/`switch`/`while`/`try`/`forever`/`for`/`lock:drawer`/`intern:desk`/`stamp`/`shift` は `NestableDispatcher.ts` が「テキスト上で一番外側にある構文から処理する」ことでネストを正しく扱う設計になっています |

## 応用法

- **CLIツールとして**: Node.jsから `index.js` を直接実行し、`.ds` ファイルに書いた業務フロー（承認ゲート `stamp`、監査ログ `audit:trail`、排他ロック `lock:drawer` など）をそのままスクリプトとして走らせる、業務比喩ベースの自動化スクリプト置き場として使えます。
- **ブラウザ上での動的HTML操作として**: 同梱の `wnode.js` を `<script src="wnode.js" data-engine="./dist/" data-base="./" data-main="main.ds" data-import="import.ds.txt"></script>` のようにHTMLへ埋め込むと、`main.ds` がブラウザ上でそのまま実行され、`HTML.document.〜` 経由でページのDOMを書き換えたり、クリックイベントを後付けしたりできます（`index.html` がそのままサンプルです）。
- **学習・実験用の小さな自作言語として**: 構文追加は `dist`側なら `ts-src/blocks/` に1機能1ファイルで追加し、`NestableDispatcher.ts` の `DETECTORS` に登録するだけなので、独自構文を試作する題材として扱いやすい設計です。

## 使うときの注意点

- **`eval`相当の仕組みで動いている点**: 式の評価は内部的に `new Function(...)` を使っています。危険なキーワード（`process` / `require` / `Function` / `eval` / `constructor` / `__proto__` など）を含む式は拒否するようにしていますが、これは簡易的なブロックリストであり、完全なサンドボックスではありません。**信頼できない第三者が書いた `.ds` を実行するのには向いていません。**自分（または信頼できるメンバー）が書いたスクリプトを動かす用途を想定してください。
- **カンマの扱い**: 出力の組み立ては「トップレベルのカンマ」で区切る方式です。文字列内・括弧内のカンマは区切りとして扱わないよう修正済みですが、複雑な式を書くときは括弧の対応やクォートの閉じ忘れに注意してください。
- **構文エラーは `[Eval Warning]` として出力に混ざります**: 失敗を黙って握りつぶさない設計にしたぶん、式を間違えるとその警告文がそのまま出力文字列の中に出てきます。デバッグ時の目印として使ってください。
- **`while` / `for` に上限がある**: 無限ループでハングしないよう、`while` は最大5回で強制的に打ち切られます（`forever` は「条件が真なら1回だけ実行」という近似です）。ループ回数に依存する処理は書けません。
- **状態がプロセス内に残り続ける**: `lock:drawer` のロック状態、`audit:trail` のログ、`class` のインスタンスなどは、明示的にクリアする手段がありません。1回のスクリプト実行で完結させる用途を想定しており、サーバーなどで同じインスタンスを使い回し続けると溜まり続けます。
- **正規表現ベースの簡易パーサーである点**: 文字列の中に `{` や `}` を書くと、構文解析側の波括弧カウントを誤爆させることがあります。厳密なAST/トークナイザではないため、複雑な入れ子構造は事前に小さく試してから組み込むことをおすすめします。
- **`dist/`のTS版と、ルート直下の純JS版は別実装**: 内部で同じ相対パス（`./Storage` など）を `require` しているため、混ぜて配置すると名前が衝突して壊れます。どちらか一方を使ってください（`wnode.js` の `data-engine` で切り替えます）。
