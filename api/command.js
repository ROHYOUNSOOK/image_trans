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
        l.newText
          ? `${i + 1}번 줄: "${l.text}" → 이 줄을 정확히 "${l.newText}"(으)로 교체`
          : `${i + 1}번 줄: "${l.text}" → 사용자 명령에 따라 처리`
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
              { text: `이 이미지의 텍스트를 교체하는 작업이다. 아래는 원본 각 줄과 교체할 내용이다:
${layerBlock}

전체 언어 지정(참고): ${instruction}

핵심 원칙 — 이 작업은 "글자 내용만 교체"하는 것이다. 디자인은 절대 다시 만들지 않는다:
- 각 줄의 글자 내용만 지정된 텍스트로 바꾼다. 그 외의 모든 것은 원본과 픽셀 단위로 동일해야 한다.
- **텍스트 효과는 원본에서 그대로 복사한다**: 각 줄이 원본에서 가진 폰트 모양, 색상, 표면 질감(은색/금색 크롬, 메탈릭 광택), 그라디언트, 외곽선(테두리) 두께와 색, 3D 입체감(돌출·경사), 그림자(방향·색·흐림), 광택/반짝임을 새 글자에 똑같이 입힌다. 새 글자를 밋밋한 단색이나 평범한 볼드체로 그리지 마라. (예: 원본에서 흰색 크롬+파란 외곽선이던 줄은 결과도 흰색 크롬+파란 외곽선, 노란 금속이던 줄은 결과도 노란 금속)
- 각 줄의 위치, 정렬, 기울기, 글자 크기는 원본과 동일하게 유지한다.

규칙:
- "정확히 …로 교체"라고 적힌 줄은 그 텍스트를 글자 하나 틀리지 않고 그대로 사용하라. 임의로 번역하거나 문구를 바꾸지 마라.
- "사용자 명령에 따라 처리"라고 적힌 줄만, 전체 언어 지정에 맞춰 해당 언어로 번역하라.
- **줄 개수 절대 유지**: 결과의 텍스트 줄 개수는 위 목록의 줄 개수와 정확히 같아야 한다. 어떤 줄도 두 줄로 쪼개지 마라. 글자가 길어지면 줄바꿈 대신 그 줄의 글자 크기만 줄여서 한 줄에 맞춰라.
- 목록에 없는 텍스트나 요소를 새로 추가하지 마라.
- 모든 텍스트(글자·외곽선·그림자 포함)는 이미지 가장자리에서 안쪽으로 최소 3% 여백 안에 완전히 들어가야 한다. 넘으면 효과는 유지한 채 글자 크기만 줄여라. 잘리게 두지 마라.
- 배경, 장식, 물방울, 색상, 조명 등 텍스트가 아닌 모든 요소는 원본과 100% 동일하게 유지하고 다시 그리지 마라.
- 결과 이미지는 입력과 정확히 동일한 가로세로 비율과 구도로 출력하라. 왜곡·늘림·눌림 금지. 이미지 주변에 여백(레터박스)이나 테두리를 만들지 마라.` }
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
