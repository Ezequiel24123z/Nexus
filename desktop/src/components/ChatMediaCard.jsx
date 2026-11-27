import React, { useMemo, useState } from 'react';
import {
  FileText, Film, Image as ImageIcon, Music, FileSpreadsheet, ExternalLink,
  Maximize2, X, ChevronDown, ChevronRight, Copy, Check
} from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';

const api = (method, args) => window.nexus.invoke(method, args);

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function parseCsvRows(text, maxRows = 40) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim()).slice(0, maxRows + 1);
  return lines.map(line => {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  });
}

function MediaItem({ item }) {
  const [lightbox, setLightbox] = useState(false);
  const [expanded, setExpanded] = useState(item.kind === 'pdf' ? false : true);
  const [copied, setCopied] = useState(false);

  const srcUrl = useMemo(() => {
    if (item.url) return item.url;
    if (item.mediaId && window.nexus?.mediaUrl) return window.nexus.mediaUrl(item.mediaId);
    return '';
  }, [item.url, item.mediaId]);

  const isCsv = item.ext === '.csv' || item.mime === 'text/csv';
  const isMd = item.ext === '.md' || item.ext === '.markdown' || item.mime === 'text/markdown';
  const csvRows = useMemo(() => (isCsv && item.textPreview ? parseCsvRows(item.textPreview) : null), [isCsv, item.textPreview]);

  const Icon = item.kind === 'image' ? ImageIcon
    : item.kind === 'video' ? Film
    : item.kind === 'audio' ? Music
    : isCsv ? FileSpreadsheet
    : FileText;

  const openFile = () => {
    if (item.path) void api('openLocalFile', { path: item.path }).catch(() => {});
  };

  const copyPreview = () => {
    if (!item.textPreview) return;
    navigator.clipboard?.writeText(item.textPreview).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };

  return (
    <div className={`media-card media-kind-${item.kind || 'document'}`}>
      <div className="media-card-head">
        <div className="row" style={{ gap: 8, minWidth: 0, flex: 1 }}>
          <Icon size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <strong className="media-card-title" title={item.path || item.name}>{item.title || item.name}</strong>
          {item.bytes > 0 && <span className="hint tabular" style={{ fontSize: 11, flexShrink: 0 }}>{formatBytes(item.bytes)}</span>}
          <span className="tag-chip" style={{ flexShrink: 0 }}>{(item.ext || item.kind || '').replace(/^\./, '').toUpperCase()}</span>
        </div>

        <div className="row" style={{ gap: 4, flexShrink: 0 }}>
          {item.kind === 'image' && srcUrl && (
            <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} title="View fullscreen" onClick={() => setLightbox(true)}>
              <Maximize2 size={12} />
            </button>
          )}
          {item.textPreview && (
            <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} title="Copy document text" onClick={copyPreview}>
              {copied ? <Check size={12} style={{ color: 'var(--ok-fg)' }} /> : <Copy size={12} />}
            </button>
          )}
          {(item.kind === 'pdf' || item.kind === 'document') && (
            <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} title={expanded ? 'Collapse preview' : 'Expand preview'} onClick={() => setExpanded(v => !v)}>
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          )}
          {item.path && (
            <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '3px 7px' }} title="Open in default Windows app" onClick={openFile}>
              <ExternalLink size={11} /> Open
            </button>
          )}
        </div>
      </div>

      {/* Inline Image */}
      {item.kind === 'image' && srcUrl && (
        <div className="media-visual-wrap">
          <img
            src={srcUrl}
            alt={item.title || item.name || 'Image'}
            className="media-img"
            loading="lazy"
            onClick={() => setLightbox(true)}
          />
        </div>
      )}

      {/* Inline Streaming HTML5 Video (Range-enabled /api/media/:id) */}
      {item.kind === 'video' && srcUrl && (
        <div className="media-visual-wrap">
          <video
            src={srcUrl}
            controls
            playsInline
            preload="metadata"
            className="media-video"
          />
        </div>
      )}

      {/* Inline Audio Player */}
      {item.kind === 'audio' && srcUrl && (
        <div style={{ padding: '10px 12px' }}>
          <audio src={srcUrl} controls preload="metadata" style={{ width: '100%' }} />
        </div>
      )}

      {/* Embedded Native Edge PDF Viewer */}
      {item.kind === 'pdf' && srcUrl && expanded && (
        <div className="media-pdf-wrap">
          <iframe
            src={srcUrl}
            title={item.title || item.name || 'PDF Document'}
            className="media-pdf-frame"
          />
        </div>
      )}
      {item.kind === 'pdf' && !expanded && (
        <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span className="hint" style={{ fontSize: 12 }}>PDF document ready to view inline.</span>
          <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 9px' }} onClick={() => setExpanded(true)}>
            Preview PDF Inline
          </button>
        </div>
      )}

      {/* Rich Inline Document Preview (Markdown / CSV Table / Code & Text) */}
      {item.kind === 'document' && expanded && item.textPreview && (
        <div className="media-doc-body">
          {isMd ? (
            <MarkdownRenderer text={item.textPreview} />
          ) : csvRows && csvRows.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="media-csv-table">
                <thead>
                  <tr>{csvRows[0].map((h, i) => <th key={i}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {csvRows.slice(1).map((row, rIdx) => (
                    <tr key={rIdx}>{row.map((cell, cIdx) => <td key={cIdx}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="pre-box" style={{ margin: 0, maxHeight: 340, fontSize: 12 }}>{item.textPreview}</pre>
          )}
          {item.truncated && <p className="hint" style={{ margin: '8px 0 0', fontSize: 11 }}>Preview truncated — click Open to view full file.</p>}
        </div>
      )}

      {item.caption && <div className="media-card-caption">{item.caption}</div>}

      {/* Fullscreen Image Lightbox */}
      {lightbox && srcUrl && (
        <div className="media-lightbox" role="dialog" aria-label={item.title || 'Image preview'} onClick={() => setLightbox(false)}>
          <button type="button" className="media-lightbox-close" aria-label="Close preview" onClick={() => setLightbox(false)}>
            <X size={18} />
          </button>
          <img src={srcUrl} alt={item.title || item.name} onClick={e => e.stopPropagation()} />
          {(item.title || item.caption) && (
            <div className="media-lightbox-bar" onClick={e => e.stopPropagation()}>
              <strong>{item.title || item.name}</strong>
              {item.caption && <span>{item.caption}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatMediaCard({ items = [] }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div className="media-card-grid">
      {items.map((item, idx) => <MediaItem key={item.id || item.path || idx} item={item} />)}
    </div>
  );
}
