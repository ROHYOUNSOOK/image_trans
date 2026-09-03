import { getAuth, publicUser } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const auth = await getAuth(req);
  if (!auth.user) return res.status(auth.status).json({ error: auth.error });
  res.status(200).json({ user: publicUser(auth.user) });
}
