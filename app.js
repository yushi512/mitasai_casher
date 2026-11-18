(() => {
  const STORAGE_KEYS = {
    PRODUCTS: "mitasai_products",
    DISCOUNTS: "mitasai_discounts",
    SALES: "mitasai_sales",
    SHEETS: "mitasai_sheets_settings",
  };

  const DEFAULT_PRODUCTS = [
    { id: "p-plain", name: "プレーン（塩）", price: 500 },
    { id: "p-mayo", name: "マヨネーズ", price: 600 },
    { id: "p-mentai", name: "明太子マヨ", price: 600 },
    { id: "p-blackpepper", name: "ブラックペッパー", price: 600 },
    { id: "p-norishio", name: "海苔塩", price: 600 },
    { id: "p-soybutter", name: "醤油バター", price: 600 },
  ];

  const DEFAULT_DISCOUNTS = [
    { id: "discount-none", label: "割引なし", rate: 0 },
    { id: "discount-student", label: "学生割 (10%)", rate: 10 },
    { id: "discount-happy", label: "ハッピーアワー (20%)", rate: 20 },
  ];

  const state = {
    products: [],
    discounts: [],
    sales: [],
    cart: {},
    selectedDiscountId: null,
    sheets: { enabled: false, spreadsheetId: "", endpoint: "", token: "" },
    syncing: false,
    checkingTarget: false,
  };

  const currency = new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  });

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const normalizeProduct = (product) => {
    const basePrice = Math.round(
      product.basePrice ?? product.price ?? 0
    );
    const price = Math.round(product.price ?? basePrice);
    return { ...product, basePrice, price };
  };

  const els = {
    screens: document.querySelectorAll(".screen"),
    tabButtons: document.querySelectorAll(".tab-button"),
    productList: document.getElementById("product-list"),
    cartItems: document.getElementById("cart-items"),
    discountSelect: document.getElementById("discount-select"),
    subtotal: document.getElementById("subtotal"),
    discountAmount: document.getElementById("discount-amount"),
    grandTotal: document.getElementById("grand-total"),
    statusMessage: document.getElementById("status-message"),
    checkoutButton: document.getElementById("checkout-button"),
    resetButton: document.getElementById("reset-button"),
    adminProductList: document.getElementById("admin-product-list"),
    adminDiscountList: document.getElementById("admin-discount-list"),
    addProductForm: document.getElementById("add-product-form"),
    addDiscountForm: document.getElementById("add-discount-form"),
    manualExportButton: document.getElementById("manual-export-button"),
    sheetsForm: document.getElementById("sheets-settings-form"),
    sheetsEnabled: document.getElementById("sheets-enabled"),
    spreadsheetUrl: document.getElementById("spreadsheet-url"),
    sheetsEndpoint: document.getElementById("sheets-endpoint"),
    sheetsToken: document.getElementById("sheets-token"),
    sheetsStatus: document.getElementById("sheets-status"),
    sheetsTest: document.getElementById("sheets-test-button"),
    sheetsSave: document.getElementById("sheets-save-button"),
    sheetsExternalSettings: document.getElementById("sheets-external-settings"),
    sheetsRetry: document.getElementById("sheets-retry-button"),
    sheetsCurrentLink: document.getElementById("sheets-current-link"),
  };

  init();

  function init() {
    loadState();
    renderAll();
    attachEventListeners();
    setStatus("準備ができました。", "success");
    if (MitasaiSheets.isHosted) {
      els.sheetsExternalSettings.hidden = true;
      els.sheetsTest.hidden = true;
      els.sheetsSave.textContent = "接続を確認して保存";
    }
    renderSheetsSettings();
    els.sheetsSave.textContent = "接続を確認して保存";
    if (!MitasaiSheets.isHosted && !state.sheets.endpoint) {
      els.sheetsExternalSettings.open = true;
    }
    void syncPendingSales();
  }

  function attachEventListeners() {
    els.sheetsForm.addEventListener("submit", saveSheetsSettings);
    els.sheetsTest.addEventListener("click", testSheetsConnection);
    els.sheetsRetry.addEventListener("click", () => { void syncPendingSales(); });
    window.addEventListener("online", () => { void syncPendingSales(); });
    els.tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => switchScreen(btn.dataset.target, btn));
    });

    els.productList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const { action, id } = button.dataset;
      if (action === "inc") adjustQuantity(id, 1);
      if (action === "dec") adjustQuantity(id, -1);
    });

    els.discountSelect.addEventListener("change", (event) => {
      state.selectedDiscountId = event.target.value;
      renderCartSummary();
    });

    els.resetButton.addEventListener("click", () => {
      state.cart = {};
      renderProducts();
      renderCartSummary();
      setStatus("カートをリセットしました。", "success");
    });

    els.checkoutButton.addEventListener("click", handleCheckout);

    els.addProductForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const nameInput = document.getElementById("new-product-name");
      const priceInput = document.getElementById("new-product-price");
      const name = nameInput.value.trim();
      const price = Number(priceInput.value);
      if (!name || price < 0) return;

      const normalizedPrice = Math.round(price);
      const product = {
        id: `p-${Date.now()}`,
        name,
        price: normalizedPrice,
        basePrice: normalizedPrice,
      };
      state.products.push(product);
      persistProducts();
      nameInput.value = "";
      priceInput.value = "";
      renderProducts();
      renderAdminProducts();
      setStatus(`「${product.name}」を追加しました。`, "success");
    });

    els.adminProductList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-product-action]");
      if (!button) return;
      const action = button.dataset.productAction;
      const id = button.dataset.id;
      if (action === "save") {
        const priceInput = els.adminProductList.querySelector(
          `input[data-price-id="${CSS.escape(id)}"]`
        );
        const newPrice = Number(priceInput.value);
        updateProductPrice(id, newPrice);
      }
      if (action === "delete") {
        deleteProduct(id);
      }
      if (action === "sale") {
        applyHundredYenDiscount(id);
      }
      if (action === "reset") {
        resetProductPrice(id);
      }
    });

    els.addDiscountForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const labelInput = document.getElementById("new-discount-label");
      const rateInput = document.getElementById("new-discount-rate");
      const label = labelInput.value.trim();
      const rate = Number(rateInput.value);
      if (!label || rate < 0 || rate > 100) return;

      const discount = {
        id: `d-${Date.now()}`,
        label,
        rate,
      };
      state.discounts.push(discount);
      persistDiscounts();
      labelInput.value = "";
      rateInput.value = "";
      renderDiscountOptions();
      renderAdminDiscounts();
      setStatus(`割引「${discount.label}」を追加しました。`, "success");
    });

    els.adminDiscountList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-discount-action]");
      if (!button) return;
      const action = button.dataset.discountAction;
      const id = button.dataset.id;
      if (action === "save") {
        const rateInput = els.adminDiscountList.querySelector(
          `input[data-rate-id="${CSS.escape(id)}"]`
        );
        const newRate = Number(rateInput.value);
        updateDiscountRate(id, newRate);
      }
      if (action === "delete") {
        deleteDiscount(id);
      }
    });

    els.manualExportButton.addEventListener("click", () => {
      if (!state.sales.length) {
        setStatus("まだ売上データがありません。", "error");
        return;
      }
      exportSalesToExcel();
      setStatus("売上データをエクスポートしました。", "success");
    });
  }

  function loadState() {
    state.products = loadFromStorage(STORAGE_KEYS.PRODUCTS, DEFAULT_PRODUCTS).map(
      normalizeProduct
    );
    state.discounts = loadFromStorage(STORAGE_KEYS.DISCOUNTS, DEFAULT_DISCOUNTS);
    state.sales = loadFromStorage(STORAGE_KEYS.SALES, []);
    const settings = loadFromStorage(STORAGE_KEYS.SHEETS, null);
    if (settings) {
      try { state.sheets = MitasaiSheets.normalizeSettings(settings); }
      catch { /* Ignore an invalid saved connection without losing sales. */ }
    }
    ensureDefaultDiscount();
    state.selectedDiscountId = state.discounts[0]?.id ?? null;
  }

  function ensureDefaultDiscount() {
    if (!state.discounts.some((d) => d.rate === 0)) {
      state.discounts.unshift({ id: "discount-none", label: "割引なし", rate: 0 });
      persistDiscounts();
    }
  }

  function loadFromStorage(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : clone(fallback);
    } catch (error) {
      console.warn(`Failed to parse ${key}`, error);
      return clone(fallback);
    }
  }

  function persistProducts() {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(state.products));
  }

  function persistDiscounts() {
    localStorage.setItem(STORAGE_KEYS.DISCOUNTS, JSON.stringify(state.discounts));
  }

  function persistSales() {
    localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(state.sales));
  }

  function renderAll() {
    renderProducts();
    renderCartSummary();
    renderDiscountOptions();
    renderAdminProducts();
    renderAdminDiscounts();
  }

  function escapeHtml(value) {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(value).replace(/[&<>"']/g, (char) => entities[char]);
  }

  function renderProducts() {
    els.productList.innerHTML = "";
    state.products.forEach((product) => {
      const quantity = state.cart[product.id] ?? 0;
      const onSale = product.price < (product.basePrice ?? product.price);
      const card = document.createElement("div");
      card.className = "product-card";
      card.innerHTML = `
        <h3>${escapeHtml(product.name)}</h3>
        <p class="product-price">
          ${currency.format(product.price)}
          ${onSale ? '<span class="sale-pill">−100円</span>' : ""}
        </p>
        ${
          onSale
            ? `<p class="price-note">標準: ${currency.format(product.basePrice)}</p>`
            : ""
        }
        <div class="qty-control">
          <button data-action="dec" data-id="${escapeHtml(product.id)}">−</button>
          <span class="qty-value">${quantity}</span>
          <button data-action="inc" data-id="${escapeHtml(product.id)}">＋</button>
        </div>
      `;
      els.productList.appendChild(card);
    });
  }

  function renderCartSummary() {
    const items = getCartItems();
    if (!items.length) {
      els.cartItems.classList.add("empty-state");
      els.cartItems.textContent = "商品が選択されていません";
    } else {
      els.cartItems.classList.remove("empty-state");
      els.cartItems.innerHTML = "";
      items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "cart-row";
        row.innerHTML = `
          <span>${escapeHtml(item.name)} × ${item.quantity}</span>
          <span>${currency.format(item.lineTotal)}</span>
        `;
        els.cartItems.appendChild(row);
      });
    }

    const totals = computeTotals(items);
    els.subtotal.textContent = currency.format(totals.subtotal);
    els.discountAmount.textContent = `−${currency.format(totals.discountAmount)}`;
    els.grandTotal.textContent = currency.format(totals.total);
  }

  function renderDiscountOptions() {
    const fallbackId = state.discounts[0]?.id ?? null;
    const currentSelection = state.discounts.some(
      (d) => d.id === state.selectedDiscountId
    )
      ? state.selectedDiscountId
      : fallbackId;
    els.discountSelect.innerHTML = state.discounts
      .map(
        (discount) => `
        <option value="${escapeHtml(discount.id)}">
          ${escapeHtml(discount.label)} (${escapeHtml(discount.rate)}%)
        </option>`
      )
      .join("");
    state.selectedDiscountId = currentSelection;
    if (currentSelection) {
      els.discountSelect.value = currentSelection;
    }
  }

  function renderAdminProducts() {
    if (!state.products.length) {
      els.adminProductList.innerHTML = "<p>商品が登録されていません。</p>";
      return;
    }
    els.adminProductList.innerHTML = state.products
      .map((product) => {
        const onSale = product.price < product.basePrice;
        return `
        <div class="admin-row" data-product-id="${escapeHtml(product.id)}">
          <div>
            <h3>${escapeHtml(product.name)}</h3>
            <small>ID: ${escapeHtml(product.id)}</small><br />
            <small>標準価格: ${currency.format(product.basePrice)}</small>
            ${
              onSale
                ? '<small class="sale-flag">※100円引き適用中</small>'
                : ""
            }
          </div>
          <input
            type="number"
            min="0"
            data-price-id="${escapeHtml(product.id)}"
            value="${escapeHtml(product.price)}"
          />
          <button class="ghost" data-product-action="save" data-id="${escapeHtml(product.id)}">
            価格更新
          </button>
          <button class="ghost" data-product-action="sale" data-id="${escapeHtml(product.id)}">
            100円引き
          </button>
          <button class="ghost" data-product-action="reset" data-id="${escapeHtml(product.id)}" ${
            product.price === product.basePrice ? "disabled" : ""
          }>
            標準に戻す
          </button>
          <button class="danger" data-product-action="delete" data-id="${escapeHtml(product.id)}">
            削除
          </button>
        </div>
      `;
      })
      .join("");
  }

  function renderAdminDiscounts() {
    if (!state.discounts.length) {
      els.adminDiscountList.innerHTML = "<p>割引が登録されていません。</p>";
      return;
    }
    els.adminDiscountList.innerHTML = state.discounts
      .map(
        (discount) => `
        <div class="admin-row" data-discount-id="${escapeHtml(discount.id)}">
          <div>
            <h3>${escapeHtml(discount.label)}</h3>
            <small>ID: ${escapeHtml(discount.id)}</small>
          </div>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            data-rate-id="${escapeHtml(discount.id)}"
            value="${escapeHtml(discount.rate)}"
          />
          <button class="ghost" data-discount-action="save" data-id="${escapeHtml(discount.id)}">
            割引率更新
          </button>
          ${
            discount.rate === 0
              ? `<button class="ghost" disabled>削除不可</button>`
              : `<button class="danger" data-discount-action="delete" data-id="${escapeHtml(discount.id)}">削除</button>`
          }
        </div>
      `
      )
      .join("");
  }

  function getCartItems() {
    return Object.entries(state.cart)
      .map(([id, quantity]) => {
        const product = state.products.find((p) => p.id === id);
        if (!product) return null;
        return {
          ...product,
          quantity,
          lineTotal: product.price * quantity,
        };
      })
      .filter(Boolean);
  }

  function adjustQuantity(productId, delta) {
    const next = Math.max(0, (state.cart[productId] ?? 0) + delta);
    if (next === 0) {
      delete state.cart[productId];
    } else {
      state.cart[productId] = next;
    }
    renderProducts();
    renderCartSummary();
  }

  function computeTotals(items) {
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const discount = getSelectedDiscount();
    const discountAmount = Math.round((subtotal * (discount?.rate ?? 0)) / 100);
    const total = subtotal - discountAmount;
    return {
      subtotal,
      discountAmount,
      total: Math.max(0, total),
      discount,
      totalQuantity,
    };
  }

  function getSelectedDiscount() {
    return state.discounts.find((d) => d.id === state.selectedDiscountId);
  }

  function handleCheckout() {
    if (state.checkingTarget) return;
    const items = getCartItems();
    if (!items.length) {
      setStatus("商品を選択してください。", "error");
      return;
    }
    const totals = computeTotals(items);
    const timestamp = new Date().toISOString();
    const saleRecord = {
      id: `sale-${crypto.randomUUID()}`,
      timestamp,
      items: items.map((item) => ({
        productId: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        lineTotal: item.lineTotal,
      })),
      subtotal: totals.subtotal,
      discountLabel: totals.discount?.label ?? "割引なし",
      discountRate: totals.discount?.rate ?? 0,
      discountAmount: totals.discountAmount,
      total: totals.total,
      totalQuantity: totals.totalQuantity,
    };

    if (state.sheets.enabled) {
      saleRecord.sheetsSync = {
        spreadsheetId: state.sheets.spreadsheetId,
        endpoint: state.sheets.endpoint,
        status: "pending",
      };
    }
    state.sales.push(saleRecord);
    try {
      persistSales();
    } catch {
      state.sales.pop();
      setStatus("端末に保存できませんでした。カートは保持しています。空き容量を確認してください。", "error");
      return;
    }
    state.cart = {};
    renderProducts();
    renderCartSummary();
    setStatus("会計データを保存しました。管理画面からエクスポートできます。", "success");
    renderSheetsStatus();
    void syncPendingSales();
  }

  function readSheetsForm() {
    return MitasaiSheets.normalizeSettings({
      enabled: els.sheetsEnabled.checked,
      spreadsheetId: els.spreadsheetUrl.value,
      endpoint: els.sheetsEndpoint.value,
      token: els.sheetsToken.value,
    });
  }

  function renderSheetsSettings() {
    const settings = state.sheets;
    els.sheetsEnabled.checked = settings.enabled || !settings.spreadsheetId;
    els.spreadsheetUrl.value = settings.spreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit` : "";
    els.sheetsEndpoint.value = settings.endpoint;
    els.sheetsToken.value = settings.token;
    els.sheetsCurrentLink.hidden = !settings.spreadsheetId;
    els.sheetsCurrentLink.textContent = settings.spreadsheetName
      ? `「${settings.spreadsheetName}」を開く` : "保存済みの記録先を開く";
    els.sheetsCurrentLink.href = settings.spreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit` : "";
    renderSheetsStatus();
  }

  function renderSheetsStatus(message = "", error = false) {
    const pending = state.sales.filter((sale) => sale.sheetsSync?.status === "pending");
    const current = pending.filter((sale) => MitasaiSheets.matchesTarget(sale, state.sheets));
    const mode = state.sheets.enabled ? "自動記録：有効" : "自動記録：停止中（会計は端末に保存）";
    els.sheetsStatus.textContent = `${mode}。未送信：${current.length}件（別の記録先：${pending.length - current.length}件）。${message}`;
    els.sheetsStatus.classList.toggle("status-error", error);
    els.sheetsRetry.disabled = state.syncing || state.checkingTarget || !current.length || !state.sheets.enabled;
  }

  async function saveSheetsSettings(event) {
    event.preventDefault();
    if (state.syncing || state.checkingTarget) return;
    const fields = [...els.sheetsForm.querySelectorAll("input, button")];
    let message = "";
    let failed = false;
    try {
      // Turning off an existing or unconfigured connection must always be possible.
      const settings = els.sheetsEnabled.checked ? readSheetsForm() : { ...state.sheets, enabled: false };
      if (settings.enabled) {
        state.checkingTarget = true;
        els.checkoutButton.disabled = true;
        fields.forEach((field) => { field.disabled = true; });
        renderSheetsStatus("記録先への接続を確認しています…");
        const result = await MitasaiSheets.request(settings, "check");
        settings.spreadsheetName = result.spreadsheetName;
      }
      localStorage.setItem(STORAGE_KEYS.SHEETS, JSON.stringify(settings));
      state.sheets = settings;
      renderSheetsSettings();
      message = "設定を保存しました。";
    } catch (error) {
      message = error.message;
      failed = true;
    } finally {
      if (state.checkingTarget) {
        state.checkingTarget = false;
        els.checkoutButton.disabled = false;
        fields.forEach((field) => { field.disabled = false; });
      }
      renderSheetsStatus(message, failed);
      if (!failed) void syncPendingSales();
    }
  }

  async function testSheetsConnection() {
    els.sheetsTest.disabled = true;
    try {
      const settings = readSheetsForm();
      renderSheetsStatus("接続を確認しています…");
      const result = await MitasaiSheets.request(settings, "check");
      renderSheetsStatus(`「${result.spreadsheetName}」に接続できました。記録先を保存すると反映されます。`);
    } catch (error) {
      renderSheetsStatus(`接続を確認できませんでした：${error.message}`, true);
    } finally {
      els.sheetsTest.disabled = false;
    }
  }

  async function syncPendingSales() {
    if (state.syncing || state.checkingTarget || !state.sheets.enabled ||
        !state.sales.some((sale) => sale.sheetsSync?.status === "pending" && MitasaiSheets.matchesTarget(sale, state.sheets))) return;
    state.syncing = true;
    const settings = { ...state.sheets };
    // Freeze connection fields while a request is in flight; checkout remains available.
    const fields = [...els.sheetsForm.querySelectorAll("input, button")];
    fields.forEach((field) => { field.disabled = true; });
    let failure = "";
    try {
      for (const sale of state.sales) {
        if (sale.sheetsSync?.status !== "pending" || !MitasaiSheets.matchesTarget(sale, settings)) continue;
        renderSheetsStatus("スプレッドシートに記録しています…");
        await MitasaiSheets.request(settings, "append", {
          id: sale.id, timestamp: sale.timestamp, items: sale.items,
          subtotal: sale.subtotal, discountLabel: sale.discountLabel,
          discountRate: sale.discountRate, discountAmount: sale.discountAmount,
          total: sale.total, totalQuantity: sale.totalQuantity,
        });
        sale.sheetsSync.status = "sent";
        try { persistSales(); }
        catch (error) { sale.sheetsSync.status = "pending"; throw error; }
      }
    } catch (error) {
      failure = `未送信分を端末に保持しています。接続設定や通信を確認し、再送してください：${error.message}`;
    } finally {
      state.syncing = false;
      fields.forEach((field) => { field.disabled = false; });
      renderSheetsStatus(failure, Boolean(failure));
    }
  }

  function exportSalesToExcel() {
    if (typeof XLSX === "undefined") {
      setStatus("Excel ライブラリの読み込みに失敗しました。", "error");
      return;
    }

    if (!state.sales.length) {
      setStatus("売上データがありません。", "error");
      return;
    }

    const workbook = XLSX.utils.book_new();
    const logSheet = XLSX.utils.json_to_sheet(
      state.sales.map((sale, index) => ({
        No: index + 1,
        日時: new Date(sale.timestamp).toLocaleString("ja-JP"),
        商品内訳: sale.items
          .map((i) => `${i.name}×${i.quantity}`)
          .join(", "),
        小計: sale.subtotal,
        割引: `${sale.discountLabel} (-${sale.discountAmount})`,
        合計: sale.total,
        個数計: sale.totalQuantity,
      }))
    );
    XLSX.utils.book_append_sheet(workbook, logSheet, "SalesLog");

    const { totalAmount, totalQuantity } = state.sales.reduce(
      (acc, sale) => {
        acc.totalAmount += sale.total;
        acc.totalQuantity += sale.totalQuantity;
        return acc;
      },
      { totalAmount: 0, totalQuantity: 0 }
    );

    const summarySheet = XLSX.utils.aoa_to_sheet([
      ["項目", "値"],
      ["売上合計金額", totalAmount],
      ["売上総数", totalQuantity],
      ["会計件数", state.sales.length],
    ]);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

    const slotMap = {};
    state.sales.forEach((sale) => {
      const slotKey = createTimeSlotLabel(new Date(sale.timestamp));
      slotMap[slotKey] = (slotMap[slotKey] ?? 0) + sale.totalQuantity;
    });
    const slotRows = [["時間帯 (2h)", "売上個数"]];
    Object.entries(slotMap)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .forEach(([slot, qty]) => slotRows.push([slot, qty]));
    const slotSheet = XLSX.utils.aoa_to_sheet(slotRows);
    XLSX.utils.book_append_sheet(workbook, slotSheet, "ByTimeSlot");

    const stamp = new Date();
    const fileName = `mitasai_sales_${stamp
      .toISOString()
      .replace(/[:]/g, "-")
      .split(".")[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }

  function createTimeSlotLabel(date) {
    const startHour = Math.floor(date.getHours() / 2) * 2;
    const endHour = (startHour + 2) % 24;
    const day = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(
      2,
      "0"
    )}/${String(date.getDate()).padStart(2, "0")}`;
    return `${day} ${String(startHour).padStart(2, "0")}:00-${String(
      endHour
    ).padStart(2, "0")}:00`;
  }

  function switchScreen(targetId, button) {
    els.screens.forEach((screen) => {
      screen.classList.toggle("active", screen.id === targetId);
    });
    els.tabButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
  }

  function updateProductPrice(id, newPrice) {
    if (Number.isNaN(newPrice) || newPrice < 0) {
      setStatus("有効な価格を入力してください。", "error");
      return;
    }
    const product = state.products.find((p) => p.id === id);
    if (!product) return;
    const rounded = Math.round(newPrice);
    product.price = rounded;
    product.basePrice = rounded;
    persistProducts();
    renderProducts();
    renderAdminProducts();
    renderCartSummary();
    setStatus(`「${product.name}」の価格を更新しました。`, "success");
  }

  function applyHundredYenDiscount(id) {
    const product = state.products.find((p) => p.id === id);
    if (!product) return;
    const adjusted = Math.max(0, product.basePrice - 100);
    if (product.price === adjusted) {
      setStatus(`「${product.name}」は既に100円引きです。`, "info");
      return;
    }
    product.price = adjusted;
    persistProducts();
    renderProducts();
    renderAdminProducts();
    renderCartSummary();
    setStatus(`「${product.name}」を100円引きに調整しました。`, "success");
  }

  function resetProductPrice(id) {
    const product = state.products.find((p) => p.id === id);
    if (!product) return;
    if (product.price === product.basePrice) {
      setStatus(`「${product.name}」は標準価格です。`, "info");
      return;
    }
    product.price = product.basePrice;
    persistProducts();
    renderProducts();
    renderAdminProducts();
    renderCartSummary();
    setStatus(`「${product.name}」の価格を標準に戻しました。`, "success");
  }

  function deleteProduct(id) {
    const product = state.products.find((p) => p.id === id);
    if (!product) return;
    state.products = state.products.filter((p) => p.id !== id);
    delete state.cart[id];
    persistProducts();
    renderProducts();
    renderAdminProducts();
    renderCartSummary();
    setStatus(`「${product.name}」を削除しました。`, "success");
  }

  function updateDiscountRate(id, newRate) {
    if (Number.isNaN(newRate) || newRate < 0 || newRate > 100) {
      setStatus("0〜100% の範囲で入力してください。", "error");
      return;
    }
    const discount = state.discounts.find((d) => d.id === id);
    if (!discount) return;
    discount.rate = Math.round(newRate);
    persistDiscounts();
    renderDiscountOptions();
    renderAdminDiscounts();
    renderCartSummary();
    setStatus(`「${discount.label}」の割引率を更新しました。`, "success");
  }

  function deleteDiscount(id) {
    const discount = state.discounts.find((d) => d.id === id);
    if (!discount) return;
    if (discount.rate === 0) {
      setStatus("割引なし設定は削除できません。", "error");
      return;
    }
    state.discounts = state.discounts.filter((d) => d.id !== id);
    persistDiscounts();
    if (state.selectedDiscountId === id) {
      state.selectedDiscountId = state.discounts[0]?.id ?? null;
    }
    renderDiscountOptions();
    renderAdminDiscounts();
    renderCartSummary();
    setStatus(`割引「${discount.label}」を削除しました。`, "success");
  }

  function setStatus(message, type = "info") {
    els.statusMessage.textContent = message;
    els.statusMessage.classList.remove("status-success", "status-error");
    if (type === "success") {
      els.statusMessage.classList.add("status-success");
    } else if (type === "error") {
      els.statusMessage.classList.add("status-error");
    }
  }
})();

