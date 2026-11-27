import { DEFAULT_BROWSER_USER_AGENT } from './coding-engine.mjs';
import { isOnionHost } from './privacy-proxy.mjs';

// Multi-tier search provider catalog ranked transparently by privacy & tracking guarantees.
export const SEARCH_PROVIDER_CATALOG = [
  {
    id: 'auto',
    name: 'Smart Privacy Cascade (Auto)',
    tier: 'zero-track',
    requiresKey: false,
    torOnly: false,
    privacy: 'Respects Strict Zero-Track: uses configured SearXNG/Brave/Kagi/LangSearch → DuckDuckGo → optional regular fallback.',
  },
  {
    id: 'searxng',
    name: 'SearXNG (Self-Hosted / Custom Zero-Log)',
    tier: 'zero-track',
    requiresKey: false,
    torOnly: false,
    privacy: 'Gold standard: 100% open-source meta-search, zero query logs, zero profiling, self-hostable on localhost or private VPS.',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo (Zero-History HTML / Onion)',
    tier: 'zero-track',
    requiresKey: false,
    torOnly: false,
    privacy: 'No search history stored, no user profiling, works without an API key; supports Tor routing seamlessly.',
  },
  {
    id: 'mojeek',
    name: 'Mojeek (Independent Zero-Track Index)',
    tier: 'zero-track',
    requiresKey: false,
    secretKey: 'SEARCH_MOJEEK_KEY',
    torOnly: false,
    privacy: 'Fully independent crawler & index (not Google/Bing wrapper) with strict no-tracking policy.',
  },
  {
    id: 'brave',
    name: 'Brave Search API (Independent · ZDR Capable)',
    tier: 'ai-private',
    requiresKey: true,
    secretKey: 'SEARCH_BRAVE_KEY',
    torOnly: false,
    privacy: 'Independent index; never trains AI models on results; Enterprise Zero Data Retention (ZDR) available.',
  },
  {
    id: 'kagi',
    name: 'Kagi Search API (Paid Ad-Free Zero-Track)',
    tier: 'ai-private',
    requiresKey: true,
    secretKey: 'SEARCH_KAGI_KEY',
    torOnly: false,
    privacy: 'Subscription-funded, zero ads, zero tracking, zero query monetization.',
  },
  {
    id: 'langsearch',
    name: 'LangSearch API (Semantic AI Full-Text)',
    tier: 'ai-specialized',
    requiresKey: true,
    secretKey: 'SEARCH_LANGSEARCH_KEY',
    torOnly: false,
    privacy: 'Specialized AI search API returning clean full-text/markdown snippets optimized for LLMs.',
  },
  {
    id: 'tavily',
    name: 'Tavily AI Search API',
    tier: 'ai-specialized',
    requiresKey: true,
    secretKey: 'SEARCH_TAVILY_KEY',
    torOnly: false,
    privacy: 'Agent-optimized search + extracted clean answers (cloud API; review retention policy for sensitive queries).',
  },
  {
    id: 'exa',
    name: 'Exa Neural Search API',
    tier: 'ai-specialized',
    requiresKey: true,
    secretKey: 'SEARCH_EXA_KEY',
    torOnly: false,
    privacy: 'High-signal neural search for docs & research. Disclosure: standard Exa policy permits query data use for training unless opted out.',
  },
  {
    id: 'ahmia',
    name: 'Ahmia (Tor .onion Index · Filtered)',
    tier: 'onion',
    requiresKey: false,
    torOnly: false,
    privacy: 'Indexes Tor hidden services (.onion) while filtering malware/abuse. Uses .onion endpoint over Tor when active, or ahmia.fi.',
  },
  {
    id: 'torch',
    name: 'Torch (Tor .onion Search Engine)',
    tier: 'onion',
    requiresKey: false,
    torOnly: true,
    privacy: 'Classic Tor .onion hidden-service search engine. Strictly routed through Tor SOCKS5h (hard fail-closed; never leaks to clearnet DNS).',
  },
  {
    id: 'onion',
    name: 'Tor Onion Combined (Ahmia + Torch)',
    tier: 'onion',
    requiresKey: false,
    torOnly: true,
    privacy: 'Queries Tor .onion hidden-service indexes strictly via Tor SOCKS5h with zero clearnet DNS leakage.',
  },
  {
    id: 'bing-rss',
    name: 'Bing RSS (Regular Clearnet Fallback)',
    tier: 'regular',
    requiresKey: false,
    torOnly: false,
    privacy: 'Regular search engine fallback without CAPTCHAs (automatically disabled when Strict Zero-Track mode is ON).',
  },
];

