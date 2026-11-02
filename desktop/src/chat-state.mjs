// Keep page order, but let refreshed snapshots replace stale messages with the same id.
export function mergeById(first = [], second = []) {
  return [...new Map([...first, ...second].map(item => [item.id, item])).values()];
}
