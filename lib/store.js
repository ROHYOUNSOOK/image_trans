import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

function storePath() {
  if (process.env.DATA_PATH) return process.env.DATA_PATH;
  const cloud = process.env.VERCEL && process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'development';
  if (cloud) return path.join('/tmp', 'image-editor-store.json');
  return path.join(process.cwd(), 'data', 'store.json');
}

let queue = Promise.resolve();

export function nowKst(d = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(d).replace('T', ' ');
}

async function readRaw() {
  try {
    const raw = await readFile(storePath(), 'utf8');
    const data = JSON.parse(raw);
    return {
      users: data.users && typeof data.users === 'object' ? data.users : {},
      images: Array.isArray(data.images) ? data.images : []
    };
  } catch {
    return { users: {}, images: [] };
  }
}

async function writeRaw(data) {
  const file = storePath();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

export function readStore() {
  return readRaw();
}

export function updateStore(fn) {
  const run = queue.then(async () => {
    const data = await readRaw();
    const next = (await fn(data)) || data;
    await writeRaw(next);
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

export function publicUser(u) {
  if (!u) return null;
  return {
    email: u.email,
    name: u.name || '',
    picture: u.picture || '',
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    approvedAt: u.approvedAt || null
  };
}

export function adminEmails() {
  return String(process.env.ADMIN_EMAIL || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  return adminEmails().includes(String(email || '').toLowerCase());
}

export async function logImageEdit(user, usage) {
  const id = String(usage?.id || '').trim();
  const fileName = String(usage?.fileName || '').trim() || '(이름 없음)';
  const width = Number(usage?.width) || 0;
  const height = Number(usage?.height) || 0;
  const bytes = Number(usage?.bytes) || 0;
  if (!id) return null;
  const at = nowKst();
  let row = null;
  await updateStore(data => {
    const found = data.images.find(x => x.id === id);
    if (found) {
      found.editCount = (found.editCount || 0) + 1;
      found.edits = Array.isArray(found.edits) ? found.edits.concat(at) : [at];
      found.updatedAt = at;
      found.userEmail = user.email;
      found.userName = user.name || found.userName || '';
      found.fileName = fileName || found.fileName;
      if (width) found.width = width;
      if (height) found.height = height;
      if (bytes) found.bytes = bytes;
      row = found;
    } else {
      row = {
        id,
        userEmail: user.email,
        userName: user.name || '',
        fileName,
        width,
        height,
        bytes,
        editCount: 1,
        edits: [at],
        createdAt: at,
        updatedAt: at
      };
      data.images.push(row);
    }
    return data;
  });
  return row;
}

