# deskScript v2.2.3
# deskScript

DeskScriptは、オフィスにおける「デスク（机）」や「引き出し」の構造をメタファーとして取り入れた、堅牢で安全な制御フロー・プログラミング言語フレームワークです。
JavaScriptのエコシステムとシームレスに融合し、独自のスコープ管理と「使い捨て変数（Discard Variable）」の仕組みによって、メモリの安全性とバグのないクリーンな業務ロジックの構築を言語レベルで強制します。
純粋なJavaScript（Node.js標準機能のみ）で実装されているため、TypeScriptのビルド環境やコンパイラは不要です。

## 主な特徴

- 階層的な物理スコープ: プログラムを「デスク（desk）」と「引き出し（drawer）」に構造化し、データの有効範囲をカプセル化します。
- 3種類の明確な変数スコープ:
  - `global.`: プログラム全体、すべてのデスクと引き出しで共有される大域変数。
  - `host.`: 各引き出し（drawer）の内部にだけ隔離され、外部から隠蔽される局所変数。
  - `dis.var:`: ループや例外処理ブロックの内部でのみ生存し、処理を抜けた瞬間に自動消滅する「使い捨て（Discard）」変数。
- 終了の明示（endブロック）: ループや例外処理の終端を必ずブロックとして定義し、後続処理への予期せぬ影響を防ぎます。
- JavaScriptモジュール拡張: 設定ファイルによる動的な依存性注入（DI）により、既存のnpmライブラリをドットシンタックスでそのまま呼び出し可能です。

## プロジェクト構造

無の状態でパッケージ化（ライブラリ配布）する場合の最小構成は以下の通りです。

```text
my-deskscript-engine/
├── src/
│   ├── Storage.js          # グローバル・ホスト変数・worker・実行順アクションのメモリ管理デスク
│   ├── Parser.js           # .dsファイルを解体・再帰的に合流させる解析機
│   ├── Evaluator.js        # 式の評価、四則演算、ライブラリ関数の実行エンジン
│   └── blocks/              # 制御構文（if/switch/while/try/forever/for）を1つずつ担当するファイル群
│       ├── BraceUtils.js         # 括弧の対応を数える共通ユーティリティ
│       ├── StatementParser.js    # 生テキストを「文の並び」に解析する司令塔
│       ├── StatementRunner.js    # 「文の並び」を順番に実行する司令塔
│       ├── IfBlock.js            # if / elif / else
│       ├── SwitchBlock.js        # switch / case / default
│       ├── WhileBlock.js         # while（安全のため最大反復回数の上限つき）
│       ├── TryBlock.js           # try / catch / end
│       ├── ForeverBlock.js       # forever（安全のため1回だけ実行）
│       ├── ForBlock.js           # for / end
│       └── ReactTranspiler.js    # react:desk: を .jsx ソースコードに変換
├── index.js                # すべてのコンポーネントを結集するメインエントリ
└── package.json            # 依存関係定義および起動スクリプト
```

## 構文リファレンス

### 1. プロセス定義と外部ファイル結合
すべての`.ds`ファイルは、先頭行にプロセス宣言が必要です。また、別の`.ds`ファイルを芋づる式にマージして1つのオフィス環境を構築できます。

```text
myprocess:main.ds

load.file:core/functions.ds
load.file:desks/logic.ds
```

### 2. グローバル変数の宣言
プログラム全体で共通して使用する値を事前に定義します。

```text
set:var(string, global/all/envType) = "PRODUCTION"
set:var(float, global/all/taxRate) = 0.10
```

### 3. 関数（function）
最大10個以上の引数をコロンで繋いで型定義し、独立した共通処理を作成できます。

```text
function:buildReport(string title, int code, string status){
   "[Report] ", title, " (Code:", code, " / Status:", status, ")"
}
```

### 4. デスク（desk）と引き出し（drawer）
業務ロジックの基本単位です。引数はデスクへの入力値となり、`host.var`を用いて特定の引き出し内部へ安全にコピー（隔離）されます。

```text
desk:myCustomDesk(string inputData){
   drawer:processDrawer(action01){
      host.var.string:targetToken(id, inputData)
      
      inreturn:resultReturn{
         "処理対象のデータは ", targetToken, " です。"
      }
   }
   outreturn{
      resultReturn
   }
}
```

