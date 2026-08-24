export interface HostVariable {
  source: string;
}

export interface Drawer {
  hostVariables: Record<string, HostVariable>;
  inreturns: Record<string, string>;
}

// set:desk(名前, 型:引数, ,,,) で宣言する型付き引数スキーマ
export interface TypedField {
  type: string;
  name: string;
}

export interface Desk {
  argName: string | null;
  drawers: Record<string, Drawer>;
  outreturnTarget: string | null;
  fieldSchema?: TypedField[]; // set:desk(...) で宣言された型スキーマ（型検証に使う）
}

export interface DSFunction {
  paramNames: string[];
  body: string;
}

// set:class(名前, 型:引数, ,,,) / class:名前(self, 型:引数, self.型:引数,,,), init(self.型:引数,,,|値,値,,,){処理}
export interface ClassDef {
  name: string;
  fields: TypedField[];      // インスタンスが持つフィールドの一覧（set:class + class:の self.型:引数 の合算）
  initParams: TypedField[];  // init(...) の "|" より前：コンストラクタ引数（self.型:引数）
  initDefaults: string[];    // init(...) の "|" より後：位置対応のデフォルト値
  initBody: string;          // { 処理 } の中身
}
