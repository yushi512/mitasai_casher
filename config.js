window.MITASAI_CONFIG = {
  /**
   * Google Apps Script で公開した Web アプリの URL。
   * 例: https://script.google.com/macros/s/XXXXX/exec
   */
  sheetsEndpoint:
    "https://script.google.com/macros/s/AKfycbwS6cF3JKJK35fcgajPXpjABEIvA1t9Fv6FfzdVC4naJLdMZyoiCmr35kNI_FkV_Uhc/exec",

  /**
   * 任意の共有用キー。Apps Script 側で照合して簡易認証に使います。
   */
  sheetsApiKey: "keio-rover-mitasai-chasher",

  /**
   * フロントエンドからの送信タイムアウト (ミリ秒)
   */
  sheetsTimeoutMs: 7000,
};
