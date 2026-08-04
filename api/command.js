// api/command.js — OpenAI gpt-image-2 (images.edit)로 배너 글자를 번역 교체한다.
// 모델 제약상 최대 3:1까지만 생성 가능 → 3:1로 만들고, 나머지는 클라이언트가 원본 폭으로 합성.

// gpt-image-2 size 제약: 장변<3840, 두 변 모두 16의 배수, 장변:단변 ≤ 3:1,
//                        655,360 ≤ 총픽셀 ≤ 8,294,400
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: '버셀 환경변수 OPENAI_API_KEY가 설정되지 않았어요.' });

  try {
    const { image, instruction, imgW, imgH, layers } = req.body;
    const size = (imgW && imgH) ? pickSize(imgW, imgH) : 'auto';

    const list = Array.isArray(layers) ? layers : [];
    const layerBlock = list.length
      ? list.map(l =>
          l.newText
            ? `- "${l.text}" → 정확히 "${l.newText}"(으)로 교체`
            : `- "${l.text}" → 아래 '언어 지정'에 맞춰 번역`
        ).join('\n')
      : '(이미지의 모든 글자를 아래 언어 지정에 맞춰 번역)';

    const prompt = `이 배너 이미지의 '글자'만 아래 지정대로 바꾼다. 배경·디자인·아이콘·글자 스타일은 원본과 똑같이 유지하고, 지정한 글자 외에는 아무것도 바꾸지 않는다.

글자 교체:
${layerBlock}

전체 언어 지정(참고): ${instruction || '(개별 지정 우선)'}

지켜야 할 규칙:
- 각 글자의 색, 굵기, 크기, 외곽선(테두리)의 색과 두께, 그림자, 입체감, 광택을 원본과 동일하게 유지하라. 없던 효과를 추가하거나 있던 효과를 빼지 마라.
- "정확히 …로 교체"라고 적힌 부분은 그 텍스트를 글자 하나 틀리지 않고 그대로 렌더링하라. 복잡한 글자(한자·태국어의 성조/모음 부호 등)도 정확히, 중복 없이 그려라. 임의로 다시 번역하지 마라. "번역"이라고 적힌 부분만 지정 언어로 번역하라.
- 결과 이미지에는 지정된 새 글자만 있어야 한다. 원본 언어(예: 한글)의 글자나 흔적이 남으면 안 된다.
- 배경(색·그라데이션·장식·빛·무늬)과 아이콘·말풍선 등 그래픽 요소는 원본과 100% 동일하게 유지하고, 글자와 겹치지 않게 하라.
- 글자의 위치·정렬·크기를 원본과 최대한 동일하게 유지하라.
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
    res.status(200).json({ image: b64, mime: 'image/png' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
