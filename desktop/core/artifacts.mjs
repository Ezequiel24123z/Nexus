import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const limit = 6000;
const stringify = value => JSON.stringify(value);

// Large external outputs are durable artifacts, not an ever-growing prompt or UI payload.
// The complete payload remains local and the model can request a bounded slice by artifact id.
export async function materializeToolResult(store, task, name, result) {
  const serialized = stringify(result);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes <= limit) return { journal:result, model:serialized, artifact:null };
  const id = crypto.randomUUID();
  const directory = path.join(store.directoryFor(task.id), 'artifacts');
  await fs.mkdir(directory, {recursive:true});
  const filename = path.join(directory, id + '.json');
  await fs.writeFile(filename, serialized, 'utf8');
  const artifact = {id, name, bytes, sha256:crypto.createHash('sha256').update(serialized).digest('hex'), format:'json'};
  const preview = serialized.slice(0, 900);
  const reference = {artifact, preview, truncated:true, hint:'Full output saved locally. Use read_artifact with this id, offset, and length to retrieve only the required slice.'};
  return {journal:reference, model:stringify(reference), artifact};
}

export async function readArtifact(store, task, id, offset = 0, length = 8000) {
  if(typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid artifact identifier.');
  if(!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1 || length > 24000) throw new Error('Invalid artifact range.');
  const filename = path.join(store.directoryFor(task.id), 'artifacts', id + '.json');
  const data = await fs.readFile(filename, 'utf8').catch(error => { if(error.code === 'ENOENT') throw new Error('Artifact not found in this task.'); throw error; });
  return {id, offset, length:Math.min(length,data.length-offset), totalBytes:Buffer.byteLength(data,'utf8'), content:data.slice(offset,offset+length), next:offset+length<data.length?offset+length:null};
}

const imageTypes = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif']
]);
const attachmentId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);

export async function materializeImageAttachment(store, task, dataUrl, {name = 'desktop-screenshot', dimensions} = {}) {
  if (typeof dataUrl !== 'string') throw new Error('The capture does not contain a valid image.');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  const mime = match?.[1]?.toLowerCase();
  const extension = imageTypes.get(mime);
  if (!extension) throw new Error('Unsupported image format for local attachment.');
  const data = Buffer.from(match[2], 'base64');
  if (!data.length) throw new Error('The image capture is empty.');
  const id = crypto.randomUUID();
  const directory = path.join(store.directoryFor(task.id), 'attachments');
  await fs.mkdir(directory, {recursive:true});
  await fs.writeFile(path.join(directory, id + '.' + extension), data);
  return {id, name, mime, bytes:data.length, extension, dimensions:dimensions || null, kind:'image',createdAt:new Date().toISOString()};
}

export function hydrateAttachmentReferences(store, task, message) {
  if (!Array.isArray(message?.content)) return message;
  let changed = false;
  const content = message.content.map(part => {
    if (part?.type !== 'nexus_attachment') return part;
    changed = true;
    const attachment = part.attachment;
    if (!attachment || attachment.kind !== 'image' || !attachmentId(attachment.id) || !imageTypes.has(attachment.mime)) {
      return {type:'text', text:'[Local attachment unavailable: invalid reference.]'};
    }
    const filename = attachment.storage==='uploads'
      ? path.join(store.directory,'uploads',attachment.id,'original')
      : path.join(store.directoryFor(task.id), 'attachments', attachment.id + '.' + imageTypes.get(attachment.mime));
    try {
      const encoded = fsSync.readFileSync(filename).toString('base64');
      return {type:'image_url', image_url:{url:'data:' + attachment.mime + ';base64,' + encoded}};
    } catch (error) {
      if (error.code === 'ENOENT') return {type:'text', text:'[Local attachment unavailable: file no longer exists.]'};
      throw error;
    }
  });
  return changed ? {...message, content} : message;
}
