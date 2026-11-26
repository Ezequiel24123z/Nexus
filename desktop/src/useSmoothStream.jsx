import { useEffect, useRef, useState } from 'react';
import { advanceProgressiveStream } from './stream-display.mjs';

export default function useSmoothStream(text, { startFromEmpty = true } = {}) {
  const safeText = String(text ?? '');
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced'
  );
  const initial = reduced || !startFromEmpty || safeText.length > 260 ? safeText : '';
  const [shown, setShown] = useState(initial);
  const shownRef = useRef(initial);
  const targetRef = useRef(safeText);
  const carryRef = useRef(0);
  targetRef.current = safeText;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(query.matches || document.documentElement.dataset.motion === 'reduced');
    query.addEventListener('change', changed);
    window.addEventListener('nexus-appearance', changed);
    return () => {
      query.removeEventListener('change', changed);
      window.removeEventListener('nexus-appearance', changed);
    };
  }, []);

  useEffect(() => {
    if (reduced) {
      shownRef.current = safeText;
      carryRef.current = 0;
      setShown(safeText);
      return;
    }
    if (!safeText.startsWith(shownRef.current)) {
      const reset = startFromEmpty && safeText.length <= 260 ? '' : safeText;
      shownRef.current = reset;
      carryRef.current = 0;
      setShown(reset);
    }
    if (shownRef.current === safeText) return;

    let frame = 0;
    let lastTime = performance.now();
    const tick = now => {
      const dt = now - lastTime;
      lastTime = now;
      const target = targetRef.current;
      const next = advanceProgressiveStream(shownRef.current, target, dt, false, carryRef);
      if (next !== shownRef.current) {
        shownRef.current = next;
        setShown(next);
      }
      if (shownRef.current !== target) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [safeText, reduced, startFromEmpty]);

  if (reduced || !safeText.startsWith(shown)) return safeText;
  return shown;
}
