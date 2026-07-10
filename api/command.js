// api/command.js — 이미지 전체 + 자연어 명령 + 인식된 텍스트 레이어 목록을 함께 참고해 재생성
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
    const ratio = (imgW && imgH) ? nearestRatio(imgW, imgH) : '3:4';

    // 레이어 목록(원문 + 수정값) 텍스트로 정리
    let layerBlock = '(인식된 텍스트 없음)';
    if (Array.isArray(layers) && layers.length) {
      layerBlock = layers.map((l, i) =>
        `${i + 1}. "${l.text}"${l.newText ? ` → 사용자가 이미 "${l.newText}"로 수정 지정함` : ''}`
      ).join('\n');
    }

    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: 'image/jpeg', data: image } },
              { text: `이 이미지 안에서 정확히 인식된 텍스트 레이어 목록이다. 반드시 이 목록에 있는 텍스트만 대상으로 작업하고, 목록에 없는 문자나 요소는 새로 만들지 마라:
${layerBlock}

사용자 명령: ${instruction}

규칙:
- **줄 개수 절대 유지**: 위 목록의 각 번호는 원본의 한 줄이다. 결과 이미지의 텍스트 줄 개수는 위 목록의 항목 개수와 정확히 같아야 한다. 어떤 줄도 두 줄 이상으로 쪼개지 마라. 번역이나 문구 변경으로 글자가 길어져도 새 줄을 만들지 마라. (예: 원본이 2줄이면 결과도 반드시 2줄)
- 각 줄이 한 줄에 안 들어가면, 절대 줄을 나누지 말고 그 줄의 글자 크기만 줄여서 한 줄에 맞춰라. 줄바꿈보다 글자 크기 축소를 항상 우선하라.
- 위 목록에 "사용자가 이미 수정 지정함"이라고 표시된 줄은 그 지정된 텍스트로 정확히 그대로 교체하라 (임의로 다른 줄과 합치거나 나누지 마라).
- 나머지 줄은 사용자 명령에 따라 처리하라 (예: 번역, 문구 변경 등).
- 목록에 없는 텍스트를 추가하거나 없는 요소를 새로 그리지 마라.
- 텍스트 스타일(폰트, 두께, 3D 입체·크롬·그라디언트·외곽선·그림자 등 모든 효과)과 정렬은 원본과 완전히 동일하게 유지하라. 이 효과들은 절대 변경·단순화·생략하지 마라.
- 모든 텍스트(글자, 외곽선, 그림자 포함)는 이미지 가장자리(상하좌우)에서 안쪽으로 최소 3% 여백 안에 완전히 들어가야 한다. 여백을 넘으면 다른 스타일 효과는 그대로 둔 채 글자 크기만 비례적으로 줄여라. 가장자리에 닿거나 잘리게 두지 마라.
- 배경, 장식, 색상, 조명 등 텍스트가 아닌 모든 요소는 원본과 100% 동일하게 유지하고 다시 그리지 마라.
- 결과 이미지는 입력 이미지와 정확히 동일한 가로세로 비율(aspect ratio)과 구도로 출력하라. 글자나 이미지를 세로/가로로 늘리거나 눌러서 왜곡하지 마라. 모든 글자의 원래 가로:세로 비율을 그대로 유지하라.
- 배경이 프레임 전체(가장자리 끝까지)를 꽉 채우게 하라. 이미지 주변에 단색 테두리나 여백(레터박스)을 만들지 마라.` }
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
    if (!part) return res.status(400).json({ error: 'AI가 이미지를 반환하지 않았어요. 명령을 조금 바꿔 다시 시도해보세요.' });
    const inline = part.inlineData || part.inline_data;
    res.status(200).json({ image: inline.data, mime: inline.mimeType || inline.mime_type || 'image/png' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
