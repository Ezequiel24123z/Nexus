import React, { useState, useRef } from 'react';
import { FileText, Image, Paperclip, X } from 'lucide-react';
import Modal from './components/Modal.jsx';

export const fileSize = bytes => bytes < 1024 ? bytes + ' B' : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';
const usage = item => item.kind === 'image' ? 'Vision' : item.kind === 'text' ? 'Chunked read' : 'Local file';

export default function Attachments({ items = [], remove, disabled = false }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  const close = () => { request.current++; setPreview(null); };
  const inspect = async item => {
    const token = ++request.current;
    setPreview({ attachment: item });
    setError('');
    setLoading(true);
    try {
      const result = await window.nexus.invoke('previewAttachment', { id: item.id });
      if (request.current === token) setPreview(result);
    } catch {
      if (request.current === token) setError('Could not read this attachment.');
    } finally {
      if (request.current === token) setLoading(false);
    }
  };

  if (!items.length) return null;
  return (
    <>
      <div className="attachment-strip" aria-label="Attached files">
        {items.map(item => (
          <div className="attachment-chip" key={item.id}>
            <button type="button" onClick={() => inspect(item)} title={'Preview ' + item.name} style={{ padding: '2px 4px' }}>
              {item.kind === 'image' ? <Image size={14} style={{ color: 'var(--accent)' }} /> : item.kind === 'text' ? <FileText size={14} /> : <Paperclip size={14} />}
              <span style={{ textAlign: 'left' }}>
                <strong>{item.name}</strong>
                <small className="hint" style={{ fontSize: 10 }}>{fileSize(item.bytes)} · {usage(item)}</small>
              </span>
            </button>
            {remove && <button type="button" disabled={disabled} aria-label={'Remove attachment ' + item.name} onClick={() => remove(item.id)}><X size={13} /></button>}
          </div>
        ))}
      </div>
      {preview && (
        <Modal label="Attachment Preview" close={close} wide>
          <h2>{preview.attachment.name}</h2>
          <p className="hint">{fileSize(preview.attachment.bytes)} · {usage(preview.attachment)}</p>
          {loading ? <p className="hint">Preparing preview…</p> : error ? <p className="pill err">{error}</p> :
            preview.image ? <img src={preview.image} alt={preview.attachment.name} style={{ maxWidth: '100%', maxHeight: '60vh', display: 'block', margin: '12px auto', borderRadius: 10 }} /> :
            preview.content !== undefined ? <pre className="pre-box" style={{ maxHeight: '55vh' }}>{preview.content || '(Empty file)'}</pre> :
            <p className="hint">{preview.note}</p>}
        </Modal>
      )}
    </>
  );
}
