const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sheets = require("../sheets-sync.js");
const { randomUUID } = require("node:crypto");
const settings = { enabled: true, spreadsheetId: "a".repeat(44), endpoint: "https://script.google.com/macros/s/test/exec", token: "t".repeat(40) };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function app(initial = {}, request = async (_, __, sale) => ({ ok: true, saleId: sale.id }), hosted = false) {
  const data = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  const elements = new Map();
  let failSales = false;
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, { value: "", checked: false, disabled: false, dataset: {}, textContent: "", innerHTML: "", listeners: {},
        classList: { add() {}, remove() {}, toggle() {} }, appendChild() {},
        querySelectorAll: () => [], addEventListener(type, callback) { this.listeners[type] = callback; },
      });
    }
    return elements.get(id);
  }
  const context = vm.createContext({
    document: { documentElement: { dataset: { host: hosted ? "apps-script" : "" } }, getElementById: element, querySelectorAll: () => [], createElement: () => element(randomUUID()) },
    window: { addEventListener() {} },
    localStorage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { if (failSales && key === "mitasai_sales") throw new Error("quota"); data.set(key, value); } },
    console, Intl, crypto: { randomUUID }, MitasaiSheets: { ...sheets, request },
    URL, setTimeout, clearTimeout,
  });
  if (hosted) {
    const runner = {
      withSuccessHandler(callback) { this.success = callback; return this; },
      withFailureHandler(callback) { this.failure = callback; return this; },
      hostedSales(body) { request(body).then(this.success, this.failure); },
    };
    context.google = { script: { run: runner } };
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../sheets-sync.js"), "utf8"), context);
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app.js"), "utf8"), context);
  const event = { preventDefault() {} };
  return {
    element, data,
    sales: () => JSON.parse(data.get("mitasai_sales") || "[]"),
    setFailure: (value) => { failSales = value; },
    checkout: () => {
      element("product-list").listeners.click({ target: { closest: () => ({ dataset: { action: "inc", id: "p-plain" } }) } });
      element("checkout-button").listeners.click();
    },
    save: () => element("sheets-settings-form").listeners.submit(event),
    retry: () => element("sheets-retry-button").listeners.click(),
  };
}

test("hosted register saves an editable URL and uses it after rejecting an invalid destination", async () => {
  const calls = [];
  const allowed = "x".repeat(44);
  const a = app({}, async (body) => {
    calls.push(body);
    if (body.spreadsheetId !== allowed) return { ok: false, error: "編集権限がありません。" };
    return body.action === "check"
      ? { ok: true, spreadsheetName: "三田祭 売上" }
      : { ok: true, saleId: body.sale.id };
  }, true);
  assert.equal(a.element("sheets-external-settings").hidden, true);
  a.element("spreadsheet-url").value = `https://docs.google.com/spreadsheets/d/${allowed}/edit#gid=0`;
  await a.save();
  assert.match(a.element("sheets-current-link").textContent, /三田祭 売上/);
  a.element("spreadsheet-url").value = "y".repeat(44);
  await a.save();
  assert.match(a.element("sheets-status").textContent, /編集権限がありません/);
  a.checkout();
  await tick();
  assert.equal(a.sales()[0].sheetsSync.status, "sent");
  assert.equal(calls[2].spreadsheetId, allowed);
  assert.equal(Object.hasOwn(calls[2], "token"), false);
});

test("GitHub Pages saves a reachable spreadsheet and keeps it when a replacement fails", async () => {
  const calls = [];
  const a = app({}, async (config, action, sale) => {
    calls.push({ config, action });
    if (config.spreadsheetId !== settings.spreadsheetId) throw new Error("接続できません。");
    return action === "check"
      ? { ok: true, spreadsheetName: "三田祭 売上" }
      : { ok: true, saleId: sale.id };
  });
  assert.equal(a.element("sheets-external-settings").open, true);
  a.element("spreadsheet-url").value = settings.spreadsheetId;
  a.element("sheets-endpoint").value = settings.endpoint;
  a.element("sheets-token").value = settings.token;
  await a.save();
  assert.match(a.element("sheets-current-link").textContent, /三田祭 売上/);
  a.element("spreadsheet-url").value = "z".repeat(44);
  await a.save();
  assert.match(a.element("sheets-status").textContent, /接続できません/);
  a.checkout();
  await tick();
  assert.equal(calls[2].config.spreadsheetId, settings.spreadsheetId);
  assert.equal(a.sales()[0].sheetsSync.status, "sent");
  a.element("sheets-enabled").checked = false;
  await a.save();
  a.checkout();
  assert.equal(calls.length, 3);
  assert.equal(a.sales()[1].sheetsSync, undefined);
});

