import { publicUser, signSession, sessionCookie, upsertLoginUser, verifyGoogleIdToken } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const credential = req.body?.credential;
    if (!credential) return res.status(400).json({ error: '구글 로그인 정보가 없습니다.' });
    const profile = await verifyGoogleIdToken(credential);
    const user = await upsertLoginUser(profile);
    const token = signSession({ email: user.email, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    res.setHeader('Set-Cookie', sessionCookie(token));
    res.status(200).json({ user: publicUser(user) });
  } catch (e) {
    res.status(400).json({ error: e.message || '구글 로그인에 실패했습니다.' });
  }
}
