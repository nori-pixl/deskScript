# deskScript v0.3.6　開発バージョン
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

- 処理のまとまりを `desk`（デスク）、その中の実処理を `drawer`（引き出し）として書きます。デスクに引数を渡して呼び出すと、対応するdrawerの `inreturn` ブロックが評価され、`outreturn` で指定した結果が文字列として返ります。
- `set:var(型, global/スコープ/変数名) = 値` でプロセス内グローバル変数を定義できます。
- `function:名前(引数){...}` で再利用可能な処理を定義できます。
- 制御構文: `if(条件):true{...} elif(条件):true{...} else{...}` / `switch(対象):case("値"){...} default{...}` / `while(条件):true{...}` / `try{...} catch(dis.var:変数){...} end{...}` / `for(dis.var:名前 in ++1):N{...} end{...}` / `forever{...}`（後述）。
- `set:class(...)` / `class:名前(...), init(...){...}` / `new:名前(...)` でごく簡単なクラス（フィールド＋コンストラクタ）が使えます。
- `lock:drawer(名前){...}` / `unlock:drawer(名前)` / `名前.lock(type=drawer|desk, timing=now|desk:X.start|desk:X.end)` / `名前.unlock(...)` で、引き出しやデスク単位の排他ロックができます。
- `shred:var(名前)` / `var:名前.delete()` で変数を即座に破棄できます。
- `meeting:join(deskA("arg"), deskB("arg2"))` で複数デスクを呼び出し結果を合流させたり、`outbox:send(key, value)` / `inbox:receive(key)` でデスク間にメッセージを渡したりできます。
- `audit:trail(変数名)` で変数の変更履歴を記録できます。
- `timing:キー{...}` で各種イベント（デスク開始/終了、ロック/アンロック、変数変更/削除、forループ開始/終了、forever開始/終了）にフックできます。
- `HTML.document.〜` を `import.ds.txt` に `HTML` と書くだけで、ブラウザ実行時に本物のDOM操作（`document.getElementById(...)` など）がそのまま呼べます（後述のブラウザ実行の項を参照）。

### `@タグ(name=名前)` と `タグ:名前.method()` のペアリング規則

一部の構文は、`desk`/`drawer`の直前に付けるアノテーション（`@タグ(...)`）と、対応する操作構文（`タグ:名前.method()`）がセットになっています。今後この形式の構文が追加される場合も、このペアリングに揃えます。

| アノテーション | 対応する操作構文 | 用途 |
|---|---|---|
| `@object(name=名前)` | `object:名前.new(フィールド:型=値,,,)` / `名前.フィールド名` | オブジェクトスキーマのレコード作成・参照 |
| `@setin(name=名前, type=ctrl)` | `setin:名前.stop()` / `.start()` / `.delete(type=comp\|leav)` / `.add()` | `while`/`forever`の名前付き外部制御 |

（`set:` は `set:var` / `set:class` / `set:desk` と衝突するため、`@set` ではなく `@setin` / `setin:` にしています）

### オブジェクトスキーマ（`object:`）

`desk`の外側でスキーマを宣言します。

```
object:UserProfile(type=global){
   userName:string:notnull
   age:int
   code:string:len[4]
   mail:string:re[^[a-z]+@[a-z]+$]
}
```

- フィールドの書き方: `名前:型`（省略時はnull許容） / `名前:型:notnull`（必須） / `名前:型:len[N]`（最大文字数） / `名前:型:re[正規表現]`（パターン一致）
- `type=global`: 同じ `@object(name=名前)` タグを付けた**複数のdrawerで共有**される共有メモリ
- `type=host`: `@object(name=名前)` を付けた**1つのdrawer専用**の領域（他のdrawerからは見えない）
- `type=null`: スコープ指定なし。**そのdesk呼び出し1回の中だけ**有効なローカル値

使う側（drawer内）:

```
desk:saveProfile(string name){
   @object(name=UserProfile)
   drawer:d(action01){
      host.var.string:name(id, name)
      inreturn:r{
         object:UserProfile.new(userName:string=name, age:int=20, code:string=AB12, mail:string=abc@xyz),
         "登録名: ", UserProfile.userName, "\n"
      }
   }
   outreturn{ r }
}
```

`set:class`/`class:`/`new:`のクラス機能とは別物として共存しています（クラスは「その場でインスタンスを作って使い切る」もの、objectは「複数drawer間で値を持ち回る」ためのものというイメージです）。

### `forever{}` と `@setin` による名前付き制御

`forever`は以前は `forever(条件){...}` でしたが、**引数なしの `forever{...}` に構文変更**しました。本当の無限ループは同期JSではハングするため、安全上限（既定1000回）付きで実行されます。`@setin(name=名前, type=ctrl)` を直前に置くと、`timing:forever.start{...}` フックの中から `setin:名前.stop()` を呼んで、本体を一度も実行させずに止める、といった制御ができます。

```
desk:watchdogDemo(string dummy){
   drawer:d(action01){
      host.var.string:dummy(id, dummy)
      inreturn:r{
         @setin(name=watchdog, type=ctrl)
         forever{
            "ここは危険地帯。stopが効いていれば実行されない\n"
         }
      }
   }
   outreturn{ r }
}

timing:forever.start{
   setin:watchdog.stop()
}
```

`while(条件):true{...}` にも同じ `@setin(...)` を前置でき、安全上限は1000回（以前は5回）に引き上げています。`setin:名前.delete(type=comp)` で完全削除（二度と復元不可）、`type=leav` で一時削除（`setin:名前.add()` で復元可能）もできます。

## エンジン構成

このリポジトリには2つのエンジン実装が同梱されています。