export const SEARCH_SECRET_KEYS = [
  'SEARCH_BRAVE_KEY',
  'SEARCH_KAGI_KEY',
  'SEARCH_LANGSEARCH_KEY',
  'SEARCH_TAVILY_KEY',
  'SEARCH_EXA_KEY',
  'SEARCH_MOJEEK_KEY',
];

// Official Ahmia v3 onion + configurable Torch v3 onion endpoint (user can customize in Settings -> Browser/Search)
export const DEFAULT_AHMIA_ONION_URL = 'http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/search/';
export const DEFAULT_TORCH_ONION_URL = 'http://xmh57jrknzkhv6y3ls3ubitzfqnkrwxhopf5aygthi7d6rplyvk3noyd.onion/cgi-bin/omega/omega';

const cleanHtml = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

function makeHeaders(userAgent) {
  return {
    'User-Agent': userAgent || DEFAULT_BROWSER_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

function makeSignal(signal, timeoutMs = 18000) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

export async function searchSearXNG(query, { baseUrl, maxResults = 8, request = fetch, userAgent, signal } = {}) {
  const root = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!root) throw new Error('Configure a SearXNG instance URL in Settings (e.g. http://localhost:8888 or your private SearXNG server).');
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 15));

  // Try JSON API first
  try {
    const jsonUrl = `${root}/search?q=${encodeURIComponent(query)}&format=json`;
    const res = await request(jsonUrl, {
      headers: { ...makeHeaders(userAgent), Accept: 'application/json' },
      signal: makeSignal(signal, 16000),
    });
    if (res.ok) {
      const data = await res.json();
      const results = (data.results || []).slice(0, limit).map(r => ({
        title: cleanHtml(r.title || r.url),
        url: r.url,
        snippet: cleanHtml(r.content || r.snippet || ''),
        ...(r.engine ? { sourceEngine: r.engine } : {}),
      })).filter(r => r.url);
      if (results.length) return { query, engine: 'searxng', privacyTier: 'zero-track', count: results.length, results };
    }
  } catch {}

  // Fallback to HTML parsing when public SearXNG disables format=json (403)
  const htmlUrl = `${root}/search?q=${encodeURIComponent(query)}`;
  const res = await request(htmlUrl, { headers: makeHeaders(userAgent), signal: makeSignal(signal, 16000) });
  if (!res.ok) throw new Error(`SearXNG search failed (HTTP ${res.status}).`);
  const html = await res.text();
  const results = [];
  for (const m of html.matchAll(/<article[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/article>/gi)) {
    if (results.length >= limit) break;
    const block = m[1];
    const linkM = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const snipM = /<p[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    if (linkM) {
      results.push({ title: cleanHtml(linkM[2]), url: linkM[1], snippet: cleanHtml(snipM?.[1] || '') });
    }
  }
  return { query, engine: 'searxng', privacyTier: 'zero-track', count: results.length, results };
}

export async function searchBrave(query, { apiKey, maxResults = 8, request = fetch, signal } = {}) {
  if (!apiKey) throw new Error('Add SEARCH_BRAVE_KEY in Settings -> Privacy & Search to use Brave Search API.');
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 20));
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await request(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    signal: makeSignal(signal, 16000),
  });
  if (!res.ok) throw new Error(`Brave Search API failed (HTTP ${res.status}).`);
  const data = await res.json();
  const results = (data.web?.results || []).slice(0, limit).map(r => ({
    title: cleanHtml(r.title || r.url),
    url: r.url,
    snippet: cleanHtml(r.description || ''),
    ...(r.age ? { age: r.age } : {}),
  }));
  return { query, engine: 'brave', privacyTier: 'ai-private', count: results.length, results };
}

