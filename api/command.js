// api/command.js — 배너 전체를 한 번에 번역 생성한다 (글자 정확도·안정성 우선).
const RATIOS = [
  ['21:9', 21/9], ['16:9', 16/9], ['3:2', 3/2], ['4:3', 4/3], ['5:4', 5/4],
  ['1:1', 1], ['4:5', 4/5], ['3:4', 3/4], ['2:3', 2/3], ['9:16', 9/16]
];
function nearestRatio(w, h) {
  const ar = w / h;
  let best = RATIOS[0];
  for (const r of RATIOS) if (Math.abs(r[1] - ar) < Math.abs(best[1] - ar)) best = r;
  return best[0];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: '버셀 환경변수 GEMINI_API_KEY가 설정되지 않았어요.' });

  try {
    const { image, instruction, imgW, imgH, layers } = req.body;
    const ratio = (imgW && imgH) ? nearestRatio(imgW, imgH) : '16:9';

    const list = Array.isArray(layers) ? layers : [];
    const layerBlock = list.length
      ? list.map((l) =>
          l.newText
            ? `- "${l.text}" → 정확히 "${l.newText}"(으)로 교체`
            : `- "${l.text}" → 아래 '언어 지정'에 맞춰 번역`
        ).join('\n')
      : '(이미지의 모든 글자를 아래 언어 지정에 맞춰 번역)';

    const prompt = `이 배너 이미지의 '글자'를 아래 지정대로 바꾼다. 배경·디자인·글자 스타일은 원본과 똑같이 유지한다.

글자 교체:
${layerBlock}

전체 언어 지정(참고): ${instruction || '(개별 지정 우선)'}

지켜야 할 규칙:
- 각 글자의 색, 굵기, 크기, 외곽선(테두리)의 색과 두께, 그림자, 입체감, 광택을 원본과 동일하게 유지하라. 원본에 없는 효과를 추가하거나, 있는 효과를 빼지 마라.
- "정확히 …로 교체"라고 적힌 부분은 그 텍스트를 글자 하나 틀리지 않고 그대로 사용하라. 임의로 다시 번역하지 마라. 복잡한 한자도 정확히 그 글자로 렌더링하고, 같은 글자를 중복해서 그리거나 없는 글자를 지어내지 마라. "번역"이라고 적힌 부분만 지정 언어로 번역하라.
- 결과에는 지정된 새 글자만 있어야 한다. 원본 언어(예: 한글)의 글자나 흔적이 남으면 안 된다.
- 배경(색·그라데이션·장식·빛·무늬)과 아이콘·말풍선 등 그래픽 요소는 원본과 동일하게 유지하고, 글자와 겹치지 않게 하라.
- 글자의 위치·정렬·크기를 원본과 최대한 동일하게 유지하라.
- 이미지 가장자리에 테두리·프레임·둥근 모서리·여백(레터박스)을 절대 추가하지 마라. 배너 그림이 가장자리까지 꽉 차야 한다.`;

    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: 'image/jpeg', data: image } },
              { text: prompt }
            ]
          }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: ratio, imageSize: '2K' }
          }
        })
      }
    );
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
    if (!part) return res.status(400).json({ error: 'AI가 이미지를 반환하지 않았어요. 다시 시도해보세요.' });
    const inline = part.inlineData || part.inline_data;
    res.status(200).json({ image: inline.data, mime: inline.mimeType || inline.mime_type || 'image/png' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