| ディレクトリ | 内容 |
|---|---|
| `index.js` / `src/*.js`（ルート直下、`src/blocks/`にIf/Switch/While等の古い個別実装） | 最初期からある純JS実装 |
| 今回の作業で継続的に修正・機能追加しているTypeScript実装（コンパイル後は同じく`index.js`/`src/*.js`として配置） | `src/blocks/`に各構文が機能ごとに分割されている。詳細は下記 |

TS由来のエンジンの`src/blocks/`構成:

| ファイル | 内容 |
|---|---|
| `BlockContext.ts` | 全ブロック共有の状態＆ヘルパー（ロック状態、`@setin`制御ハンドル、objectストレージなど） |
| `NestableDispatcher.ts` | `if`/`switch`/`while`/`try`/`forever`/`for`/`lock:drawer`/`intern:desk`/`stamp`/`shift`を「テキスト上で一番左（外側）にあるものから」処理する統一ディスパッチャ。固定順で個別処理すると発生する「forの中のif」のようなネストバグの根本修正として導入 |
| `DrawerLockBlock.ts` | `unlock:drawer` / `@drawer`タグ / `名前.lock`・`unlock`文（`lock:drawer(){...}`本体はNestableDispatcher側） |
| `VarLifecycleBlock.ts` | `shred:var` / `var:名前.delete()` |
| `ControlBlock.ts` | `@setin`で名前を付けた`forever`/`while`の操作（`setin:名前.stop()`等） |
| `ObjectBlock.ts` | `object:名前.new(...)` / `名前.フィールド名` |
| `MeetingJoinBlock.ts` | `meeting:join(...)` |
| `MailboxBlock.ts` | `outbox:send` / `inbox:receive` |
| `AuditTrailBlock.ts` | `audit:trail(...)` |
| `ClassBlock.ts` | `set:class` / `class:` / `new:` / インスタンスのフィールド参照 |

## 応用法

- **CLIツールとして**: Node.jsから `index.js` を直接実行し、`.ds` ファイルに書いた業務フロー（承認ゲート `stamp`、監査ログ `audit:trail`、排他ロック `lock:drawer`、共有オブジェクト `object:` など）をそのままスクリプトとして走らせる、業務比喩ベースの自動化スクリプト置き場として使えます。
- **ブラウザ上での動的HTML操作として**: 同梱の `wnode.js` を `<script src="wnode.js" data-engine="./" data-base="./" data-main="main.ds" data-import="import.ds.txt"></script>` のようにHTMLへ埋め込むと、`main.ds` がブラウザ上でそのまま実行され、`HTML.document.〜` 経由でページのDOMを書き換えたり、クリックイベントを後付けしたりできます（`index.html` がそのままサンプルです）。
- **学習・実験用の小さな自作言語として**: 構文追加は `src/blocks/` に1機能1ファイルで追加し、ネストして使う構文なら `NestableDispatcher.ts` の `DETECTORS` に登録するだけなので、独自構文を試作する題材として扱いやすい設計です。

## 使うときの注意点

- **`eval`相当の仕組みで動いている点**: 式の評価は内部的に `new Function(...)` を使っています。危険なキーワード（`process` / `require` / `Function` / `eval` / `constructor` / `__proto__` など）を含む式は拒否するようにしていますが、これは簡易的なブロックリストであり、完全なサンドボックスではありません。**信頼できない第三者が書いた `.ds` を実行するのには向いていません。**自分（または信頼できるメンバー）が書いたスクリプトを動かす用途を想定してください。
- **カンマの扱い**: 出力の組み立ては「トップレベルのカンマ」で区切る方式です。文字列内・括弧内のカンマは区切りとして扱わないよう修正済みですが、複雑な式を書くときは括弧の対応やクォートの閉じ忘れに注意してください。
- **構文エラーは `[Eval Warning]` として出力に混ざります**: 失敗を黙って握りつぶさない設計にしたぶん、式を間違えるとその警告文がそのまま出力文字列の中に出てきます。デバッグ時の目印として使ってください。
- **`while` / `forever` に安全上限がある**: 無限ループでハングしないよう、既定で最大1000回まで実行すると強制的に打ち切られます。それより前に確実に止めたい場合は `@setin(name=名前, type=ctrl)` を付けて `setin:名前.stop()` を呼んでください。
- **状態がプロセス内に残り続ける**: `lock:drawer`のロック状態、`audit:trail`のログ、`class`のインスタンス、`object`の共有レコード、`@setin`の制御ハンドルなどは、明示的にクリアする手段がありません（`object`は`type=null`のみdesk呼び出しごとにリセットされます）。1回のスクリプト実行で完結させる用途を想定しており、サーバーなどで同じインスタンスを使い回し続けると溜まり続けます。
- **生成メッセージの中に実行可能な構文パターンを書かない**: 内部の確認メッセージ生成で、うっかり `名前.add()` のような実行可能構文をそのまま文言に含めると、次のスキャンで本物の呼び出しとして誤爆することがあります（実際に踏んだバグです）。独自の構文を追加する際も、生成する文字列の中に他の構文パターンを literal に含めないよう注意してください。
- **正規表現ベースの簡易パーサーである点**: 文字列の中に `{` や `}` を書くと、構文解析側の波括弧カウントを誤爆させることがあります。厳密なAST/トークナイザではないため、複雑な入れ子構造は事前に小さく試してから組み込むことをおすすめします。
- **`@object`/`@setin`タグの直後に対応する構文を書く必要がある**: `@object(name=X)` はその直後の `drawer:` に、`@setin(name=X, type=ctrl)` はその直後の `while`/`forever` に、それぞれ空白・改行を挟んで直接続けて書いてください。間に他の文が挟まると紐付きません。
