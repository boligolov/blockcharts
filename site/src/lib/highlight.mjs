// Code highlighting for the site, at build time, with Shiki: the VS Code palettes (light-plus, dark-plus), emitted both at
// once as CSS variables so site.css can follow the page theme; nothing runs in the browser.
//
// One addition to Shiki: the HTML grammar leaves the body of <script type="application/json"> uncolored, and on this site
// that body is the chart spec — the part worth reading. So an HTML snippet is cut into line runs: the runs inside such a
// tag are highlighted as JSON, the rest as HTML, and the lines are put back in order.
import { createHighlighter } from 'shiki';

const THEMES = { light: 'light-plus', dark: 'dark-plus' };
const LANGS = ['json', 'jsonc', 'html', 'javascript', 'css', 'shellscript'];
const ALIASES = { js: 'javascript', sh: 'shellscript', bash: 'shellscript', text: 'plaintext' };

let highlighter;
const ready = () => (highlighter ||= createHighlighter({ themes: Object.values(THEMES), langs: LANGS }));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const styleOf = (vars) => Object.entries(vars || {}).map(([k, v]) => `${k}:${v}`).join(';');

/** Lines of tokens ({ content, htmlStyle }) for one run of code in one language. */
function tokenLines(h, code, lang) {
  if (lang === 'plaintext') return code.split('\n').map((line) => [{ content: line }]);
  return h.codeToTokens(code, { lang, themes: THEMES, defaultColor: false }).tokens;
}

/** An HTML snippet as runs of lines: [{ lang: 'html' | 'json', code }], JSON for the bodies of JSON script tags. */
export function splitHtml(code) {
  const runs = [];
  const push = (lang, line) => {
    const last = runs[runs.length - 1];
    if (last && last.lang === lang) last.lines.push(line);
    else runs.push({ lang, lines: [line] });
  };
  let inJson = false;
  for (const line of code.split('\n')) {
    if (inJson && /^\s*<\/script>/i.test(line)) inJson = false;
    push(inJson ? 'json' : 'html', line);
    // a JSON tag whose body starts on the next line (the way every snippet here is written)
    if (!inJson && /<script\b[^>]*type=["']application\/json["'][^>]*>\s*$/i.test(line)) inJson = true;
  }
  return runs.map((r) => ({ lang: r.lang, code: r.lines.join('\n') }));
}

/** The highlighted <pre>, as an HTML string. */
export async function highlight(code, lang) {
  const h = await ready();
  const l = ALIASES[lang] || lang || 'plaintext';
  const runs = l === 'html' ? splitHtml(code) : [{ lang: l, code }];
  const lines = runs.flatMap((r) => tokenLines(h, r.code, r.lang));
  const body = lines
    .map((tokens) => `<span class="line">${tokens.map((t) => (t.htmlStyle ? `<span style="${styleOf(t.htmlStyle)}">${esc(t.content)}</span>` : esc(t.content))).join('')}</span>`)
    .join('\n');
  return `<pre class="astro-code shiki" data-lang="${esc(l)}" tabindex="0"><code>${body}</code></pre>`;
}
