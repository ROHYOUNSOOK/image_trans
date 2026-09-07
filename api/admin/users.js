import { requireAdmin } from '../../lib/auth.js';
import { publicUser, readStore, updateStore, nowKst } from '../../lib/store.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const data = await readStore();
    const users = Object.values(data.users)
      .map(publicUser)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return res.status(200).json({ users });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  const action = String(req.body?.action || '').trim();
  if (!email) return res.status(400).json({ error: '이메일이 필요합니다.' });
  if (email === admin.email && (action === 'reject' || action === 'role')) {
    return res.status(400).json({ error: '자기 자신의 권한은 이 화면에서 바꿀 수 없습니다.' });
  }

  let saved = null;
  try {
    await updateStore(data => {
      const user = data.users[email];
      if (!user) throw new Error('사용자를 찾을 수 없습니다.');
      if (action === 'approve') {
        user.status = 'approved';
        user.approvedAt = nowKst();
        user.approvedBy = admin.email;
      } else if (action === 'reject') {
        user.status = 'rejected';
        user.role = 'user';
      } else if (action === 'role') {
        const role = req.body?.role === 'admin' ? 'admin' : 'user';
        user.role = role;
        if (role === 'admin') {
          user.status = 'approved';
          user.approvedAt = user.approvedAt || nowKst();
          user.promotedAt = nowKst();
          user.promotedBy = admin.email;
        } else {
          user.promotedAt = null;
          user.promotedBy = null;
        }
      } else {
        throw new Error('알 수 없는 작업입니다.');
      }
      data.users[email] = user;
      saved = user;
      return data;
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.status(200).json({ user: publicUser(saved) });
}
