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

/** 같은 시각 줄끼리 묶고, 줄 안 읽기 순서는 원본 x가 아니라 현재 목록 순서를 쓴다. */
function buildResultLayout(list) {
  const items = list.map((l, i) => ({
    i,
    text: String(l.text || ''),
    out: layerOut(l),
    x: Number.isFinite(Number(l.x)) ? Number(l.x) : null,
    y: Number.isFinite(Number(l.y)) ? Number(l.y) : null
  }));
  const rows = [];
  const used = new Set();
  const yOrder = [...items].sort((a, b) => {
    if (a.y == null || b.y == null) return a.i - b.i;
    return a.y - b.y || a.i - b.i;
  });
  for (const item of yOrder) {
    if (used.has(item.i)) continue;
    const row = [item];
    used.add(item.i);
    if (item.y != null) {
      for (const other of items) {
        if (used.has(other.i) || other.y == null) continue;
        if (Math.abs(other.y - item.y) <= 0.10) {
          row.push(other);
          used.add(other.i);
        }
      }
    }
    row.sort((a, b) => a.i - b.i);
    rows.push(row);
  }

  return rows.map((row, ri) => {
    const readAs = row.map(p => p.out || `[${p.text} 번역]`).join(' ');
    const parts = row.map((p, pi) => {
      const word = p.out ? `"${p.out}"` : `(원문 "${p.text}"를 지정 언어로 번역)`;
      const place = row.length === 1
        ? '이 줄'
        : (pi === 0 ? '맨 왼쪽(앞)' : pi === row.length - 1 ? '맨 오른쪽(뒤)' : `왼쪽에서 ${pi + 1}번째`);
      return `  - ${place}: ${word}. 스타일은 원문 "${p.text}" 구간만 따른다(그 원문의 색·그라데이션·효과 유지).`;
    }).join('\n');
    const byX = row.filter(p => p.x != null).sort((a, b) => a.x - b.x);
    const swapped = byX.length >= 2 && byX.some((p, i) => p.i !== row[i].i);
    const swapNote = swapped
      ? `\n  ⚠ 원본 좌우(${byX.map(p => `"${p.text}"`).join(' → ')})와 순서가 다르다. 원본 자리를 버리고 반드시 왼쪽부터 "${readAs}" 순서로 그려라. 원래 왼쪽이던 조각이 이제 이 줄의 뒤(오른쪽)로 간다. 주황 등 효과는 그 조각 글자만 따라 이동하고, 앞에 겹쳐 올리지 마라.`
      : '';
    return `${ri + 1}번째 시각 줄 읽기(왼쪽→오른쪽): ${readAs}\n${parts}${swapNote}`;
  }).join('\n\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await requireApproved(req, res);
  if (!user) return;
  const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!key) return res.status(500).json({ error: '버셀 환경변수 OPENAI_API_KEY가 설정되지 않았어요.' });

  try {
    const { image, instruction, imgW, imgH, layers, usage } = req.body;
    const size = (imgW && imgH) ? pickSize(imgW, imgH) : 'auto';

    const list = Array.isArray(layers) ? layers : [];
    const layerBlock = list.length
      ? list.map((l, i) =>
          l.newText
            ? `${i + 1}번 레이어: 원문 "${l.text}" → 정확히 "${l.newText}". 색·그라데이션·두께·효과는 원문 "${l.text}"에서 인식된 스타일 그대로.`
            : `${i + 1}번 레이어: 원문 "${l.text}" → 아래 '언어 지정'에 맞춰 번역. 스타일은 원문 "${l.text}" 그대로.`
        ).join('\n')
      : '(이미지의 모든 글자를 아래 언어 지정에 맞춰 번역)';
    const layoutBlock = list.length ? buildResultLayout(list) : '(원본 모든 글자를 지정 언어로 번역)';

    const prompt = `이 배너 이미지의 '글자'만 아래 지정대로 바꾼다. 배경·디자인·아이콘은 원본과 똑같이 유지하고, 지정한 글자 외에는 아무것도 바꾸지 않는다.

글자 교체 (레이어 목록):
${layerBlock}

결과 레이아웃 — 이 배치가 유일한 정답이다. 원본 이미지의 좌우 자리는 무시한다:
${layoutBlock}

전체 언어 지정(참고): ${instruction || '(개별 지정 우선)'}

지켜야 할 규칙:
- **스타일은 글자와 함께 이동한다**: 각 조각의 색, 그라데이션, 굵기, 외곽선, 그림자, 입체감, 광택은 그 조각의 원문 구간에서 보인 스타일 그대로다. 주황 원문(예: "가을 혜택")의 번역(예: "Fall Specials")만 주황 그라데이션을 유지한다. 갈색 원문(예: "에 빠지다")의 번역(예: "Fall Into")에는 주황을 칠하지 말고 원문 갈색을 유지한다. 자리를 옮겼다고 옆 단어 색을 가져오지 마라. 없던 효과를 추가하거나 있던 효과를 빼지 마라.
- **같은 줄은 목록 순서대로 왼쪽→오른쪽**: 원본에서 주황 글자가 왼쪽에 있었더라도, 그 레이어가 목록에서 더 뒤면 결과에서는 그 줄의 뒤(오른쪽)로 가야 한다. 원래 자리에 두지 마라. 앞에 겹쳐 올리거나 다른 단어를 가리지 마라. 한 줄로 이어 쓴다.
- "정확히 …로 교체"라고 적힌 부분은 그 텍스트를 글자 하나 틀리지 않고 그대로 렌더링하라. 복잡한 글자(한자·태국어의 성조/모음 부호 등)도 정확히, 중복 없이 그려라. 임의로 다시 번역하지 마라. "번역"이라고 적힌 부분만 지정 언어로 번역하라.
- 결과 이미지에는 지정된 새 글자만 있어야 한다. 원본 언어(예: 한글)의 글자나 흔적이 남으면 안 된다.
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