export async function searchKagi(query, { apiKey, maxResults = 8, request = fetch, signal } = {}) {
  if (!apiKey) throw new Error('Add SEARCH_KAGI_KEY in Settings -> Privacy & Search to use Kagi Search API.');
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 20));
  const url = `https://kagi.com/api/v0/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await request(url, {
    headers: { Accept: 'application/json', Authorization: `Bot ${apiKey}` },
    signal: makeSignal(signal, 16000),
  });
  if (!res.ok) throw new Error(`Kagi Search API failed (HTTP ${res.status}).`);
  const data = await res.json();
  const results = (data.data || []).filter(r => r.t === 0 && r.url).slice(0, limit).map(r => ({
    title: cleanHtml(r.title || r.url),
    url: r.url,
    snippet: cleanHtml(r.snippet || ''),
  }));
  return { query, engine: 'kagi', privacyTier: 'ai-private', count: results.length, results };
}

export async function searchLangSearch(query, { apiKey, maxResults = 8, request = fetch, signal } = {}) {
  if (!apiKey) throw new Error('Add SEARCH_LANGSEARCH_KEY in Settings -> Privacy & Search to use LangSearch API.');
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 10));
  const res = await request('https://api.langsearch.com/v1/web-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, count: limit, summary: true, freshness: 'noLimit' }),
    signal: makeSignal(signal, 20000),
  });
  if (!res.ok) throw new Error(`LangSearch API failed (HTTP ${res.status}).`);
  const data = await res.json();
  const items = data.data?.webPages?.value || data.webPages?.value || data.results || [];
  const results = items.slice(0, limit).map(r => ({
    title: cleanHtml(r.name || r.title || r.url),
    url: r.url,
    snippet: cleanHtml(r.summary || r.snippet || r.text || '').slice(0, 800),
  })).filter(r => r.url);
  return { query, engine: 'langsearch', privacyTier: 'ai-specialized', count: results.length, results };
}

export async function searchTavily(query, { apiKey, maxResults = 8, request = fetch, signal } = {}) {
  if (!apiKey) throw new Error('Add SEARCH_TAVILY_KEY in Settings -> Privacy & Search to use Tavily Search API.');
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 15));
  const res = await request('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: limit, include_answer: false }),
    signal: makeSignal(signal, 20000),
  });
  if (!res.ok) throw new Error(`Tavily Search API failed (HTTP ${res.status}).`);
  const data = await res.json();
  const results = (data.results || []).slice(0, limit).map(r => ({
    title: cleanHtml(r.title || r.url),
    url: r.url,
    snippet: cleanHtml(r.content || '').slice(0, 800),
  })).filter(r => r.url);
  return { query, engine: 'tavily', privacyTier: 'ai-specialized', count: results.length, results };
}

export async function searchExa(query, { apiKey, maxResults = 8, request = fetch, signal } = {}) {
  if (!apiKey) throw new Error('Add SEARCH_EXA_KEY in Settings -> Privacy & Search to use Exa Neural Search API.');
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 15));
  const res = await request('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query, numResults: limit, type: 'auto', contents: { highlights: true } }),
    signal: makeSignal(signal, 20000),
  });
  if (!res.ok) throw new Error(`Exa Search API failed (HTTP ${res.status}).`);
  const data = await res.json();
  const results = (data.results || []).slice(0, limit).map(r => ({
    title: cleanHtml(r.title || r.url),
    url: r.url,
    snippet: cleanHtml((r.highlights || []).join(' ') || r.text || '').slice(0, 800),
  })).filter(r => r.url);
  return { query, engine: 'exa', privacyTier: 'ai-specialized', count: results.length, results };
}

export async function searchMojeek(query, { apiKey, maxResults = 8, request = fetch, userAgent, signal } = {}) {
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 15));
  if (apiKey) {
    const url = `https://api.mojeek.com/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&t=${limit}&fmt=json`;
    const res = await request(url, { headers: { Accept: 'application/json' }, signal: makeSignal(signal, 16000) });
    if (!res.ok) throw new Error(`Mojeek API failed (HTTP ${res.status}).`);
    const data = await res.json();
    const results = (data.response?.results || []).slice(0, limit).map(r => ({
      title: cleanHtml(r.title || r.url),
      url: r.url,
      snippet: cleanHtml(r.desc || ''),
    })).filter(r => r.url);
    return { query, engine: 'mojeek', privacyTier: 'zero-track', count: results.length, results };
  }
  const url = `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`;
  const res = await request(url, { headers: makeHeaders(userAgent), signal: makeSignal(signal, 16000) });
  if (!res.ok) throw new Error(`Mojeek search failed (HTTP ${res.status}).`);
  const html = await res.text();
  const results = [];
  for (const m of html.matchAll(/<li[^>]*>[\s\S]*?<a[^>]+class="[^"]*title[^"]*"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*class="[^"]*s[^"]*"[^>]*>([\s\S]*?)<\/p>)?[\s\S]*?<\/li>/gi)) {
    if (results.length >= limit) break;
    results.push({ title: cleanHtml(m[2]), url: m[1], snippet: cleanHtml(m[3] || '') });
  }
  return { query, engine: 'mojeek', privacyTier: 'zero-track', count: results.length, results };
}

