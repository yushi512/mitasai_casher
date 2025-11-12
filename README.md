# MITASAI CASHER

学園祭の模擬店向けに作成した、シンプルで見やすい Web レジアプリです。ブラウザだけで動作し、商品管理から会計・Excel への売上出力、さらに Google Sheets への共有ログまで対応できます。

## 使い方

1. `index.html` をブラウザ (Chrome / Edge 推奨) で開くとメイン画面が表示されます。
2. 商品カードの `＋/−` ボタンで数量を調整し、割引を選択して `会計` を押します。会計情報はブラウザに保存され、必要に応じて Excel へエクスポートできます。
3. 管理画面では商品の追加・価格変更・割引設定、100 円引きの瞬時切り替えが可能です。
4. 「手動でエクスポート」ボタンを押すと、すべての会計履歴を含む Excel ファイル (`.xlsx`) がダウンロードされます。

## 機能

- **直感的な UI**: 商品一覧と注文サマリーを並べ、割引や合計金額がひと目で分かります。
- **管理画面**: 商品追加 / 価格更新 / 削除、割引の CRUD、100 円引き・標準価格のワンクリック切り替えに対応。
- **売上エクスポート**: Excel には「SalesLog」「Summary」「ByTimeSlot」の 3 シートを収録し、会計明細と集計を自動生成します。
- **Google Sheets 連携**: 設定済みの Web API に会計データを送信し、複数端末から同じスプレッドシートへ記録できます。

## データ保持

- 商品・割引・会計履歴はブラウザのローカルストレージに保存されます。
- 端末やブラウザを変えると共有されないため、共用端末では同じブラウザを使い続けてください。

## カスタマイズ

HTML/CSS/JavaScript だけで構成されているため、`index.html` / `styles.css` / `app.js` を編集することで自由に見た目や挙動を変更できます。

## Google Sheets 連携手順

1. `config.sample.js` を `config.js` にコピーし、**リポジトリに含めた状態**で運用します。  
   ```bash
   cp config.sample.js config.js
   ```
2. `config.js` を編集し、以下の値を設定します。
   - `sheetsEndpoint`: Google Apps Script などで公開した Web API の URL (例: `https://script.google.com/macros/s/XXXXX/exec`)
   - `sheetsApiKey`: API 側で照合する共有キー
   - `sheetsTimeoutMs`: フロントエンドからの送信タイムアウト (任意)
3. Google スプレッドシートを用意し、ツール > スクリプトエディタで Apps Script を作成します。以下は最小構成の例です。

```javascript
const SHEET_ID = "ここにスプレッドシートID";
const API_KEY = "config.js と同じキー";

function doGet(e) {
  return buildCorsResponse({ status: "ok" });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents || "{}");
  if (body.apiKey !== API_KEY) {
    return buildCorsResponse({ status: "error", message: "unauthorized" }, 403);
  }

  const sale = body.payload;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("SalesLog") || ss.insertSheet("SalesLog");
  sheet.appendRow([
    new Date(sale.timestamp),
    sale.id,
    sale.totalQuantity,
    sale.total,
    sale.discountLabel,
    sale.discountAmount,
    sale.items.map((item) => `${item.name}×${item.quantity}`).join(", "),
  ]);

  return buildCorsResponse({ status: "ok" });
}

function buildCorsResponse(payload, statusCode = 200) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader("Access-Control-Allow-Origin", "https://yushi512.github.io")
    .setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    .setHeader("Access-Control-Allow-Headers", "Content-Type")
    .setHeader("Access-Control-Allow-Credentials", "false");
}
```

4. 「デプロイ > 新しいデプロイ > 種類: ウェブアプリ」を選択し、アクセス権を「全員」に設定して公開すると URL が発行されます。この URL を `config.js` の `sheetsEndpoint` に入力してください。
5. GitHub Pages や任意のホスティングへアップロードした後、ブラウザでページをハードリロードして最新の `config.js` を読み込みます。会計を 1 件行い、ステータスに「Google Sheets にも記録しました。」と表示され、シートの `SalesLog` に行が追加されることを確認してください。

> **CORS エラーについて**  
> Apps Script が `Access-Control-Allow-Origin` などのヘッダーを返さないと、ブラウザ側で `Failed to fetch` や `No 'Access-Control-Allow-Origin' header` が発生します。必ず上記 `buildCorsResponse` のようにヘッダーを設定し、コード変更後は最新バージョンで再デプロイしてください。

## トラブルシューティング

- `config.js` 404: ファイルをリポジトリに含めていないか、キャッシュが古い可能性があります。GitHub Pages をデプロイした後に `config.js` が配信されているか確認してください。
- `Failed to fetch`: CORS 設定不足、Web アプリ未デプロイ、または `sheetsEndpoint` が空文字の場合に発生します。Apps Script のアクセス権とヘッダーを再確認し、ブラウザをリロードしてください。
- Chrome 拡張機能が出すフォント読み込みエラー (例: `chrome-extension://.../open_sans.woff`) はアプリとは無関係です。気になる場合は拡張機能を無効化してください。
