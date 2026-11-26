// Fast, zero-dependency syntax tokenizer for Markdown code blocks & Studio preview.
const KEYWORDS = new Set([
  'import', 'export', 'from', 'default', 'as', 'const', 'let', 'var', 'function', 'async', 'await',
  'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch',
  'finally', 'throw', 'new', 'class', 'extends', 'implements', 'interface', 'type', 'enum', 'public',
  'private', 'protected', 'static', 'readonly', 'void', 'null', 'undefined', 'true', 'false', 'this',
  'super', 'typeof', 'instanceof', 'in', 'of', 'yield', 'def', 'elif', 'lambda', 'with', 'pass',
  'None', 'True', 'False', 'fn', 'pub', 'struct', 'impl', 'trait', 'match', 'use', 'mod', 'mut', 'ref',
  'func', 'package', 'go', 'defer', 'chan', 'select', 'range', 'using', 'namespace', 'sealed', 'override',
  'virtual', 'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE',
  'TABLE', 'JOIN', 'LEFT', 'RIGHT', 'ON', 'GROUP', 'ORDER', 'BY', 'LIMIT', 'AND', 'OR', 'NOT', 'AS',
  'param', 'foreach', 'process', 'begin', 'end',
]);

const TOKEN_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][A-Za-z0-9_$]*\b)/g;

export function tokenizeCode(code = '', lang = '') {
  const lower = String(lang || '').toLowerCase();
  const text = String(code ?? '');
  if (lower === 'diff' || lower === 'patch') {
    return {
      isDiff: true,
      lines: text.split('\n').map((line, idx) => ({
        line: idx + 1,
        cls: line.startsWith('+') && !line.startsWith('+++')
          ? 'diff-add'
          : line.startsWith('-') && !line.startsWith('---')
            ? 'diff-del'
            : line.startsWith('@@')
              ? 'diff-hunk'
              : '',
        text: line,
      })),
    };
  }
  const supportsHashComment = ['py', 'python', 'sh', 'bash', 'zsh', 'ps1', 'powershell', 'yaml', 'yml', 'toml', 'dockerfile', 'ruby', 'rb'].includes(lower);
  const tokens = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > last) tokens.push({ type: 'plain', value: text.slice(last, match.index) });
    const val = match[0];
    let type = 'plain';
    if (val.startsWith('//') || val.startsWith('/*')) type = 'com';
    else if (val.startsWith('#')) type = supportsHashComment ? 'com' : 'plain';
    else if (val.startsWith('"') || val.startsWith("'") || val.startsWith('`')) type = 'str';
    else if (/^\d/.test(val)) type = 'num';
    else if (KEYWORDS.has(val) || (lower === 'sql' && KEYWORDS.has(val.toUpperCase()))) type = 'kw';
    else if (/^[A-Z][A-Za-z0-9_]+$/.test(val)) type = 'type';
    else if (text[match.index + val.length] === '(') type = 'fn';
    tokens.push({ type, value: val });
    last = match.index + val.length;
  }
  if (last < text.length) tokens.push({ type: 'plain', value: text.slice(last) });
  return { isDiff: false, tokens };
}
