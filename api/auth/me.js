import { getAuth, publicUser, sessionCookie, sessionFromUser } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const auth = await getAuth(req);
  if (!auth.user) return res.status(auth.status).json({ error: auth.error });
  res.setHeader('Set-Cookie', sessionCookie(sessionFromUser(auth.user)));
  res.status(200).json({ user: publicUser(auth.user) });
}
