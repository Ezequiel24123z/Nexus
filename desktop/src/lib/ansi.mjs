// Minimal, fast ANSI SGR color parser for live streaming PowerShell / terminal output.
const COLOR_MAP = {
  30: '#697486', 31: '#f87171', 32: '#4ade80', 33: '#facc15',
  34: '#60a5fa', 35: '#c084fc', 36: '#22d3ee', 37: '#e5e7eb',
  90: '#8b95a5', 91: '#fca5a5', 92: '#86efac', 93: '#fde047',
  94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#ffffff',
};

const ANSI_RE = /\x1b\[([0-9;]*)m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][AB012]|\x1b[=>]/g;

function normalizeCarriageReturns(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => {
      if (!line.includes('\r')) return line;
      const parts = line.split('\r');
      let out = '';
      for (const p of parts) {
        if (!p) continue;
        out = p.length >= out.length ? p : p + out.slice(p.length);
      }
      return out;
    })
    .join('\n');
}

export function parseAnsiSegments(input = '') {
  const text = normalizeCarriageReturns(input);
  const segments = [];
  let last = 0;
  let color = null;
  let bold = false;
  let dim = false;
  ANSI_RE.lastIndex = 0;
  let match;
  while ((match = ANSI_RE.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ text: text.slice(last, match.index), color, bold, dim });
    }
    if (match[1] !== undefined) {
      const codes = (match[1] || '0').split(';').map(Number);
      for (const c of codes) {
        if (c === 0) { color = null; bold = false; dim = false; }
        else if (c === 1) bold = true;
        else if (c === 2) dim = true;
        else if (c === 22) { bold = false; dim = false; }
        else if (c === 39) color = null;
        else if (COLOR_MAP[c]) color = COLOR_MAP[c];
      }
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), color, bold, dim });
  return segments;
}
