import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function useDialogFocus(ref, close, returnRef) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const prior = returnRef?.current || document.activeElement;
    const node = ref.current;
    if (!node) return;
    (node.querySelector('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') || node.querySelector('button:not(:disabled)'))?.focus();
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current?.(); }
      if (e.key === 'Tab') {
        const focusables = [...node.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(el => el.getClientRects().length);
        const first = focusables[0], last = focusables.at(-1);
        if (!first) return;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      if (prior?.isConnected) prior.focus();
    };
  }, []);
}

export default function Modal({ label, close, wide = false, className = '', children, opener }) {
  const ref = useRef(null);
  useDialogFocus(ref, close, opener);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close?.(); }}>
      <section ref={ref} role="dialog" aria-modal="true" aria-label={label} className={`modal-box ${wide ? 'wide' : ''} ${className}`}>
        {close && <button type="button" className="btn-icon modal-close" aria-label="Close" onClick={close}><X size={18} /></button>}
        {children}
      </section>
    </div>
  );
}
