const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const exposedSource = source.replace(
  "  initialize();",
  "  globalThis.richTextTest = { renderRichText, toArtwork };",
);
assert.notEqual(exposedSource, source);
const context = {
  URL,
  console: { warn() {} },
  window: {
    PORTFOLIO_CONFIG: { apiBaseUrl: "https://cms.example/api", endpoints: {} },
    location: { href: "https://portfolio.example/" },
    matchMedia: () => ({ matches: false }),
  },
  document: {
    querySelector: () => ({ querySelector: () => ({}) }),
  },
};
vm.runInNewContext(exposedSource, context);
const { renderRichText, toArtwork } = context.richTextTest;
const text = (value, modifiers = {}) => ({ type: "text", text: value, ...modifiers });

test("renders blocks, nested formatting, empty paragraphs, and nested lists", () => {
  const blocks = [
    { type: "heading", level: 2, children: [text("Заголовок")] },
    { type: "paragraph", children: [text("Жирный курсив", { bold: true, italic: true }), text(" "), text("код", { underline: true, strikethrough: true, code: true })] },
    { type: "paragraph", children: [text("")] },
    { type: "list", format: "unordered", children: [
      { type: "list-item", children: [text("Первый"), { type: "list", format: "ordered", children: [
        { type: "list-item", children: [text("Вложенный")] },
      ] }] },
    ] },
    { type: "quote", children: [text("Цитата")] },
    { type: "code", children: [text("a < b")] },
  ];
  assert.equal(renderRichText(toArtwork({ description: blocks }).description),
    "<h2>Заголовок</h2>"
    + "<p><em><strong>Жирный курсив</strong></em> <code><s><u>код</u></s></code></p>"
    + "<p><br></p>"
    + "<ul><li>Первый<ol><li>Вложенный</li></ol></li></ul>"
    + "<blockquote>Цитата</blockquote><pre><code>a &lt; b</code></pre>");
});

test("escapes content, permits safe links, and rejects dangerous URLs", () => {
  const blocks = [
    { type: "paragraph", children: [
      text("<img src=x onerror=alert(1)> &"),
      { type: "link", url: "https://example.com/?a=1&b=2", children: [text('"Ссылка"')] },
      { type: "link", url: "javascript:alert(1)", children: [text("опасная")] },
    ] },
    { type: "image", image: { url: "/uploads/art.png", alternativeText: '"><script>' } },
  ];
  assert.equal(renderRichText(blocks),
    "<p>&lt;img src=x onerror=alert(1)&gt; &amp;"
    + '<a href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">&quot;Ссылка&quot;</a>опасная</p>'
    + '<figure><img src="https://cms.example/uploads/art.png" alt="&quot;&gt;&lt;script&gt;" loading="lazy"></figure>');
});

test("preserves plain-text descriptions and handles missing descriptions", () => {
  assert.equal(renderRichText("Первая\nВторая <строка>"), "<p>Первая\nВторая &lt;строка&gt;</p>");
  assert.equal(renderRichText([]), "<p>Описание пока не добавлено.</p>");
});

test("renders all heading levels and rejects unsafe image URLs", () => {
  const headings = Array.from({ length: 6 }, (_, index) => ({
    type: "heading",
    level: index + 1,
    children: [text(`Уровень ${index + 1}`)],
  }));
  const unsafeImage = { type: "image", image: { url: "javascript:alert(1)" } };
  assert.equal(renderRichText([...headings, unsafeImage]),
    headings.map((heading) => `<h${heading.level}>Уровень ${heading.level}</h${heading.level}>`).join(""));
});
