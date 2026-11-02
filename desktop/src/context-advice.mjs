const nonnegative=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export function contextAdvice(task,settings){
  const current=nonnegative(task.contextTokens)?task.contextTokens:null;
  const threshold=nonnegative(settings.contextWindow)&&nonnegative(settings.compressionPercent)?settings.contextWindow*settings.compressionPercent/100:null;
  const last=task.lastCompression;
  const saved=last&&nonnegative(last.before)&&nonnegative(last.after)&&last.before>0?{tokens:last.before-last.after,percent:100*(last.before-last.after)/last.before}:null;
  return {current,threshold,short:current!==null&&current>0&&current<12000&&(threshold===null||current<threshold),saved};
}
