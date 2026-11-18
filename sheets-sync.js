(function (root) {
  "use strict";

  function parseSpreadsheetId(value) {
    const input = value.trim();
    if (/^[a-zA-Z0-9_-]{20,200}$/.test(input)) return input;
    let url;
    try { url = new URL(input); } catch { throw new Error("スプレッドシートのURL または IDを入力してください。"); }
    const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,200})(?:\/|$)/);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !match) {
      throw new Error("Googleスプレッドシートの編集用URLを入力してください。");
    }
    return match[1];
  }

  function normalizeSettings(input) {
    const endpoint = input.endpoint.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(endpoint)) {
      throw new Error("Apps ScriptのウェブアプリURL（末尾が /exec）を入力してください。");
    }
    const token = input.token.trim();
    if (token.length < 32) throw new Error("接続用トークンは32文字以上で設定してください。");
    return { enabled: Boolean(input.enabled), spreadsheetId: parseSpreadsheetId(input.spreadsheetId), endpoint, token };
  }

  function matchesTarget(sale, settings) {
    return sale.sheetsSync?.spreadsheetId === settings.spreadsheetId &&
      sale.sheetsSync?.endpoint === settings.endpoint;
  }

  async function request(settings, action, sale, fetchImpl = root.fetch.bind(root)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetchImpl(settings.endpoint, {
        method: "POST",
        // A simple request avoids an OPTIONS preflight, which Apps Script does not serve.
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        credentials: "omit",
        redirect: "follow",
        signal: controller.signal,
        body: JSON.stringify({ action, token: settings.token, spreadsheetId: settings.spreadsheetId, sale }),
      });
      if (!response.ok) throw new Error("接続できませんでした。ウェブアプリの公開設定を確認してください。");
      const result = await response.json();
      if (result.ok !== true) throw new Error(result.error || "スプレッドシートへの記録に失敗しました。");
      if (action === "append" && result.saleId !== sale.id) throw new Error("記録結果を確認できませんでした。再送してください。");
      return result;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("接続がタイムアウトしました。未送信分は再送できます。");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  const api = { parseSpreadsheetId, normalizeSettings, matchesTarget, request };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MitasaiSheets = api;
})(globalThis);
