export function externalWebUrl(value) {
  if (typeof value !== 'string') throw new Error('Enlace no válido.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Enlace no válido.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('El enlace debe ser HTTP o HTTPS sin credenciales.');
  return url.href;
}
