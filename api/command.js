// api/command.js — OpenAI gpt-image-2 (images.edit)로 배너 글자를 번역 교체한다.
// 모델 제약상 최대 3:1까지만 생성 가능 → 3:1로 만들고, 나머지는 클라이언트가 원본 폭으로 합성.

// gpt-image-2 size 제약: 장변<3840, 두 변 모두 16의 배수, 장변:단변 ≤ 3:1,
//                        655,360 ≤ 총픽셀 ≤ 8,294,400
import { requireApproved } from '../lib/auth.js';
import { logImageEdit } from '../lib/store.js';

function pickSize(w, h) {
  const MAXR = 3, LONG = 2560; // 2K 신뢰 상한 근처
  let ar = Math.min(MAXR, Math.max(1 / MAXR, w / h));
  const floor16 = n => Math.max(16, Math.floor(n / 16) * 16);
  const ceil16  = n => Math.max(16, Math.ceil(n / 16) * 16);
  let W, H;
  if (ar >= 1) {                 // 가로형
    W = floor16(LONG);
    H = ceil16(W / ar);          // 단변은 올림 → 비율이 3:1을 넘지 않게
    if (W / H > MAXR) H = ceil16(W / MAXR);
  } else {                       // 세로형
    H = floor16(LONG);
    W = ceil16(H * ar);
    if (H / W > MAXR) W = ceil16(H / MAXR);
  }
  return `${W}x${H}`;
}

function layerOut(l) {
  const t = l && l.newText != null ? String(l.newText).trim() : '';
  return t || null;
}

function pct(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(1) : '?';
}

function boxMoved(l) {
  const keys = ['x0', 'y0', 'x1', 'y1'];
  const orig = ['ox0', 'oy0', 'ox1', 'oy1'];
  if (orig.some(k => !Number.isFinite(Number(l[k])))) return false;
  return keys.some((k, i) => Math.abs(Number(l[k]) - Number(l[orig[i]])) > 1.2);
}

function num(l, k) {
  return Number(l[k]);
}

function sameLinePct(a, b) {
  if (!Number.isFinite(num(a, 'y0')) || !Number.isFinite(num(b, 'y0'))) return false;
  const ay = (num(a, 'y0') + num(a, 'y1')) / 2;
  const by = (num(b, 'y0') + num(b, 'y1')) / 2;
  const ah = Math.max(1, num(a, 'y1') - num(a, 'y0'));
  const bh = Math.max(1, num(b, 'y1') - num(b, 'y0'));
  return Math.abs(ay - by) <= Math.max(ah, bh) * 0.7;
}

function boxesOverlapPct(a, b) {
  if (!sameLinePct(a, b)) return false;
  const x = Math.max(0, Math.min(num(a, 'x1'), num(b, 'x1')) - Math.max(num(a, 'x0'), num(b, 'x0')));
  const y = Math.max(0, Math.min(num(a, 'y1'), num(b, 'y1')) - Math.max(num(a, 'y0'), num(b, 'y0')));
  const minA = Math.max(1, (num(a, 'x1') - num(a, 'x0')) * (num(a, 'y1') - num(a, 'y0')));
  const minB = Math.max(1, (num(b, 'x1') - num(b, 'x0')) * (num(b, 'y1') - num(b, 'y0')));
  return x * y > Math.min(minA, minB) * 0.08;
}

function joinGroups(list) {
  const byId = new Map();
  list.forEach((l, i) => {
    const id = l && l.joinId != null && l.joinId !== '' ? String(l.joinId) : '';
    if (!id) return;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(i);
  });
  const fromFlag = [...byId.values()].filter(g => g.length >= 2);
  if (fromFlag.length) return fromFlag;

  const n = list.length, p = list.map((_, i) => i);
  const find = i => (p[i] === i ? i : (p[i] = find(p[i])));
  const uni = (i, j) => { i = find(i); j = find(j); if (i !== j) p[j] = i; };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (boxesOverlapPct(list[i], list[j])) uni(i, j);
    }
  }
  const map = new Map();
  list.forEach((_, i) => {
    const r = find(i);
    if (!map.has(r)) map.set(r, []);
    map.get(r).push(i);
  });
  return [...map.values()].filter(g => g.length >= 2);
}

