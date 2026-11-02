export function externalWebUrl(value) {
  if (typeof value !== 'string') throw new Error('Invalid link.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid link.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('The link must be HTTP or HTTPS without embedded credentials.');
  return url.href;
}
