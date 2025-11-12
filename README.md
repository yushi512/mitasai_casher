# MITASAI CASHER

学園祭の模擬店向けに、シンプルで使いやすいレジ Web アプリを用意しました。ブラウザだけで動作し、商品管理から会計・売上の Excel エクスポートまで完結します。

## 使い方

1. `index.html` をブラウザ (Chrome / Edge 推奨) で開くと、メイン画面が表示されます。
2. 商品カードの `＋/−` ボタンで数量を調整し、割引を選択して `会計` を押すと、その会計情報がブラウザに保存されます。
3. 売上 Excel が必要になったタイミングで、管理画面の「手動でエクスポート」から全会計データをまとめてダウンロードできます。

## 機能概要

- **見やすい UI**: 商品一覧と注文サマリーを並べて表示し、合計金額や割引がひと目で分かります。
- **管理画面**: 商品の追加・価格変更・削除、割引率の追加/変更/削除をブラウザ上で完結できます。フレーバーごとの標準価格は以下の通りで初期登録されています。
  - 500 円: プレーン（塩）
  - 600 円: マヨネーズ / 明太子マヨ / ブラックペッパー / 海苔塩 / 醤油バター
- **100 円引き調整**: 売れ行きに合わせ、管理画面からワンクリックで各フレーバーを 100 円引きにし、ボタン一つで元の価格に戻せます。
- **売上 Excel**: 会計ボタンでデータを蓄積し、必要なときに以下を含むファイルを手動エクスポートできます。
  - 会計ごとの明細 (`SalesLog` シート)
  - 売上合計金額/総数と会計件数 (`Summary` シート)
  - 2 時間ごとの売上個数集計 (`ByTimeSlot` シート)
- **Google Sheets 連携 (任意)**: GitHub Pages 上で同じスプレッドシートに会計ログを集約できるよう、Google Apps Script Web API への送信機能を備えています。
- **手動エクスポート**: 管理画面の「手動でエクスポート」から、任意のタイミングで最新の売上ファイルを再取得できます。

## データの保持について

- 商品・割引・売上履歴は、ブラウザのローカルストレージに保存されます。
- ブラウザを変更/シークレットモードを使用するとデータは共有されないため、本番利用の端末を固定してください。

## カスタマイズ

アプリはプレーンな HTML/CSS/JavaScript で構成されているため、好みに応じて `styles.css` や `app.js` を編集するだけで見た目や挙動を調整できます。

## Google Sheets 連携手順

1. `config.sample.js` を `config.js` にコピーし、リポジトリには含めないでください (`config.js` は `.gitignore` 済み)。
2. `config.js` に以下を設定します。
   - `sheetsEndpoint`: Google Apps Script を Web アプリとして公開した URL。
   - `sheetsApiKey`: 任意の共有キー。Apps Script 側で同じ値かを確認して簡易認証に使います。
3. Google スプレッドシートを作成し、ツール > スクリプトエディタから Apps Script を開いて、下記サンプルを貼り付けます。

```javascript
const SHEET_ID = "ここにスプレッドシートID";
const API_KEY = "config.js に設定したキー";

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.apiKey !== API_KEY) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: "unauthorized" })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  const sale = body.payload;
  const sheet =
    SpreadsheetApp.openById(SHEET_ID).getSheetByName("SalesLog") ||
    SpreadsheetApp.openById(SHEET_ID).insertSheet("SalesLog");

  sheet.appendRow([
    new Date(sale.timestamp),
    sale.id,
    sale.totalQuantity,
    sale.total,
    sale.discountLabel,
    sale.discountAmount,
    sale.items.map((item) => `${item.name}×${item.quantity}`).join(", "),
  ]);

  return ContentService.createTextOutput(
    JSON.stringify({ status: "ok" })
  ).setMimeType(ContentService.MimeType.JSON);
}
```

4. 「デプロイ > 新しいデプロイ > 種類: ウェブアプリ」から「アクセスできるユーザー: 全員」に設定して公開すると URL が発行されます。
5. GitHub Pages で公開したアプリをリロードすると、会計時に設定したスプレッドシートへもデータが送られます。ネットワークや API でエラーが出た場合は画面下部にエラーメッセージが表示されます。
