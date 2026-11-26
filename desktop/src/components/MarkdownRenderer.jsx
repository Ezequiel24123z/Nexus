import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Check, Copy, WrapText, Code2, Eye } from 'lucide-react';
import { tokenizeCode } from '../lib/highlight.mjs';
import useSmoothStream from '../useSmoothStream.jsx';

let mermaidPromise = null;
let mermaidSeq = 0;

function loadMermaid(isDark) {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(mod => mod.default || mod);
  }
  return mermaidPromise.then(m => {
    m.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: isDark ? 'dark' : 'default',
      fontFamily: 'var(--font-sans)',
    });
    return m;
  });
}

function MermaidBlock({ code }) {
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState('');
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let live = true;
    const isDark = document.documentElement.dataset.theme !== 'light';
    const render = async () => {
      try {
        const mermaid = await loadMermaid(isDark);
        const id = 'nx-mmd-' + (++mermaidSeq);
        const res = await mermaid.render(id, String(code || '').trim());
        if (live) { setSvg(res.svg); setErr(''); }
      } catch (e) {
        if (live) { setErr(String(e?.message || 'Could not render diagram')); setSvg(''); }
      }
    };
    const timer = setTimeout(() => void render(), 120);
    return () => { live = false; clearTimeout(timer); };
  }, [code]);

  return (
    <div className="code-card">
      <div className="code-card-head">
        <span className="code-lang">mermaid · diagram</span>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" style={{ padding: '3px 7px', fontSize: 11 }} onClick={() => setShowSource(s => !s)}>
            {showSource ? <><Eye size={12} /> Diagram</> : <><Code2 size={12} /> Source</>}
          </button>
          <CopyButton text={code} label="Copy" compact />
        </div>
      </div>
      {showSource || !svg ? (
        <div style={{ padding: 12 }}>
          {err && !showSource && <p className="hint" style={{ color: 'var(--warn-fg)', marginBottom: 8 }}>Diagram preview pending/invalid syntax — showing source.</p>}
          <pre><code>{code}</code></pre>
        </div>
      ) : (
        <div className="mermaid-wrap" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  );
}

function renderKatexHtml(expr, displayMode) {
  try {
    return katex.renderToString(expr.trim(), { displayMode, throwOnError: false, strict: false });
  } catch {
    return null;
  }
}

function MathSpan({ expr, display = false }) {
  const html = useMemo(() => renderKatexHtml(expr, display), [expr, display]);
  if (!html) return <code>{expr}</code>;
  return display
    ? <div className="math-block" dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderTextWithMath(text) {
  if (typeof text !== 'string' || !text.includes('$')) return text;
  const parts = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^\s$][^$\n]*?[^\s$]|[^\s$\d])\$/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (!m[1] && /^\d[\d,.\s]*$/.test(m[2])) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<MathSpan key={m.index} expr={m[1]} display />);
    else parts.push(<MathSpan key={m.index} expr={m[2]} display={false} />);
    last = m.index + m[0].length;
  }
  if (!parts.length) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function transformChildrenMath(children) {
  return React.Children.map(children, child => (typeof child === 'string' ? renderTextWithMath(child) : child));
}

function ExternalLink({ href, children }) {
  return (
    <a href={href} onClick={e => { e.preventDefault(); void window.nexus.invoke('openExternal', { url: href }).catch(() => {}); }}>
      {children}
    </a>
  );
}

