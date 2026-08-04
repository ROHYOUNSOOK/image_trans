// api/command.js — 배너에서 잘라낸 '텍스트 조각' 하나의 글자만 번역 교체한다.
// (전체 배너를 재생성하지 않고 조각 단위로만 처리 → 배경·스타일 보존, 초광폭 비율 문제 우회)
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
    const { image, parts, instruction, cw, ch } = req.body;
    const ratio = (cw && ch) ? nearestRatio(cw, ch) : '1:1';

    // 이 조각에 들어있는 글자들(원문 → 교체값) 정리
    const list = Array.isArray(parts) ? parts : [];
    const partsBlock = list.length
      ? list.map((p, i) =>
          p.newText
            ? `${i + 1}) "${p.text}" → 정확히 "${p.newText}"(으)로 교체`
            : `${i + 1}) "${p.text}" → 아래 '언어 지정'에 맞춰 번역`
        ).join('\n')
      : '(이 조각의 글자를 아래 언어 지정에 맞춰 번역)';

    const prompt = `이 이미지는 하나의 배너에서 잘라낸 '텍스트 조각'이다. 배경 위에 글자가 있다.
이 조각 안의 '글자 내용만' 아래 지정대로 바꾼다. 그 외의 모든 것은 원본과 픽셀 단위로 동일하게 유지한다.

교체할 글자(왼쪽→오른쪽 순):
${partsBlock}

전체 언어 지정(참고): ${instruction || '(개별 지정 우선)'}

지켜야 할 규칙:
- 각 글자의 색, 굵기(볼드 정도), 크기, 외곽선(테두리)의 색과 두께, 그림자, 입체감, 광택을 원본 이미지에서 눈으로 확인한 뒤 새 글자에 똑같이 입혀라. 원본에 없는 효과(외곽선·크롬·금속 질감 등)를 임의로 추가하지 마라. 반대로 원본에 있는 효과를 빼거나 밋밋한 단색·평범한 볼드로 단순화하지도 마라. 각 부분은 원본에서 가진 색·두께·외곽선을 그대로 물려받아야 한다.
- 서로 다른 색이나 스타일의 부분이 한 조각에 함께 있으면 각 부분의 스타일을 각각 그대로 유지하라(예: 한쪽은 노란색, 다른 쪽은 초록색).
- 배경(색·그라데이션·장식·빛·무늬)은 원본과 100% 동일하게 유지하고 절대 다시 그리지 마라.
- 글자의 위치·정렬·기울기·크기를 원본과 동일하게 유지하라. 새 글자가 길어지면 줄바꿈하지 말고 글자 크기만 살짝 줄여 이 조각 안에 넣어라.
- "정확히 …로 교체"라고 적힌 부분은 그 텍스트를 글자 하나 틀리지 않고 그대로 사용하라. 임의로 다시 번역하지 마라. "번역"이라고 적힌 부분만 지정 언어로 번역하라.
- 출력 이미지는 입력과 정확히 같은 크기·비율이어야 한다. 이미지 가장자리에 테두리·프레임·여백(레터박스)을 절대 만들지 마라. 조각 전체를 가장자리까지 꽉 채워라.`;

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