export async function searchDuckDuckGoOnly(query, { maxResults = 8, request = fetch, userAgent, signal } = {}) {
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 15));
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  const res = await request(url, { headers: makeHeaders(userAgent), signal: makeSignal(signal, 16000) });
  const results = [];
  if (res.status === 200) {
    const html = await res.text();
    const blockRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>)?/gi;
    for (const m of html.matchAll(blockRe)) {
      if (results.length >= limit) break;
      let href = m[1];
      try {
        const parsed = new URL(href, 'https://duckduckgo.com');
        const uddg = parsed.searchParams.get('uddg');
        href = uddg ? decodeURIComponent(uddg) : parsed.href;
      } catch {}
      if (!/^https?:\/\//i.test(href)) continue;
      results.push({ title: cleanHtml(m[2]), url: href, snippet: cleanHtml(m[3] || m[4] || '') });
    }
  }
  return { query, engine: 'duckduckgo', privacyTier: 'zero-track', count: results.length, results };
}

export async function searchBingRss(query, { maxResults = 8, request = fetch, userAgent, signal } = {}) {
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 15));
  const url = 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(query);
  const res = await request(url, { headers: makeHeaders(userAgent), signal: makeSignal(signal, 15000) });
  const results = [];
  if (res.status === 200) {
    const xml = await res.text();
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
      if (results.length >= limit) break;
      const block = m[1];
      const title = cleanHtml(/<title>([\s\S]*?)<\/title>/i.exec(block)?.[1] || '');
      const link = cleanHtml(/<link>([\s\S]*?)<\/link>/i.exec(block)?.[1] || '');
      const snippet = cleanHtml(/<description>([\s\S]*?)<\/description>/i.exec(block)?.[1] || '');
      if (title && /^https?:\/\//i.test(link)) results.push({ title, url: link, snippet });
    }
  }
  return { query, engine: 'bing-rss', privacyTier: 'regular', count: results.length, results };
}

function parseOnionHtmlResults(html, limit) {
  const results = [];
  const seen = new Set();
  // Match structured result blocks (Ahmia <li class="result"> or Torch <div class="result"> / <dt>/<dd>)
  const itemPatterns = [
    /<li[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
    /<div[^>]*class="[^"]*(?:result|search-result)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<tr[^>]*>([\s\S]*?)<\/tr>/gi,
  ];
  for (const re of itemPatterns) {
    for (const m of html.matchAll(re)) {
      if (results.length >= limit) break;
      const block = m[1];
      const linkM = /<a[^>]+href="([^"]*\.onion[^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
      if (!linkM) continue;
      let href = linkM[1];
      try {
        const parsed = new URL(href, 'http://onion.invalid');
        const redir = parsed.searchParams.get('redirect_url');
        if (redir && /\.onion/i.test(redir)) href = redir;
      } catch {}
      if (!/^https?:\/\/[^/]+\.onion/i.test(href) || seen.has(href)) continue;
      seen.add(href);
      const title = cleanHtml(linkM[2]) || href;
      const snipM = /<(?:p|dd|span)[^>]*>([\s\S]*?)<\/(?:p|dd|span)>/i.exec(block.replace(linkM[0], ''));
      results.push({ title, url: href, snippet: cleanHtml(snipM?.[1] || '').slice(0, 320), onion: true });
    }
    if (results.length >= limit) break;
  }
  // Broad fallback: extract any direct .onion anchors if engine template changed
  if (!results.length) {
    for (const m of html.matchAll(/<a[^>]+href="(https?:\/\/[a-z2-7]{16,56}\.onion[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      if (results.length >= limit) break;
      const href = m[1];
      if (seen.has(href)) continue;
      seen.add(href);
      results.push({ title: cleanHtml(m[2]) || href, url: href, snippet: '', onion: true });
    }
  }
  return results;
}

export async function searchAhmia(query, { maxResults = 8, useTor = false, request = fetch, userAgent, signal } = {}) {
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 15));
  const base = useTor ? DEFAULT_AHMIA_ONION_URL : 'https://ahmia.fi/search/';
  const url = `${base}?q=${encodeURIComponent(query)}`;
  const res = await request(url, { headers: makeHeaders(userAgent), signal: makeSignal(signal, 25000) });
  if (!res.ok) throw new Error(`Ahmia search failed (HTTP ${res.status}).`);
  const html = await res.text();
  const results = parseOnionHtmlResults(html, limit);
  return { query, engine: 'ahmia', privacyTier: 'onion', viaTor: useTor, count: results.length, results };
}