export function CopyButton({ text, label = 'Copy', compact = false }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(text ?? ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  return (
    <button type="button" aria-label={label} title={label} onClick={copy} style={{ padding: compact ? '3px 7px' : undefined, fontSize: 11 }}>
      {copied ? <Check size={13} style={{ color: 'var(--ok-fg)' }} /> : <Copy size={13} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}

function CodeBlock({ children }) {
  const [wrap, setWrap] = useState(false);
  const codeEl = children?.props ? children : null;
  const rawLang = (codeEl?.props?.className || '').replace(/^language-/, '') || 'text';
  const rawCode = String(codeEl?.props?.children ?? '').replace(/\n$/, '');
  const lineCount = rawCode ? rawCode.split('\n').length : 0;

  if (rawLang.toLowerCase() === 'mermaid') {
    return <MermaidBlock code={rawCode} />;
  }
  if (rawLang.toLowerCase() === 'math' || rawLang.toLowerCase() === 'latex') {
    return <MathSpan expr={rawCode} display />;
  }

  const highlighted = useMemo(() => tokenizeCode(rawCode, rawLang), [rawCode, rawLang]);

  return (
    <div className="code-card">
      <div className="code-card-head">
        <span className="code-lang">{rawLang} · <span className="tabular" style={{ fontWeight: 400 }}>{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span></span>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" title="Toggle word wrap" aria-pressed={wrap} onClick={() => setWrap(w => !w)} style={{ padding: '3px 6px', fontSize: 11 }}>
            <WrapText size={13} />
          </button>
          <CopyButton text={rawCode} label="Copy code" compact />
        </div>
      </div>
      <pre className={wrap ? 'wrap' : ''}>
        <code>
          {highlighted.isDiff
            ? highlighted.lines.map(item => <span key={item.line} className={item.cls}>{item.text + '\n'}</span>)
            : highlighted.tokens.map((tok, i) => tok.type === 'plain' ? tok.value : <span key={i} className={`tok-${tok.type}`}>{tok.value}</span>)}
        </code>
      </pre>
    </div>
  );
}

const plugins = [remarkGfm];
const components = {
  a: ({ href, children }) => <ExternalLink href={href}>{children}</ExternalLink>,
  p: ({ children }) => <p>{transformChildrenMath(children)}</p>,
  li: ({ children }) => <li>{transformChildrenMath(children)}</li>,
  table: ({ children }) => <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table>{children}</table></div>,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

const MarkdownBlock = React.memo(function MarkdownBlock({ text }) {
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
    return <MathSpan expr={trimmed.slice(2, -2)} display />;
  }
  return <ReactMarkdown remarkPlugins={plugins} components={components}>{String(text ?? '')}</ReactMarkdown>;
});

export function splitMarkdownBlocks(markdown = '') {
  const lines = String(markdown ?? '').split('\n');
  const blocks = [];
  let buf = [];
  let inFence = false;
  let fenceChar = '';
  let inMath = false;

  const flush = () => {
    if (!buf.length) return;
    const joined = buf.join('\n');
    if (joined.trim()) blocks.push(joined);
    buf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch) {
      if (!inFence) { inFence = true; fenceChar = fenceMatch[1][0]; }
      else if (trimmed.startsWith(fenceChar.repeat(3))) { inFence = false; fenceChar = ''; }
      buf.push(line);
      continue;
    }
    if (!inFence && trimmed === '$$') {
      inMath = !inMath;
      buf.push(line);
      if (!inMath) flush();
      continue;
    }
    if (!inFence && !inMath && trimmed === '') {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({ text }) {
  const blocks = useMemo(() => splitMarkdownBlocks(text), [text]);
  return (
    <div className="md-body">
      {blocks.map((block, idx) => <MarkdownBlock key={idx} text={block} />)}
    </div>
  );
});

export function StreamingMarkdown({ text }) {
  const shown = useSmoothStream(text, { startFromEmpty: true });
  const blocks = useMemo(() => splitMarkdownBlocks(shown), [shown]);
  if (!blocks.length) return null;
  const settled = blocks.slice(0, -1);
  const tail = blocks[blocks.length - 1];
  return (
    <div className="md-body streaming-body">
      {settled.map((block, idx) => <MarkdownBlock key={idx} text={block} />)}
      <div className="stream-tail"><MarkdownBlock text={tail} /></div>
    </div>
  );
}
