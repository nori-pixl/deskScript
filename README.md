# deskScript v1.7

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
│   ├── Storage.js          # グローバル・ホスト変数のメモリ管理デスク
│   ├── Parser.js           # .dsファイルを解体・再帰的に合流させる解析機
│   └── Evaluator.js        # 式の評価、四則演算、ライブラリ関数の実行エンジン
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
エラーが発生した際、`dis.var`として割り当てられたエラー変数へ安全にメッセージを格納し、捕獲します。終了時は`end`ブロックの着地を保証します。

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
DeskScriptの構造をそのままReactコンポーネントへトランスパイルします。`input`などのUI要素に値を打ち込むと、連動した`host`変数が書き換わり、`drawer`内のUIがブラウザの仮想DOMへ自動的に再描画（レンダリング）されます。

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

## 実行エンジンの組み込み方法

パッケージ化されたエンジン（`DeskScriptEngine`）をメインプログラムから呼び出す方法です。CommonJS（`require`）でそのまま読み込めます。

```javascript
const { DeskScriptEngine } = require('./deskscript');

const engine = new DeskScriptEngine();

// 初期化（外部ライブラリ設定、起点スクリプトのロードと自動ファイル分割合流）
if (engine.init('./import.ds.txt', './main.ds')) {
  // shell.log構文を文字列のまま投入してコマンドを実行
  engine.run('shell.log(load.desk:ultimateDesk("CriticalError"))');
}
```

### 実行方法

```bash
node index.js
```

TypeScriptのビルドやトランスパイルは不要で、`npm install` すら必要ありません（Node.js標準機能のみで動作します）。npmパッケージを `import.ds.txt` から読み込みたい場合のみ、そのパッケージを別途 `npm install` してください。