export async function searchTorch(query, { torchUrl = DEFAULT_TORCH_ONION_URL, maxResults = 8, request = fetch, userAgent, signal } = {}) {
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 15));
  const endpoint = String(torchUrl || DEFAULT_TORCH_ONION_URL).trim();
  const parsed = new URL(endpoint);
  if (!isOnionHost(parsed.hostname)) {
    throw new Error('Torch search endpoint must be a .onion hidden service URL (routed strictly via Tor SOCKS5h).');
  }
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${endpoint}${sep}P=${encodeURIComponent(query)}&q=${encodeURIComponent(query)}`;
  const res = await request(url, { headers: makeHeaders(userAgent), signal: makeSignal(signal, 30000) });
  if (!res.ok) throw new Error(`Torch .onion search failed (HTTP ${res.status}).`);
  const html = await res.text();
  const results = parseOnionHtmlResults(html, limit);
  return { query, engine: 'torch', privacyTier: 'onion', viaTor: true, endpoint: parsed.hostname, count: results.length, results };
}

// Unified multi-tier privacy-aware web search dispatcher
export async function executeWebSearch(query, {
  provider = '',
  maxResults = 8,
  settings = {},
  getSecret = () => null,
  torRunning = false,
  request = fetch,
  signal,
} = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Provide a non-empty search query.');
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 15));
  const chosen = String(provider || settings.searchProvider || 'auto').toLowerCase();
  const strictZeroTrack = Boolean(settings.searchStrictZeroTrack);
  const userAgent = settings.webUserAgent || DEFAULT_BROWSER_USER_AGENT;

  if (chosen === 'searxng') {
    return searchSearXNG(q, { baseUrl: settings.browserSearxUrl, maxResults: limit, request, userAgent, signal });
  }
  if (chosen === 'brave') {
    return searchBrave(q, { apiKey: getSecret('SEARCH_BRAVE_KEY'), maxResults: limit, request, signal });
  }
  if (chosen === 'kagi') {
    return searchKagi(q, { apiKey: getSecret('SEARCH_KAGI_KEY'), maxResults: limit, request, signal });
  }
  if (chosen === 'langsearch') {
    return searchLangSearch(q, { apiKey: getSecret('SEARCH_LANGSEARCH_KEY'), maxResults: limit, request, signal });
  }
  if (chosen === 'tavily') {
    return searchTavily(q, { apiKey: getSecret('SEARCH_TAVILY_KEY'), maxResults: limit, request, signal });
  }
  if (chosen === 'exa') {
    return searchExa(q, { apiKey: getSecret('SEARCH_EXA_KEY'), maxResults: limit, request, signal });
  }
  if (chosen === 'mojeek') {
    return searchMojeek(q, { apiKey: getSecret('SEARCH_MOJEEK_KEY'), maxResults: limit, request, userAgent, signal });
  }
  if (chosen === 'duckduckgo') {
    return searchDuckDuckGoOnly(q, { maxResults: limit, request, userAgent, signal });
  }
  const hasTorRoute = Boolean(torRunning || ['managed-tor', 'wireguard-tor', 'tor', 'socks5'].includes(settings.browserProxyMode));
  if (chosen === 'ahmia') {
    return searchAhmia(q, { maxResults: limit, useTor: hasTorRoute, request, userAgent, signal });
  }
  if (chosen === 'torch') {
    if (!hasTorRoute) {
      throw new Error('Torch (.onion) search strictly requires an active Tor SOCKS5 proxy. Enable Managed Tor or External Tor SOCKS5 in Private Browser -> Privacy & Search.');
    }
    return searchTorch(q, { torchUrl: settings.searchTorchOnionUrl || DEFAULT_TORCH_ONION_URL, maxResults: limit, request, userAgent, signal });
  }
  if (chosen === 'onion') {
    if (!hasTorRoute) {
      throw new Error('Combined Tor .onion search strictly requires an active Tor SOCKS5 proxy. Enable Managed Tor or External Tor SOCKS5 in Private Browser -> Privacy & Search.');
    }
    const settled = await Promise.allSettled([
      searchAhmia(q, { maxResults: limit, useTor: true, request, userAgent, signal }),
      searchTorch(q, { torchUrl: settings.searchTorchOnionUrl || DEFAULT_TORCH_ONION_URL, maxResults: limit, request, userAgent, signal }),
    ]);
    const combined = [];
    const seen = new Set();
    const errors = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        for (const r of s.value.results || []) {
          if (!seen.has(r.url) && combined.length < limit) { seen.add(r.url); combined.push({ ...r, sourceEngine: s.value.engine }); }
        }
      } else {
        errors.push(s.reason?.message || String(s.reason));
      }
    }
    if (!combined.length && errors.length) throw new Error('Tor Onion search failed: ' + errors.join(' | '));
    return { query: q, engine: 'onion (ahmia+torch)', privacyTier: 'onion', viaTor: true, count: combined.length, results: combined, ...(errors.length ? { partialErrors: errors } : {}) };
  }
  if (chosen === 'bing-rss') {
    if (strictZeroTrack) throw new Error('Strict Zero-Track Search mode blocks regular engine "bing-rss". Use SearXNG, DuckDuckGo, Mojeek, Brave, Kagi, or Tor Onion search.');
    return searchBingRss(q, { maxResults: limit, request, userAgent, signal });
  }

  // Auto privacy-first cascade
  if (settings.browserSearxUrl?.trim()) {
    try {
      const r = await searchSearXNG(q, { baseUrl: settings.browserSearxUrl, maxResults: limit, request, userAgent, signal });
      if (r.count > 0) return r;
    } catch {}
  }
  const keyPriority = [
    ['SEARCH_BRAVE_KEY', searchBrave],
    ['SEARCH_KAGI_KEY', searchKagi],
    ['SEARCH_LANGSEARCH_KEY', searchLangSearch],
    ['SEARCH_TAVILY_KEY', searchTavily],
    ['SEARCH_EXA_KEY', searchExa],
    ['SEARCH_MOJEEK_KEY', searchMojeek],
  ];
  for (const [keyName, fn] of keyPriority) {
    const k = getSecret(keyName);
    if (!k) continue;
    try {
      const r = await fn(q, { apiKey: k, maxResults: limit, request, userAgent, signal });
      if (r.count > 0) return r;
    } catch {}
  }

  try {
    const ddg = await searchDuckDuckGoOnly(q, { maxResults: limit, request, userAgent, signal });
    if (ddg.count > 0) return ddg;
  } catch {}

  if (strictZeroTrack) {
    try {
      const moj = await searchMojeek(q, { maxResults: limit, request, userAgent, signal });
      if (moj.count > 0) return moj;
    } catch {}
    return { query: q, engine: 'duckduckgo', privacyTier: 'zero-track', count: 0, results: [], note: 'Strict Zero-Track Search prevented fallback to regular engines. Configure SearXNG, Brave Search API, or Kagi for high-reliability zero-track search.' };
  }

  return searchBingRss(q, { maxResults: limit, request, userAgent, signal });
}
