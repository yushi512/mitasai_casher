const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function server({ visitor = "register@example.test", effective = visitor, canEdit = true } = {}) {
  const rows = [];
  let exists = false;
  let locked = false;
  let flushFailure = false;
  let openCount = 0;
  const properties = { MITASAI_TOKEN: "t".repeat(40), MITASAI_SPREADSHEET_IDS: "a".repeat(44) };
  const sheet = {
    getLastRow: () => rows.length,
    getMaxRows: () => 1000,
    getRange: (row, column, count, width) => ({
      canEdit: () => canEdit,
      getValues: () => Array.from({ length: count }, (_, index) => (rows[row - 1 + index] || []).slice(column - 1, column - 1 + width)),
      setValues: (values) => { assert.equal(locked, true); values.forEach((value, index) => { rows[row - 1 + index] = Array.from(value); }); },
    }),
  };
  const context = vm.createContext({
    Session: { getActiveUser: () => ({ getEmail: () => visitor }), getEffectiveUser: () => ({ getEmail: () => effective }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { locked = true; }, releaseLock: () => { locked = false; } }) },
    SpreadsheetApp: {
      openById: () => { openCount++; return { getName: () => "Test Sales", getSheetByName: () => exists ? sheet : null, insertSheet: () => { exists = true; return sheet; } }; },
      flush: () => { if (flushFailure) throw new Error("response lost after write"); },
    },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (value) => ({ setMimeType: () => JSON.parse(value) }) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8"), context);
  const request = (overrides = {}) => context.doPost({ postData: { contents: JSON.stringify({ token: properties.MITASAI_TOKEN, spreadsheetId: properties.MITASAI_SPREADSHEET_IDS, action: "append", sale: sale(), ...overrides }) } });
  const hosted = (body) => context.hostedSales(body);
  return { rows, request, hosted, properties, setFlushFailure: (value) => { flushFailure = value; }, get locked() { return locked; }, get openCount() { return openCount; } };
}

test("hosted setup accepts a new spreadsheet outside the standalone connector allowlist", () => {
  const s = server();
  const spreadsheetId = "b".repeat(44);
  assert.equal(s.hosted({ action: "check", spreadsheetId }).spreadsheetName, "Test Sales");
  assert.equal(s.rows.length, 1, "setup writes a header but no sale");
  const request = { action: "append", spreadsheetId, sale: sale() };
  assert.equal(s.hosted(request).ok, true);
  assert.equal(s.hosted(request).duplicate, true);
  assert.equal(s.rows.length, 2);
});

test("hosted setup rejects execution as another account or ranges the user cannot edit", () => {
  const body = { action: "check", spreadsheetId: "b".repeat(44) };
  const wrongAccount = server({ effective: "owner@example.test" });
  assert.equal(wrongAccount.hosted(body).ok, false);
  assert.equal(wrongAccount.openCount, 0);
  const viewer = server({ canEdit: false });
  assert.equal(viewer.hosted(body).ok, false);
  assert.equal(viewer.rows.length, 0);
});

function sale() {
  return { id: "sale-12345678-1234-4123-8123-123456789abc", timestamp: "2026-11-18T10:00:00.000Z", items: [{ name: "塩", quantity: 2, price: 500, lineTotal: 1000 }], subtotal: 1000, discountLabel: "学生割", discountRate: 10, discountAmount: 100, total: 900, totalQuantity: 2 };
}

test("authenticates and checks the allowlist before opening a file", () => {
  const s = server();
  assert.equal(s.request({ token: "wrong" }).ok, false);
  assert.equal(s.request({ spreadsheetId: "b".repeat(44) }).ok, false);
  assert.equal(s.openCount, 0);
  const result = s.request({ action: "check" });
  assert.equal(result.spreadsheetName, "Test Sales");
  assert.equal(s.rows.length, 0, "connection checks do not create rows");
});

test("writes one sale, acknowledges retries without duplicates, and releases locks", () => {
  const s = server();
  assert.equal(s.request().ok, true);
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[1][7], 900);
  assert.equal(s.locked, false);
  assert.equal(s.request().duplicate, true);
  assert.equal(s.rows.length, 2);
});

test("recovers from a failure after the row was written", () => {
  const s = server();
  s.setFlushFailure(true);
  assert.equal(s.request().ok, false);
  assert.equal(s.locked, false);
  s.setFlushFailure(false);
  assert.equal(s.request().duplicate, true);
  assert.equal(s.rows.length, 2);
});

test("rejects inconsistent totals and protects existing tables", () => {
  const s = server();
  assert.equal(s.request({ sale: { ...sale(), total: 999 } }).ok, false);
  assert.equal(s.request({ sale: { ...sale(), items: [{ name: "x", quantity: -1, price: 500, lineTotal: -500 }] } }).ok, false);
  assert.equal(s.openCount, 0);
  s.request();
  s.rows[0][0] = "Existing unrelated data";
  assert.equal(s.request({ sale: { ...sale(), id: "sale-22345678-1234-4123-8123-123456789abc" } }).ok, false);
  assert.equal(s.rows.length, 2);
  assert.equal(s.locked, false);
});

test("escapes formula-like product names and discount labels", () => {
  const s = server();
  const record = sale();
  record.items[0].name = '=HYPERLINK("https://example.test")';
  record.discountLabel = "  =1+1";
  assert.equal(s.request({ sale: record }).ok, true);
  assert.ok(s.rows[1][2].startsWith("'="));
  assert.ok(s.rows[1][4].startsWith("'"));
});
