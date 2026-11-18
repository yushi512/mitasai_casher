const { test } = require("node:test");
const assert = require("node:assert/strict");
const sheets = require("../sheets-sync.js");

const settings = {
  enabled: true, spreadsheetId: "a".repeat(44),
  endpoint: "https://script.google.com/macros/s/deployment_123/exec", token: "t".repeat(40),
};

test("accepts a spreadsheet ID and an edit URL, rejects other hosts and published links", () => {
  assert.equal(sheets.parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit#gid=123`), settings.spreadsheetId);
  assert.equal(sheets.parseSpreadsheetId(settings.spreadsheetId), settings.spreadsheetId);
  for (const input of ["", "https://evil.test/spreadsheets/d/" + settings.spreadsheetId, "https://docs.google.com/spreadsheets/d/e/published/pubhtml", "http://docs.google.com/spreadsheets/d/" + settings.spreadsheetId]) {
    assert.throws(() => sheets.parseSpreadsheetId(input));
  }
  assert.deepEqual(sheets.normalizeSettings(settings), settings);
  assert.throws(() => sheets.normalizeSettings({ ...settings, endpoint: settings.endpoint + "?redirect=other" }));
  assert.throws(() => sheets.normalizeSettings({ ...settings, token: "short" }));
});

test("requires a readable successful acknowledgement for the same sale", async () => {
  const sale = { id: "sale-123" };
  const fetch = async (url, options) => {
    assert.equal(url, settings.endpoint);
    assert.equal(options.headers["Content-Type"], "text/plain;charset=UTF-8");
    assert.equal(options.credentials, "omit");
    assert.equal(options.mode, undefined);
    assert.equal(JSON.parse(options.body).spreadsheetId, settings.spreadsheetId);
    return { ok: true, json: async () => ({ ok: true, saleId: sale.id }) };
  };
  await sheets.request(settings, "append", sale, fetch);
  await assert.rejects(sheets.request(settings, "append", sale, async () => ({ ok: false })), /公開設定/);
  await assert.rejects(sheets.request(settings, "append", sale, async () => ({ ok: true, json: async () => ({ ok: false, error: "denied" }) })), /denied/);
  await assert.rejects(sheets.request(settings, "append", sale, async () => ({ ok: true, json: async () => ({ ok: true, saleId: "another" }) })), /再送/);
  await assert.rejects(sheets.request(settings, "append", sale, async () => { const e = new Error(); e.name = "AbortError"; throw e; }), /タイムアウト/);
});

test("target matching includes both the spreadsheet and deployment", () => {
  const sale = { sheetsSync: { spreadsheetId: settings.spreadsheetId, endpoint: settings.endpoint } };
  assert.equal(sheets.matchesTarget(sale, settings), true);
  assert.equal(sheets.matchesTarget(sale, { ...settings, spreadsheetId: "b".repeat(44) }), false);
  assert.equal(sheets.matchesTarget(sale, { ...settings, endpoint: settings.endpoint.replace("123", "456") }), false);
  assert.equal(sheets.matchesTarget({}, settings), false);
});
