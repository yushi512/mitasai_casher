window.MITASAI_CONFIG = {
  /**
   * Google Apps Script で公開した Web アプリの URL。
   * 例: https://script.google.com/macros/s/XXXXX/exec
   */
  sheetsEndpoint:
    "https://script.google.com/macros/s/AKfycbzqQn_HoaYhdu3Vyx28yDr09mYtGtVoYJ5wVufoJqJ1UNGz3TVLre4bW2xYn1GrWGG3/exec",

  /**
   * 任意の共有用キー。Apps Script 側で照合して簡易認証に使います。
   */
  sheetsApiKey: "keio-rover-mitasai-chasher",

  /**
   * フロントエンドからの送信タイムアウト (ミリ秒)
   */
  sheetsTimeoutMs: 7000,
};
