const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.resolve(process.argv[2] || path.join(root, "dist", "apps-script"));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function inlineAsset(html, tag, replacement) {
  if (!html.includes(tag)) throw new Error(`Missing asset tag in index.html: ${tag}`);
  return html.replace(tag, () => replacement);
}

let html = read("index.html").replace('<html lang="ja">', '<html lang="ja" data-host="apps-script">');
html = inlineAsset(html, '<link rel="stylesheet" href="styles.css" />', `<style>\n${read("styles.css")}\n</style>`);
const scripts = ["sheets-sync.js", "app.js"].map((file) => {
  html = inlineAsset(html, `<script defer src="${file}?v=sheets-3"></script>`, "");
  return `<script>\n${read(file)}\n</script>`;
});
html = inlineAsset(html, "</body>", `${scripts.join("\n")}\n</body>`);

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "Index.html"), html);
for (const file of ["Code.gs", "appsscript.json"]) {
  fs.copyFileSync(path.join(__dirname, file), path.join(output, file));
}
console.log(`Apps Script files: ${output}`);
