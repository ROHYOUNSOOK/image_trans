// api/edit.js — Gemini 3.1 Flash Image(Nano Banana 2)로
// 잘라낸 텍스트 영역만 생성형 편집 (원본 폰트 효과·배경 최대 보존)
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
    const { image, original, replacement, cropW, cropH } = req.body;
    const ratio = (cropW && cropH) ? nearestRatio(cropW, cropH) : '16:9';

    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: 'image/png', data: image } },
              { text: `This is a cropped section of a promotional banner.
TASK: Change ONLY the text "${original}" to read "${replacement}".

STRICT RULES:
- Reproduce the EXACT same typography treatment: same typeface style, same weight, same size, same letter spacing, same position and alignment.
- Preserve ALL text effects perfectly: 3D extrusion, metallic chrome finish, gold/silver gradients, outlines, bevels, drop shadows, glow — whatever the original text has.
- The background, decorations, colors, lighting, and every other pixel must remain IDENTICAL to the input image. Do not repaint, simplify, or restyle anything.
- Do not add, remove, or move any other element.
- Output only the edited image, same framing as the input.` }
            ]
          }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: ratio, imageSize: '1K' }
          }
        })
      }
    );
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
    if (!part) return res.status(400).json({ error: 'AI가 이미지를 반환하지 않았어요. 다시 시도해주세요.' });
    const inline = part.inlineData || part.inline_data;
    res.status(200).json({ image: inline.data, mime: inline.mimeType || inline.mime_type || 'image/png' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