### 5. 条件分岐（if / elif / else）
条件式の後に波カッコを置き、さらに真偽値（bool型）のターゲットスイッチ（`:true` / `:false`）を埋め込む独自の条件制御を行います。これにより、否定演算子を使わない直感的な偽（false）判定が可能です。

```text
if(global.envType == "PRODUCTION"):true {
   "本番環境用の処理を実行します。"
}
elif(global.envType == "DEVELOP"):true {
   "開発環境用の処理を実行します。"
}
else {
   "未知の環境です。"
}
```

### 6. switch構文
対象の値に応じた条件分岐を行います。

```text
switch(targetToken):case("CriticalError"){
   "緊急デスクへ隔離します。"
}
case("NormalLog"){
   "通常ストレージへ格納します。"
}
default{
   "汎用タスクとして処理します。"
}
```

### 7. 安全なループ（for / end / while / forever）
- forループ: `dis.var`（使い捨て変数）を指定し、増減式（`++値`/`--値`）に沿って指定回数繰り返します。
- endブロック: ループ終了後に必ず実行され、このブロックへ入った時点で使い捨て変数はメモリ上から完全に抹消されます。
- whileループ: 条件が真である間、本体を繰り返します。**安全のため、最大5回で強制的に打ち切られます**（`1 < 2`のように恒久的に真となる条件を書いても無限ループしません）。
- foreverブロック: 名前のとおり「永久に動き続ける監視プロセス」を表しますが、このエンジンは同期処理で必ず終了する前提のため、**条件が真であれば本体を1回だけ実行**する安全な近似として動作します（無限ループはしません）。

```text
for(dis.var:step in ++1):3 {
   "現在のステップ: ", step, "\n"
}
end {
   "繰り返し処理が安全に着地しました。変数stepは消滅しました。"
}

while(1 < 2):true {
   "条件を満たしている間ループします。"
}

forever(true){
   "一番シンプルな永久ループで常時監視を行います。"
}
```

### 8. 例外処理（try - catch - end）
エラーが発生した際、`dis.var`として割り当てられたエラー変数へ安全にメッセージを格納し、捕獲します。終了時は`end`ブロックの着地を保証します。`try`の中身は「厳密モード」で評価されるため、未定義の関数や変数を参照するなど本物のエラーが起きると、`catch`が正しく発動します（`try`の外の通常の式評価はエラーを握りつぶして元の文字列を返す、より安全側の挙動のままです）。

```text
try {
   "通常の業務タスクを実行中..."
}
catch(dis.var:errorMessage) {
   "エラーを安全に捕獲しました。理由: ", errorMessage, "\n"
}
end {
   "デスクの安全が恒久的に保護されました。"
}
```

### 9. 外部JSライブラリ連携
同一ディレクトリに `import.ds.txt` を配置し、Node.js標準モジュールやnpmパッケージを列挙します。

**import.ds.txt の中身:**
```text
crypto
fs
path
```

`.ds`ファイル内からは、`ライブラリ名.関数名` のドットシンタックスで、JavaScriptネイティブの機能をラッパーなしで直接実行できます。

```text
"暗号化ハッシュ値: ", crypto.createHash("sha256").update(targetToken).digest("hex")
```

### 10. React UI統合（react:desk:）
`desk:`の代わりに`react:desk:`を使うと、DeskScriptの構造を実際に動くReactコンポーネントの`.jsx`ファイルへ変換します。このエンジン自体はNode.js上のテキスト処理系でブラウザではないため、その場で描画するのではなく「`.jsx`ファイルを生成する」という形でReact連携をサポートします。生成された`.jsx`は、実際のReactプロジェクトに配置して使います。

- `host.var`は自動的にReactの`useState`に変換されます。
- `"<input ... value='"` の直後にその`host.var`が続き、`"' ... />"` で閉じられている、という決まった書き方をした場合に限り、自動的に `value={変数}` と `onChange={e => set変数(e.target.value)}` を持つ「制御されたinput」に変換されます（それ以外の使い方は`{変数}`の単純な埋め込みになり、入力と自動連動はしません）。
- グローバル変数（`global.変数名`）は、生成されたコンポーネント単体では参照できないため、変換の時点で実際の値がリテラルとして埋め込まれます。

```text
react:desk:taxCalculatorDesk(string priceText){
   drawer:uiDrawer(action01){
      host.var.string:rawPrice(id, priceText)
      
      inreturn:render{
         "<div>",
            "<h1>税金計算画面</h1>",
            "<input type='number' value='", rawPrice, "' />",
            "<hr />",
            "<p>計算金額: ", rawPrice, " 円</p>",
            "<p>消費税 (10%): ", rawPrice * global.taxRate, " 円</p>",
         "</div>"
      }
   }
   outreturn{ render }
}
```

