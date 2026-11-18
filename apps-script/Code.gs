// Copy into a private Google Apps Script project. Configure Script Properties
// MITASAI_TOKEN (32+ characters) and MITASAI_SPREADSHEET_IDS (comma-separated IDs).
const SALES_SHEET_NAME = "MitasaiSales";
const SALES_HEADERS = ["会計ID", "日時（UTC）", "商品内訳", "小計", "割引名", "割引率（%）", "割引額", "合計", "個数計"];

function doPost(e) {
  try {
    if (!e || !e.postData || e.postData.contents.length > 100000) {
      throw new Error("送信データが不正です。");
    }
    const body = JSON.parse(e.postData.contents);
    const properties = PropertiesService.getScriptProperties();
    const token = properties.getProperty("MITASAI_TOKEN");
    if (!token || token.length < 32 || body.token !== token) {
      throw new Error("接続用トークンを確認してください。");
    }
    const allowedIds = (properties.getProperty("MITASAI_SPREADSHEET_IDS") || "")
      .split(",").map(function (id) { return id.trim(); }).filter(Boolean);
    if (!allowedIds.includes(body.spreadsheetId)) {
      throw new Error("この記録先は許可されていません。スクリプトプロパティのIDを確認してください。");
    }
    if (body.action !== "check" && body.action !== "append") {
      throw new Error("操作が不正です。");
    }
    if (body.action === "append") validateSale(body.sale);

    // All registers using this deployment share one lock, including header creation.
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      let spreadsheet;
      try { spreadsheet = SpreadsheetApp.openById(body.spreadsheetId); }
      catch (_) { throw new Error("記録先を開けません。スクリプト実行者の編集権限を確認してください。"); }
      let sheet = spreadsheet.getSheetByName(SALES_SHEET_NAME);
      if (sheet && sheet.getLastRow() > 0) {
        const headers = sheet.getRange(1, 1, 1, SALES_HEADERS.length).getValues()[0];
        if (!SALES_HEADERS.every(function (header, index) { return headers[index] === header; })) {
          throw new Error("MitasaiSalesシートの見出しが異なります。既存シートを別名にしてください。");
        }
      }
      if (body.action === "check") {
        return jsonResponse({ ok: true, spreadsheetName: spreadsheet.getName() });
      }
      if (!sheet) sheet = spreadsheet.insertSheet(SALES_SHEET_NAME);
      const lastRow = sheet.getLastRow();
      const sale = body.sale;
      if (lastRow > 1) {
        const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        if (ids.some(function (row) { return row[0] === sale.id; })) {
          return jsonResponse({ ok: true, saleId: sale.id, duplicate: true });
        }
      }
      const row = [
        sale.id, new Date(sale.timestamp).toISOString(),
        safeText(sale.items.map(function (item) { return item.name + "×" + item.quantity + "（単価" + item.price + "円）"; }).join(", ")),
        sale.subtotal, safeText(sale.discountLabel), sale.discountRate,
        sale.discountAmount, sale.total, sale.totalQuantity,
      ];
      // The entire sale is one row, so retries cannot leave partial item lists.
      const rows = lastRow === 0 ? [SALES_HEADERS, row] : [row];
      sheet.getRange(lastRow + 1, 1, rows.length, SALES_HEADERS.length).setValues(rows);
      SpreadsheetApp.flush();
      return jsonResponse({ ok: true, saleId: sale.id, duplicate: false });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || "記録に失敗しました。再送してください。" });
  }
}

function validateSale(sale) {
  if (!sale || typeof sale.id !== "string" || !/^sale-[a-zA-Z0-9-]{20,100}$/.test(sale.id) ||
      typeof sale.timestamp !== "string" || !Number.isFinite(Date.parse(sale.timestamp)) ||
      !Array.isArray(sale.items) || !sale.items.length || sale.items.length > 100 ||
      typeof sale.discountLabel !== "string" || sale.discountLabel.length > 1000) {
    throw new Error("会計データが不正です。");
  }
  const numericFields = ["subtotal", "discountRate", "discountAmount", "total", "totalQuantity"];
  if (!numericFields.every(function (key) { return validNumber(sale[key]); }) || sale.discountRate > 100) {
    throw new Error("会計金額が不正です。");
  }
  let subtotal = 0;
  let quantity = 0;
  sale.items.forEach(function (item) {
    if (!item || typeof item.name !== "string" || item.name.length > 200 ||
        !validNumber(item.quantity) || item.quantity < 1 || !validNumber(item.price) ||
        !validNumber(item.lineTotal) || item.lineTotal !== item.quantity * item.price) {
      throw new Error("商品明細が不正です。");
    }
    subtotal += item.lineTotal;
    quantity += item.quantity;
  });
  if (subtotal !== sale.subtotal || quantity !== sale.totalQuantity ||
      sale.discountAmount !== Math.round(subtotal * sale.discountRate / 100) ||
      sale.total !== subtotal - sale.discountAmount) {
    throw new Error("会計合計と明細が一致しません。");
  }
}

function validNumber(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1000000000000;
}

function safeText(value) {
  // Never interpret product names or discount labels as spreadsheet formulas.
  return /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
