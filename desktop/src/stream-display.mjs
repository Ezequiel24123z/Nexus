// Catch up quickly to arriving chunks; never replay a long already-received answer.
export function nextStreamText(current,target,reducedMotion=false){
  if(reducedMotion||!target.startsWith(current))return target;
  const remaining=target.length-current.length;
  if(remaining<=12||remaining>512)return target;
  let end=current.length+Math.max(1,Math.ceil(remaining*.4));
  const code=target.charCodeAt(end-1);
  if(code>=0xd800&&code<=0xdbff)end++;
  return target.slice(0,end);
}

// Smooth 60/120fps progressive character reveal with adaptive spring velocity.
// Never snaps small chunks instantaneously; gently accelerates on large code bursts
// so streaming feels continuous and fluid rather than jerky jumps.
export function advanceProgressiveStream(current, target, dtMs = 16.67, reducedMotion = false, carryRef = null) {
  if (reducedMotion || !target || !target.startsWith(current)) {
    if (carryRef) carryRef.current = 0;
    return target;
  }
  const remaining = target.length - current.length;
  if (remaining <= 0) {
    if (carryRef) carryRef.current = 0;
    return target;
  }
  const dt = Math.max(4, Math.min(Number(dtMs) || 16.67, 64));
  // Comfortable base reading glide (~75 chars/sec) + proportional catch-up spring
  const charsPerSec = Math.min(920, 75 + remaining * 4.2);
  const exactAdvance = (charsPerSec * dt) / 1000 + (carryRef ? carryRef.current : 0);
  const whole = Math.floor(exactAdvance);
  if (carryRef) carryRef.current = exactAdvance - whole;
  if (whole < 1) return current;

  let end = Math.min(target.length, current.length + whole);
  // Avoid splitting UTF-16 surrogate pairs (emoji, supplementary planes)
  const code = target.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff && end < target.length) end++;
  return target.slice(0, end);
}