`node index.js`を実行すると、`.ds`ファイル内で定義された`react:desk:`はすべて自動的に`.jsx`ファイルとして書き出されます。JS側から個別に書き出したい場合は次のようにします。

```javascript
const outputPath = engine.exportReactComponent('taxCalculatorDesk', './output');
// -> ./output/taxCalculatorDesk.jsx が生成される
```

### 11. デスクの呼び出し（run）
定義した`desk`は、`run(...)`という構文で実際に実行できます。`.ds`ファイルの中に何個でも並べて書くことができ、**書かれた順番どおり**に実行されます。書き方は2種類あります。

```text
// ① 通常の呼び出し（担当worker指定なしのdeskに使う）
run(myCustomDesk("入力値"))

// ② worker認証つき呼び出し（担当workerが指定されているdeskに使う。12章参照）
run("myCustomDesk", "worker名", "パスワード")
```

### 12. Worker機能（deskを扱う働き者）
`desk`に「担当者（worker）」を割り当て、認証された働き者だけがそのデスクを操作できるようにする機能です。

```text
// workerを登録（名前とパスワード）
set:worker("tanaka", "pass1234")

// workerを雇用する（hireされるまでは、そのworkerが担当するdeskをrunできない）
hire("tanaka")

// 直前に @worker(...) を書くと、そのdeskの担当者になる
@worker("tanaka", "pass1234")
desk:secretDesk(string inputData){
   ...
}

// 担当workerの名前とパスワードを渡して呼び出す
run("secretDesk", "tanaka", "pass1234")

// workerを解雇する（本人のパスワードと一致しないと解雇できない）
// 解雇するとdeskを扱う人がいなくなるため、以降そのworkerではrunできなくなる。
// 再度 hire("tanaka") すれば、また雇用状態に戻せる。
dism("tanaka", "pass1234")
```

`hire` / `dism` / `run` は、`.ds`ファイル内に書かれた順番どおりに実行されます。そのため、`dism`より前の`run`は成功し、`dism`より後の`run`は失敗する、という時系列の挙動が正しく反映されます。

### 13. ログ出力（command.log.print）
`desk`を作らずその場で値を組み立てて出力できる、汎用的なログ出力コマンドです。文字列・グローバル変数・`function`の戻り値・`desk`の実行結果を、好きな数・好きな順番で自由に組み合わせられます。

```text
command.log.print("文字列", 変数名, 関数名(), desk名(引数), "文字列")

// 例
command.log.print("[起動] システム名: ", systemName)
command.log.print("レポート -> ", buildReport("起動チェック", 200, "正常"))
command.log.print("desk実行結果 -> ", myCustomDesk("test"))
```

- 変数は`set:var`で定義したグローバル変数を、`global.`を付けない裸の名前で指定します。
- `desk`を直接呼べるのは、担当worker（`@worker`）が指定されていないデスクだけです。worker認証が必要なデスクを呼ぼうとすると、エラーメッセージが表示されます。
- `hire` / `dism` / `run`と同じく、書かれた順番で実行されるため、`run`の間に挟んでデバッグ出力用に使うこともできます。

## 実行エンジンの組み込み方法

パッケージ化されたエンジン（`DeskScriptEngine`）をメインプログラムから呼び出す方法です。CommonJS（`require`）でそのまま読み込めます。

```javascript
const { DeskScriptEngine } = require('./deskscript');

const engine = new DeskScriptEngine();

// 初期化（外部ライブラリ設定、起点スクリプトのロードと自動ファイル分割合流）
if (engine.init('./import.ds.txt', './main.ds')) {
  // .ds ファイル内に書かれた hire/dism/run/command.log.print を、書かれた順番どおりに実行する
  engine.runAll();
}

// desk を1つだけ、JS側から直接呼び出して結果を受け取ることもできる
const result = engine.callDesk('myCustomDesk', '入力値');
console.log(result);
```

### 実行方法

```bash
node index.js
```

TypeScriptのビルドやトランスパイルは不要で、`npm install` すら必要ありません（Node.js標準機能のみで動作します）。npmパッケージを `import.ds.txt` から読み込みたい場合のみ、そのパッケージを別途 `npm install` してください。
