// api/edit.js — Gemini 3.1 Flash Lite Image(Nano Banana 2 Lite)로
// 잘라낸 텍스트 영역만 생성형 편집 (원본 폰트·효과·배경 유지)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: '버셀 환경변수 GEMINI_API_KEY가 설정되지 않았어요.' });

  try {
    const { image, original, replacement } = req.body;
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: 'image/png', data: image } },
              { text: `Edit this image: replace the text "${original}" with "${replacement}".
Keep the EXACT same font style, weight, color, gradient, 3D effects, outline, shadow, size, and position as the original text.
Keep the background and every other element completely unchanged.
Output only the edited image.` }
            ]
          }]
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
