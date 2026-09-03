import { createHmac, timingSafeEqual } from 'crypto';
import { adminEmails, isAdminEmail, nowKst, publicUser, readStore, updateStore } from './store.js';

const DAY = 7 * 24 * 60 * 60 * 1000;

function secret() {
  const s = (process.env.SESSION_SECRET || '').trim();
  if (s) return s;
  if (process.env.VERCEL) throw new Error('SESSION_SECRET 환경변수가 필요합니다.');
  return 'dev-only-change-me';
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

export function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readSessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(expect);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.email || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(token, maxAgeSec = DAY / 1000) {
  const parts = [
    `session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${Math.floor(maxAgeSec)}`,
    'SameSite=Lax'
  ];
  if (process.env.VERCEL) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie() {
  const parts = ['session=', 'HttpOnly', 'Path=/', 'Max-Age=0', 'SameSite=Lax'];
  if (process.env.VERCEL) parts.push('Secure');
  return parts.join('; ');
}

export async function verifyGoogleIdToken(credential) {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID 환경변수가 없습니다.');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  const p = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(p.error_description || '구글 로그인 검증에 실패했습니다.');
  if (p.aud !== clientId) throw new Error('구글 클라이언트 ID가 맞지 않습니다.');
  if (String(p.email_verified) !== 'true') throw new Error('인증되지 않은 구글 계정입니다.');
  if (!p.email) throw new Error('구글 이메일을 가져오지 못했습니다.');
  return {
    email: String(p.email).toLowerCase(),
    name: p.name || '',
    picture: p.picture || ''
  };
}

export async function upsertLoginUser(profile) {
  const email = profile.email.toLowerCase();
  const bootstrap = isAdminEmail(email);
  let saved = null;
  await updateStore(data => {
    const prev = data.users[email];
    const user = prev ? {
      ...prev,
      name: profile.name || prev.name,
      picture: profile.picture || prev.picture,
      lastLoginAt: nowKst()
    } : {
      email,
      name: profile.name || '',
      picture: profile.picture || '',
      role: bootstrap ? 'admin' : 'user',
      status: bootstrap ? 'approved' : 'pending',
      createdAt: nowKst(),
      approvedAt: bootstrap ? nowKst() : null,
      lastLoginAt: nowKst()
    };
    if (bootstrap) {
      user.role = 'admin';
      user.status = 'approved';
      user.approvedAt = user.approvedAt || nowKst();
    }
    data.users[email] = user;
    saved = user;
    return data;
  });
  return saved;
}

export async function getAuth(req) {
  const token = parseCookies(req.headers.cookie).session;
  if (!token) return { user: null, error: '로그인이 필요합니다.', status: 401 };
  const sess = readSessionToken(token);
  if (!sess) return { user: null, error: '세션이 만료되었습니다. 다시 로그인해주세요.', status: 401 };
  const data = await readStore();
  const user = data.users[sess.email] || null;
  if (!user) return { user: null, error: '계정을 찾을 수 없습니다.', status: 401 };
  return { user, error: null, status: 200 };
}

export async function requireApproved(req, res) {
  const auth = await getAuth(req);
  if (!auth.user) {
    res.status(auth.status).json({ error: auth.error });
    return null;
  }
  if (auth.user.status !== 'approved') {
    res.status(403).json({ error: '관리자 승인 후 이용할 수 있습니다.' });
    return null;
  }
  return auth.user;
}

export async function requireAdmin(req, res) {
  const user = await requireApproved(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
    return null;
  }
  return user;
}

export function clientConfig() {
  return {
    googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    adminConfigured: adminEmails().length > 0
  };
}

export { publicUser };
