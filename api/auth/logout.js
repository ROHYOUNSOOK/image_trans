import { clearCookie } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  res.setHeader('Set-Cookie', clearCookie());
  res.status(200).json({ ok: true });
}
