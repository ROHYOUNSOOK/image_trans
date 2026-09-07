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

/** 현재 박스 좌표(이미지 대비 %)에 그 레이어 스타일로 배치. 같은 줄은 목록 위가 왼쪽. */
function buildResultLayout(list) {
  const lineNote = sameLineReading(list);
  const items = list.map((l, i) => {
    const word = layerOut(l) ? `"${layerOut(l)}"` : `(원문 "${l.text}"를 지정 언어로 번역)`;
    const z = i === list.length - 1 ? '맨 앞(다른 글자 위)' : (i === 0 ? '맨 뒤(다른 글자 아래)' : `앞에서 ${list.length - i}번째`);
    let s = `${i + 1}번 레이어 ${word}\n  그릴 위치: 가로 ${pct(l.x0)}%~${pct(l.x1)}%, 세로 ${pct(l.y0)}%~${pct(l.y1)}% (이미지 왼쪽·위가 0%, 오른쪽·아래가 100%). 박스 안에 맞춰 그린다.\n  스타일: 원문 "${l.text}" 구간 그대로(색·그라데이션·두께·외곽선·그림자·광택). 자리를 옮겼어도 옆 레이어 색을 가져오지 마라.\n  겹침 순서: ${z}.`;
    if (boxMoved(l)) {
      s += `\n  이동됨: 원래 자리(가로 ${pct(l.ox0)}%~${pct(l.ox1)}%, 세로 ${pct(l.oy0)}%~${pct(l.oy1)}%)의 원문 "${l.text}"는 지우고 주변 배경으로 메운다. 새 글자는 위 새 박스에만 그린다.`;
    }
    return s;
  });
  return (lineNote ? lineNote + '\n\n' : '') + items.join('\n\n');
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

    const prompt = `이 배너 이미지의 '글자'만 아래 지정대로 바꾼다. 배경·디자인·아이콘은 원본과 똑같이 유지하고, 지정한 글자 외에는 아무것도 바꾸지 않는다.

글자 교체 (레이어 목록):
${layerBlock}

삭제할 원문 (결과 이미지에 남기면 안 됨):
${removedBlock}

결과 배치 — 미리보기에서 조절한 박스 좌표가 유일한 정답이다. 원본 글자가 있던 자리에 그리지 말고, 아래 좌표의 박스에 그려라:
${layoutBlock}

전체 언어 지정(참고): ${instruction || '(개별 지정 우선)'}

지켜야 할 규칙:
- **같은 줄 순서**: 목록에서 위에 있는 레이어가 왼쪽, 아래에 있는 레이어가 오른쪽이다. 원본 좌우와 달라도 목록 순서를 따른다. 색·효과는 각 레이어 원문을 따라 그 자리로 이동한다.
- **위치는 현재 박스다**: 각 레이어의 새 글자는 지정된 가로·세로 % 박스 안에 맞춘다. 원본 자리와 새 박스가 다르면 원본 자리의 글자는 지우고 배경으로 메운다.
- **스타일은 그 레이어를 따라 이동한다**: 색, 그라데이션, 굵기, 외곽선, 그림자, 입체감, 광택은 그 레이어 원문에서 보인 스타일 그대로다. 박스를 오른쪽으로 옮겼어도 주황 원문은 주황, 갈색 원문은 갈색이다. 새 자리에 있던 옆 글자의 색을 가져오지 마라. 없던 효과를 추가하거나 있던 효과를 빼지 마라. 글자 크기는 박스 높이에 맞게 조절한다.
- **겹침**: 목록에서 아래(번호가 큰) 레이어를 더 앞에 그린다.
- **삭제된 레이어는 지운다**: "삭제할 원문"에 적힌 글자는 결과에서 완전히 없앤다. 빈 자리는 주변 배경·그라데이션·무늬로 메운다. 그 글자를 번역하거나 다른 언어로 다시 쓰지 마라.
- "정확히 …로 교체"라고 적힌 부분은 그 텍스트를 글자 하나 틀리지 않고 그대로 렌더링하라. 복잡한 글자(한자·태국어의 성조/모음 부호 등)도 정확히, 중복 없이 그려라. 임의로 다시 번역하지 마라. "번역"이라고 적힌 부분만 지정 언어로 번역하라.
- 결과 이미지에는 지정된 새 글자만 있어야 한다. 원본 언어(예: 한글)의 글자나 흔적이 남으면 안 된다. 삭제 목록의 글자도 남으면 안 된다.
- 배경(색·그라데이션·장식·빛·무늬)과 아이콘·말풍선 등 그래픽 요소는 원본과 100% 동일하게 유지하고, 글자와 겹치지 않게 하라.
- 이미지 가장자리에 테두리·프레임·둥근 모서리·여백을 절대 추가하지 마라. 배너 그림이 가장자리까지 꽉 차야 한다.`;

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
