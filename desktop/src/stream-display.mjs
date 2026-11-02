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