test("removes happy hour from new and saved discount settings while retaining sales history", () => {
  const fresh = app();
  assert.doesNotMatch(fresh.element("discount-select").innerHTML, /ハッピーアワー/);
  const historicalSale = { id: "historical", discountLabel: "ハッピーアワー (20%)", total: 400 };
  const existing = app({
    mitasai_discounts: [
      { id: "discount-none", label: "割引なし", rate: 0 },
      { id: "discount-happy", label: "ハッピーアワー (20%)", rate: 20 },
      { id: "discount-custom", label: "特別割引", rate: 15 },
    ],
    mitasai_sales: [historicalSale],
  });
  assert.doesNotMatch(existing.element("discount-select").innerHTML, /ハッピーアワー/);
  assert.match(existing.element("discount-select").innerHTML, /特別割引/);
  assert.equal(JSON.parse(existing.data.get("mitasai_discounts")).length, 2);
  assert.deepEqual(existing.sales(), [historicalSale]);
});

test("offline sales stay pending, survive reload, and retry using the original ID", async () => {
  const calls = [];
  const a = app({ mitasai_sheets_settings: settings }, async (_, __, sale) => { calls.push(sale.id); throw new Error("offline"); });
  a.checkout();
  await tick();
  assert.equal(a.sales()[0].sheetsSync.status, "pending");
  assert.equal(a.element("grand-total").textContent, "￥0");
  const original = a.sales()[0].id;
  const b = app(Object.fromEntries([...a.data].map(([key, value]) => [key, JSON.parse(value)])), async (_, __, sale) => { calls.push(sale.id); return { ok: true, saleId: sale.id }; });
  await tick();
  assert.equal(b.sales()[0].sheetsSync.status, "sent");
  assert.deepEqual(calls, [original, original]);
});

test("switching targets does not reroute previous pending sales or backfill old sales", async () => {
  const requests = [];
  let fail = true;
  const a = app({ mitasai_sheets_settings: settings, mitasai_sales: [{ id: "legacy" }] }, async (config, action, sale) => {
    if (action === "check") return { ok: true, spreadsheetName: "売上" };
    requests.push({ target: config.spreadsheetId, id: sale.id });
    if (fail) throw new Error("offline");
    return { ok: true, saleId: sale.id };
  });
  a.checkout(); await tick();
  const first = a.sales()[1].id;
  a.element("spreadsheet-url").value = "b".repeat(44);
  await a.save();
  fail = false;
  a.checkout(); await tick();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].target, "b".repeat(44));
  assert.equal(a.sales()[1].sheetsSync.status, "pending");
  assert.equal(a.sales()[2].sheetsSync.status, "sent");
  a.element("spreadsheet-url").value = settings.spreadsheetId;
  await a.save(); await tick();
  assert.equal(requests[2].id, first);
  assert.equal(requests[2].target, settings.spreadsheetId);
  assert.equal(a.sales()[1].sheetsSync.status, "sent");
});

test("a failed local save keeps the cart and makes no network request", async () => {
  let count = 0;
  const a = app({ mitasai_sheets_settings: settings }, async () => { count++; });
  a.setFailure(true);
  a.checkout(); await tick();
  assert.equal(a.sales().length, 0);
  assert.equal(count, 0);
  assert.match(a.element("status-message").textContent, /カートは保持/);
  assert.equal(a.element("grand-total").textContent, "￥500");
});

test("disabled connections preserve local checkout and do not send", async () => {
  let count = 0;
  const a = app({ mitasai_sheets_settings: { ...settings, enabled: false } }, async () => { count++; });
  a.checkout(); await tick();
  assert.equal(a.sales().length, 1);
  assert.equal(a.sales()[0].sheetsSync, undefined);
  assert.equal(count, 0);
});
