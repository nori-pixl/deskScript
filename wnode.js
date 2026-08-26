/**
 * wnode.js
 * -----------------------------------------------------------------------
 * deskScript（https://github.com/nori-pixl/deskScript）を、Node.jsソースを
 * 一切書き換えずにブラウザ上で動かすためのローダー。
 *
 * 使い方（静的HTMLでも動的に生成したHTMLでもOK）:
 *   <script src="wnode.js"
 *           data-engine="./deskscript/"   ← index.js / src/ が置いてある場所
 *           data-base="./"                ← main.ds / import.ds.txt が置いてある場所
 *           data-main="main.ds"
 *           data-import="import.ds.txt"></script>
 *
 * これだけで、Node版と同じく
 *   const engine = new DeskScriptEngine();
 *   engine.init('./import.ds.txt', './main.ds');
 *   engine.runAll();
 * が index.js の末尾でそのまま走ります（console.logの出力はブラウザの開発者
 * コンソールに出ます）。
 *
 * .ds 側からJavaScriptのdocument（DOM）を触れるようにする方法:
 *   本家JSでは document.getElementById(...) と書きますが、deskScript側では
 *   構文を変えて HTML.document.〜 という書き方に統一しています（裸の document
 *   という名前は公開しません）。import.ds.txt に以下の1行を追加するだけです
 *   （crypto などと全く同じ書き方）。
 *
 *     HTML
 *
 *   すると .ds ファイル内から、これまで crypto.createHash(...) と書いていたのと
 *   同じ要領で、HTML.document.getElementById(...) のように document.系メソッドが
 *   そのまま（全メソッド）呼び出せます。
 *
 *   例:
 *     "更新結果: ", HTML.document.getElementById("app").tagName, "\n"
 *     HTML.document.querySelector("#app").innerText = "書き換えました"
 *
 *   ※ deskScriptの式評価は「トップレベルのカンマ」で引数を区切る簡易パーサーなので、
 *      1つの式の中に生のカンマを書かないでください
 *      （例: document.querySelector(".a, .b") はNG。").a"と".b"を分けて2回呼ぶなど）。
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  function findSelf() {
    if (document.currentScript) return document.currentScript;
    const scripts = document.getElementsByTagName("script");
    for (let i = scripts.length - 1; i >= 0; i--) {
      if (/wnode\.js(\?.*)?$/.test(scripts[i].src)) return scripts[i];
    }
    return scripts[scripts.length - 1];
  }

  const selfScript = findSelf();
  const data = selfScript ? selfScript.dataset : {};

  // index.js / src/ が置かれているディレクトリ（未指定ならwnode.js自身と同じ場所）
  const engineBase = resolveDir(data.engine || selfScript.src);
  // main.ds / import.ds.txt が置かれているディレクトリ（未指定ならHTMLと同じ場所）
  const dsBase = resolveDir(data.base || "./");
  const mainFile = data.main || "main.ds";
  const importFile = data.import || "import.ds.txt";

  function resolveDir(pathOrUrl) {
    const url = new URL(pathOrUrl, location.href);
    if (!/\.[a-zA-Z0-9]+$/.test(url.pathname.split("/").pop() || "")) {
      // 拡張子が無い＝ディレクトリ指定とみなし、末尾に/を保証
      if (!url.pathname.endsWith("/")) url.pathname += "/";
      return url.href;
    }
    return url.href.slice(0, url.href.lastIndexOf("/") + 1);
  }

  // ---- パス正規化（./ ../ を解決。node の path.normalize 相当の最小実装） ----
  function normalize(p) {
    const parts = String(p).replace(/\\/g, "/").split("/");
    const stack = [];
    for (const part of parts) {
      if (part === "" || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return stack.join("/");
  }

  async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`wnode.js: フェッチ失敗 ${url} (HTTP ${res.status})`);
    }
    return await res.text();
  }

  // deskScriptエンジン本体のソース一覧（index.js からのrequire関係と同じ構成）
  const ENGINE_FILES = [
    "index.js",
    "src/Storage.js",
    "src/Parser.js",
    "src/Evaluator.js",
    "src/DeskExtensions.js",
    "src/blocks/BlockContext.js",
    "src/blocks/NestableDispatcher.js",
    "src/blocks/DrawerLockBlock.js",
    "src/blocks/VarLifecycleBlock.js",
    "src/blocks/MeetingJoinBlock.js",
    "src/blocks/MailboxBlock.js",
    "src/blocks/AuditTrailBlock.js",
    "src/blocks/ClassBlock.js",
    "src/blocks/ControlBlock.js",
    "src/blocks/ObjectBlock.js",
  ];

  const moduleSource = Object.create(null); // 正規化パス -> ソーステキスト
  const moduleCache = Object.create(null); // 正規化パス -> module.exports
  const vfs = Object.create(null); // 正規化パス -> .ds / .txt の中身（仮想ファイルシステム）

  // ---- fs shim ----
  function makeFsShim() {
    return {
      existsSync(p) {
        return normalize(p) in vfs;
      },
      readFileSync(p) {
        const key = normalize(p);
        if (!(key in vfs)) {
          throw new Error(`wnode.js: 仮想FSにファイルがありません: ${p}`);
        }
        return vfs[key];
      },
      writeFileSync(p, data) {
        // ブラウザにはNode同様のディスク書き込み先が無いため、コンソール出力で代替する。
        console.log(`[wnode.js] writeFileSync は未対応です。出力内容だけ表示します。\n--- ${p} ---\n${data}`);
      },
    };
  }

  // ---- path shim（このリポジトリで実際に使われている範囲のみ実装） ----
  function makePathShim() {
    return {
      extname(p) {
        const base = String(p).split("/").pop();
        const m = /\.[^.]+$/.exec(base);
        return m ? m[0] : "";
      },
      dirname(p) {
        const s = String(p).replace(/\\/g, "/");
        const idx = s.lastIndexOf("/");
        return idx === -1 ? "." : s.slice(0, idx) || ".";
      },
      join(...parts) {
        return normalize(parts.join("/"));
      },
      basename(p) {
        return String(p).replace(/\\/g, "/").split("/").pop();
      },
    };
  }

  // require(モジュール名) を呼んだ側のファイルパスを渡して、相対パス解決に使う
  function makeRequire(fromPath) {
    const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
    return function require(id) {
      // Node組込み（このリポジトリで使う範囲のみ）
      if (id === "fs") return makeFsShim();
      if (id === "path") return makePathShim();
      if (id === "process") return { env: {} };

      // JavaScript標準のdocument（DOM）を、deskScript側では裸の "document" ではなく
      // "HTML" という名前空間経由（HTML.document.〜）で公開する。
      // import.ds.txt に HTML と書くと、crypto などと全く同じドット構文で
      // document.系メソッドがすべて（HTML.document.getElementById など）呼べる。
      if (id === "HTML") return { document: window.document, window: window };

      // エンジン内部の相対require（例: './Storage'、'./blocks/StatementParser'）
      if (id.startsWith(".")) {
        let target = normalize(fromDir + "/" + id);
        if (!(target in moduleSource) && target + ".js" in moduleSource) target += ".js";
        return loadModule(target);
      }

      // それ以外（未知のnpmパッケージ等）はブラウザ単体では提供できない。
      // Storage.loadImports 側で try/catch されるだけなので、ここで投げれば
      // 「[DeskScript Error]: ライブラリ「xxx」の読込失敗。」として安全に握りつぶされる。
      throw new Error(`wnode.js: ブラウザ環境では未対応のモジュールです: "${id}"`);
    };
  }

  function loadModule(path) {
    if (path in moduleCache) return moduleCache[path];
    const src = moduleSource[path];
    if (src === undefined) {
      throw new Error(`wnode.js: モジュールソースが見つかりません: ${path}`);
    }
    const mod = { exports: {} };
    moduleCache[path] = mod.exports; // 循環require対策として先に仮登録
    const factory = new Function("module", "exports", "require", "console", src + "\n//# sourceURL=" + path);
    factory(mod, mod.exports, makeRequire(path), console);
    moduleCache[path] = mod.exports;
    return mod.exports;
  }

  // main.ds 内の load.file: を再帰的にたどって仮想FSへ積む
  async function loadDsRecursive(relPath) {
    const key = normalize(relPath);
    if (key in vfs) return;
    const text = await fetchText(dsBase + relPath);
    vfs[key] = text;

    const loadFileRegex = /load\.file\s*:\s*([\w.\-/]+)/g;
    const targets = [];
    let m;
    while ((m = loadFileRegex.exec(text)) !== null) targets.push(m[1]);
    for (const t of targets) await loadDsRecursive(t);
  }

  async function boot() {
    // Storage.js が `this.importedModules = { process };` のように
    // Node のグローバル process をrequireせず直接参照しているため、
    // ブラウザ側にも同名のグローバルを用意しておく（無ければ作るだけで、
    // 既にpolyfill等でwindow.processがあればそれを尊重する）。
    if (typeof window.process === "undefined") {
      window.process = { env: {} };
    }

    // 1. deskScriptエンジン本体のソースを取得
    await Promise.all(
      ENGINE_FILES.map(async (f) => {
        moduleSource[f] = await fetchText(engineBase + f);
      })
    );

    // 2. import.ds.txt / main.ds（と load.file: で参照される先）を仮想FSへ取得
    //    engine側は './import.ds.txt' './main.ds' という決め打ちのパスで読みに来るため、
    //    実際の取得元（dsBase/data-main等）に関わらず、仮想FS上は必ずこの名前で登録する。
    try {
      vfs[normalize(importFile)] = await fetchText(dsBase + importFile);
    } catch (e) {
      console.warn(`[wnode.js] ${importFile} の取得に失敗しました（無くても動作は続行します）:`, e);
      vfs[normalize(importFile)] = "";
    }
    await loadDsRecursive(mainFile);
    if (normalize(mainFile) !== "main.ds") {
      vfs["main.ds"] = vfs[normalize(mainFile)];
    }
    if (normalize(importFile) !== "import.ds.txt") {
      vfs["import.ds.txt"] = vfs[normalize(importFile)];
    }

    // 3. index.js を実行する。中身は Node 版と完全に同一で、
    //    engine.init('./import.ds.txt', './main.ds') → engine.runAll() が自動で走る。
    const engineExports = loadModule("index.js");
    window.DeskScriptEngine = engineExports.DeskScriptEngine;
    window.dispatchEvent(new CustomEvent("deskscript:ready", { detail: engineExports }));
  }

  boot().catch((err) => {
    console.error("[wnode.js] 起動に失敗しました:", err);
  });
})();
