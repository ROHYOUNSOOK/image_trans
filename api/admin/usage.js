import { requireAdmin } from '../../lib/auth.js';
import { readStore } from '../../lib/store.js';

function inRange(ts, from, to) {
  if (!ts) return false;
  const day = ts.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const url = new URL(req.url, 'http://localhost');
  const q = String(url.searchParams.get('user') || '').trim().toLowerCase();
  const from = String(url.searchParams.get('from') || '').trim();
  const to = String(url.searchParams.get('to') || '').trim();

  const data = await readStore();
  const images = data.images.filter(row => {
    if (q) {
      const blob = `${row.userEmail || ''} ${row.userName || ''}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    if (from || to) {
      const hits = [row.createdAt, row.updatedAt, ...(row.edits || [])].some(ts => inRange(ts, from, to));
      if (!hits) return false;
    }
    return true;
  }).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  res.status(200).json({ images });
}