function looksLatin(s) {
  const t = String(s || '');
  const letters = t.replace(/[^A-Za-z\u00C0-\u024F]/g, '');
  const cjk = t.replace(/[^\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g, '');
  return letters.length >= cjk.length;
}

function joinPhrase(list, idxs) {
  const words = idxs.map(i => layerOut(list[i]) || String(list[i].text || '').trim()).filter(Boolean);
  if (!words.length) return '';
  return words.every(looksLatin) ? words.join(' ') : words.join('');
}

function joinNotes(list) {
  const notes = joinGroups(list).map((row, n) => {
    const phrase = joinPhrase(list, row);
    const parts = row.map(i => `${i + 1}번(${layerOut(list[i]) || list[i].text})`).join(' + ');
    const gap = row.map(i => layerOut(list[i]) || list[i].text).every(looksLatin)
      ? '라틴 문자는 단어 사이 공백 하나'
      : '한글·중문·일어는 붙여 쓰거나 아주 좁은 간격';
    return `붙임 그룹 ${n + 1}: ${parts} → 한 줄로 가로로 이어 붙여라. 읽는 문구 "${phrase}". ${gap}. 목록 위가 왼쪽, 아래가 오른쪽. 각 단어는 자기 레이어 스타일만 쓴다(색·그라데이션·두께·외곽선을 섞거나 옆 단어에 입히지 마라). 위·아래로 겹쳐 쌓지 마라.`;
  });
  return notes.length ? '겹친 단어 붙이기(반드시):\n' + notes.join('\n') : '';
}

/** 현재 박스 좌표(이미지 대비 %)에 그 레이어 스타일로 배치. 같은 줄은 목록 위가 왼쪽. */
function buildResultLayout(list) {
  const joined = joinNotes(list);
  const lineNote = sameLineReading(list);
  const joinIdx = new Set(joinGroups(list).flat());
  const items = list.map((l, i) => {
    const word = layerOut(l) ? `"${layerOut(l)}"` : `(원문 "${l.text}"를 지정 언어로 번역)`;
    let s = `${i + 1}번 레이어 ${word}\n  그릴 위치: 가로 ${pct(l.x0)}%~${pct(l.x1)}%, 세로 ${pct(l.y0)}%~${pct(l.y1)}% (이미지 왼쪽·위가 0%, 오른쪽·아래가 100%). 박스 안에 맞춰 그린다.\n  스타일: 원문 "${l.text}" 구간 그대로(색·그라데이션·두께·외곽선·그림자·광택). 자리를 옮겼어도 옆 레이어 색을 가져오지 마라.`;
    if (joinIdx.has(i)) {
      s += `\n  붙임: 같은 그룹 단어와 한 줄로 이어 쓴다. 이 단어의 스타일은 원문 "${l.text}"만 쓴다. 옆 단어 위에 겹쳐 그리지 마라.`;
    }
    if (boxMoved(l)) {
      s += `\n  이동됨: 원래 자리(가로 ${pct(l.ox0)}%~${pct(l.ox1)}%, 세로 ${pct(l.oy0)}%~${pct(l.oy1)}%)의 원문 "${l.text}"는 지우고 주변 배경으로 메운다. 새 글자는 위 새 박스에만 그린다.`;
    }
    return s;
  });
  return [joined, lineNote, items.join('\n\n')].filter(Boolean).join('\n\n');
}

function sameLineReading(list) {
  const used = new Set();
  const rows = [];
  list.forEach((l, i) => {
    if (used.has(i) || !Number.isFinite(Number(l.y0))) return;
    const cy = (Number(l.y0) + Number(l.y1)) / 2;
    const row = [i];
    used.add(i);
    list.forEach((o, j) => {
      if (used.has(j) || !Number.isFinite(Number(o.y0))) return;
      const oy = (Number(o.y0) + Number(o.y1)) / 2;
      if (Math.abs(oy - cy) <= 6) { row.push(j); used.add(j); }
    });
    row.sort((a, b) => a - b);
    rows.push(row);
  });
  const notes = rows.filter(r => r.length >= 2).map((row, n) => {
    const seq = row.map(i => layerOut(list[i]) || list[i].text).join(' → ');
    return `같은 줄 ${n + 1} 왼쪽→오른쪽(목록 순서): ${seq}`;
  });
  return notes.length ? '읽기 순서(반드시 이 순서로 한 줄에 배치):\n' + notes.join('\n') : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await requireApproved(req, res);
  if (!user) return;
  const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!key) return res.status(500).json({ error: '버셀 환경변수 OPENAI_API_KEY가 설정되지 않았어요.' });

  try {
    const { image, instruction, imgW, imgH, layers, removed, usage } = req.body;
    const size = (imgW && imgH) ? pickSize(imgW, imgH) : 'auto';

    const list = Array.isArray(layers) ? layers : [];
    const gone = Array.isArray(removed) ? removed.filter(l => l && l.text) : [];
    const layerBlock = list.length
      ? list.map((l, i) =>
          l.newText
            ? `${i + 1}번 레이어: 원문 "${l.text}" → 정확히 "${l.newText}". 색·그라데이션·두께·효과는 원문 "${l.text}"에서 인식된 스타일 그대로.`
            : `${i + 1}번 레이어: 원문 "${l.text}" → 아래 '언어 지정'에 맞춰 번역. 스타일은 원문 "${l.text}" 그대로.`
        ).join('\n')
      : '(남길 레이어 없음 — 아래 삭제 목록의 글자만 지운다)';
    const layoutBlock = list.length ? buildResultLayout(list) : '(삭제된 글자만 지우고 나머지 디자인은 유지)';
    const removedBlock = gone.length
      ? gone.map((l, i) => `${i + 1}. 원문 "${l.text}" — 결과에서 완전히 삭제. 번역하지 말고, 그 자리만 주변 배경으로 자연스럽게 메운다.`).join('\n')
      : '(삭제된 레이어 없음)';

    const prompt = `이 이미지에는 각 텍스트 박스 안에 이미 그 레이어의 원문 스타일(색·그라데이션·3D·그림자)이 자리 잡고 있다. 박스 안의 '글자 모양'만 아래 지정 텍스트로 바꾸고, 그 박스에 있는 효과는 그대로 유지한다.

글자 교체 (레이어 목록):
${layerBlock}

삭제할 원문 (결과 이미지에 남기면 안 됨):
${removedBlock}

각 박스 위치(이미 스타일이 들어가 있는 자리):
${layoutBlock}

전체 언어 지정(참고): ${instruction || '(개별 지정 우선)'}

지켜야 할 규칙:
- **효과는 박스에 이미 있다**: 입력 이미지에서 각 박스의 입체감·색·외곽선은 그 레이어 것이다. 글자만 새 문구로 바꿔라. 옆 박스의 색이나 효과를 가져오지 마라. 자리를 기준으로 효과를 고정하지 말고, 지금 그 박스에 있는 효과를 유지하라.
- **겹친 단어는 가로로 붙인다**: 한 줄로 이어 쓰되, 스타일은 레이어마다 따로다. 옆 레이어의 색·그라데이션·효과를 가져오거나 섞지 마라. 같은 자리에 위아래로 겹쳐 쌓지 마라.
- **같은 줄 순서**: 목록 위가 왼쪽, 아래가 오른쪽이다.
- **위치는 현재 박스다**: 지정된 가로·세로 % 박스 안에서만 글자를 바꿔라.
- **삭제된 레이어는 지운다**: "삭제할 원문"은 결과에서 완전히 없애고 배경으로 메운다.
- "정확히 …로 교체"라고 적힌 부분은 그 텍스트를 글자 하나 틀리지 않고 그대로 렌더링하라. 임의로 다시 번역하지 마라. "번역"이라고 적힌 부분만 지정 언어로 번역하라.
- 결과 이미지에는 지정된 새 글자만 있어야 한다. 원본 언어 글자나 흔적이 남으면 안 된다.
- 배경·아이콘·장식은 원본과 같게 유지하라. 가장자리에 테두리·여백을 넣지 마라.`;

    // base64 → 멀티파트 업로드 (OpenAI images.edit)
    const buf = Buffer.from(image, 'base64');
    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('image', new Blob([buf], { type: 'image/jpeg' }), 'banner.jpg');
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', 'high'); // 작은/조밀한 글자 정확도 우선

    const r = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` }, // Content-Type은 FormData가 자동 설정
      body: form
    });
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message || 'OpenAI 오류' });
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return res.status(400).json({ error: 'AI가 이미지를 반환하지 않았어요. 다시 시도해보세요.' });
    try { await logImageEdit(user, usage); } catch (e) { console.error('usage log', e); }
    res.status(200).json({ image: b64, mime: 'image/png' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
