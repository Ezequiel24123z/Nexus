import { htmlToReadableText, DEFAULT_BROWSER_USER_AGENT } from './coding-engine.mjs';

// Specialized Fast Agent Browser Engine (Lightpanda / Playwright-MCP / Vercel agent-browser inspired).
// Converts any web page into an ultra-compact LLM-optimized Accessibility & Interactive Element Ref Snapshot
// (@e1, @e2, @e3...) + clean Markdown with zero GPU/browser overhead and 100% Tor/SOCKS5h compatibility.

const clean = s => String(s || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? clean(m[1] ?? m[2] ?? m[3] ?? '') : '';
}

// CSS.escape-equivalent for ids: escape anything that is not a safe identifier
// character, including quotes/backslashes that would break the selector.
function cssEscape(value) {
  const str = String(value || '');
  const first = str.charCodeAt(0);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = ch.codePointAt(0);
    if (code === 0) { out += '\uFFFD'; continue; }
    const isDigit = code >= 0x30 && code <= 0x39;
    // Digits are unsafe at the start, and at index 1 when the id begins with '-'.
    const digitAtStart = (i === 0 && isDigit) || (i === 1 && isDigit && first === 0x2d);
    if (code < 0x20 || code === 0x7f || digitAtStart) {
      out += `\\${code.toString(16)} `;
      continue;
    }
    const isSafe = /[A-Za-z0-9_-]/.test(ch) || code > 0x7f;
    if (isSafe) { out += ch; continue; }
    out += `\\${ch}`;
  }
  return out;
}

// Escape a value for use inside a double-quoted attribute selector.
function attrEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function makeSelector(tagName, tagAttrs) {
  const id = attr(tagAttrs, 'id');
  if (id) return `#${cssEscape(id)}`;
  const name = attr(tagAttrs, 'name');
  if (name) return `${tagName}[name="${attrEscape(name)}"]`;
  const aria = attr(tagAttrs, 'aria-label');
  if (aria) return `${tagName}[aria-label="${attrEscape(aria)}"]`;
  return tagName;
}

export function buildFastAgentSnapshot(html = '', urlInput = '', status = 200) {
  const parsed = new URL(urlInput);
  const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleM ? clean(titleM[1]) : parsed.hostname;
  const metaDescM = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(html);
  const description = metaDescM ? clean(metaDescM[1]) : '';

  const stripped = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  const headings = [];
  for (const m of stripped.matchAll(/<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = clean(m[2]);
    if (text && headings.length < 30) headings.push({ level: m[1].toLowerCase(), text: text.slice(0, 180) });
  }

  let refSeq = 0;
  const nextRef = () => `@e${++refSeq}`;
  const refs = [];
  const links = [];
  const forms = [];

  // Extract forms & inputs as numbered @eN refs
  for (const fm of stripped.matchAll(/<form([^>]*)>([\s\S]*?)<\/form>/gi)) {
    if (forms.length >= 15) break;
    const actionAttr = attr(fm[1], 'action') || parsed.pathname;
    const methodAttr = (attr(fm[1], 'method') || 'GET').toUpperCase();
    const fields = [];
    const fieldRefs = [];
    for (const im of fm[2].matchAll(/<input\b([^>]*?)\/?>|<(textarea|select|button)\b([^>]*)>([\s\S]*?)<\/\2>/gi)) {
      if (fieldRefs.length >= 25 || refs.length >= 80) break;
      const isInput = !im[2];
      const tag = isInput ? 'input' : im[2].toLowerCase();
      const rawAttrs = isInput ? im[1] : im[3];
      const inner = isInput ? '' : (im[4] || '');
      const type = attr(rawAttrs, 'type').toLowerCase() || (tag === 'button' ? 'button' : tag);
      if (type === 'hidden') continue;
      const name = attr(rawAttrs, 'name');
      const placeholder = attr(rawAttrs, 'placeholder');
      const aria = attr(rawAttrs, 'aria-label');
      const labelText = clean(inner) || aria || placeholder || name || type;
      const ref = nextRef();
      const selector = makeSelector(tag, rawAttrs);
      const entry = { ref, role: tag === 'input' ? `input:${type}` : tag, name: labelText.slice(0, 100), selector, ...(name ? { fieldName: name } : {}) };
      refs.push(entry);
      fieldRefs.push(entry);
      if (name) fields.push(name);
    }
    forms.push({ action: new URL(actionAttr, parsed.href).href, method: methodAttr, fields, fieldRefs });
  }

  // Extract prominent links as @eN refs
  const seenUrls = new Set();
  for (const lm of stripped.matchAll(/<a([^>]+href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (links.length >= 50 || refs.length >= 100) break;
    let href;
    try {
      href = new URL(lm[2], parsed.href).href;
      if (!['http:', 'https:'].includes(new URL(href).protocol)) continue;
    } catch { continue; }
    if (seenUrls.has(href)) continue;
    seenUrls.add(href);
    const label = clean(lm[3]) || attr(lm[1], 'aria-label') || href;
    const ref = nextRef();
    const selector = makeSelector('a', lm[1]);
    refs.push({ ref, role: 'link', name: label.slice(0, 110), url: href, selector });
    links.push({ ref, text: label.slice(0, 110), url: href, selector });
  }

  const markdown = htmlToReadableText(stripped).slice(0, 18000);
  const snapshotLines = [
    `# ${title}`,
    `URL: ${parsed.href}`,
    ...(description ? [`Summary: ${description}`] : []),
    '',
    '## Interactive Elements (@ref)',
    ...refs.slice(0, 60).map(r => `${r.ref} [${r.role}] "${r.name}"${r.url ? ` -> ${r.url}` : ''}`),
    '',
    '## Readable Content',
    markdown.slice(0, 12000),
  ];

  return {
    url: parsed.href,
    title,
    description,
    status,
    renderedJs: false,
    engine: 'agent-fast',
    headings,
    links,
    forms,
    refs,
    interactiveElements: refs,
    text: markdown,
    agentSnapshot: snapshotLines.join('\n'),
  };
}

export async function runFastAgentBrowser(urlInput, { request = fetch, userAgent = DEFAULT_BROWSER_USER_AGENT, signal } = {}) {
  let parsed;
  try { parsed = new URL(urlInput); } catch { throw new Error('Invalid URL provided to agent browser.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  const res = await request(parsed.href, {
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'DNT': '1',
      'Sec-GPC': '1',
    },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
  });
  const html = await res.text();
  return buildFastAgentSnapshot(html, res.url || parsed.href, res.status);
}

export function formatAgentSnapshotText(page = {}) {
  if (page.agentSnapshot) return page.agentSnapshot;
  const refs = page.refs || page.interactiveElements || [];
  const lines = [
    `# ${page.title || page.url || 'Page'}`,
    `URL: ${page.url || ''} (engine: ${page.engine || 'webview2'}${page.renderedJs ? ', JS rendered' : ''})`,
    '',
    '## Interactive Elements (@ref)',
    ...refs.slice(0, 60).map((r, i) => `${r.ref || '@e' + (i + 1)} [${r.role || r.tag || 'el'}] "${r.name || r.text || ''}"${r.url ? ` -> ${r.url}` : ''}${r.selector ? ` (${r.selector})` : ''}`),
    '',
    '## Readable Content',
    String(page.text || '').slice(0, 14000),
  ];
  return lines.join('\n');
}
