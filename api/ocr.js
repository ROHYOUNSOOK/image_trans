// api/ocr.js — Gemini로 이미지 속 텍스트 줄 + 위치 인식 (JSON 강제 모드)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: '버셀 환경변수 GEMINI_API_KEY가 설정되지 않았어요.' });

  try {
    const { image } = req.body;
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: 'image/jpeg', data: image } },
              { text: 'Find every line of text in this image (Korean, Japanese, English, numbers). For each line give its position as percentages (0-100) of the full image size.' }
            ]
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  text: { type: 'STRING' },
                  x: { type: 'NUMBER' },
                  y: { type: 'NUMBER' },
                  w: { type: 'NUMBER' },
                  h: { type: 'NUMBER' }
                },
                required: ['text', 'x', 'y', 'w', 'h']
              }
            }
          }
        })
      }
    );
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    let raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '[]';
    // 안전장치: 혹시 JSON 밖에 다른 글자가 붙어도 배열 부분만 추출
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) raw = m[0];
    let arr;
    try { arr = JSON.parse(raw); }
    catch { return res.status(400).json({ error: 'AI 응답 해석 실패 — 이미지를 다시 업로드해보세요.' }); }

    // 값 검증: 숫자 아닌 항목 제거, 범위 보정
    arr = arr.filter(l => l && l.text && [l.x, l.y, l.w, l.h].every(n => typeof n === 'number'))
             .map(l => ({ text: String(l.text),
                          x: Math.max(0, Math.min(100, l.x)),
                          y: Math.max(0, Math.min(100, l.y)),
                          w: Math.max(0.5, Math.min(100, l.w)),
                          h: Math.max(0.5, Math.min(100, l.h)) }));
    res.status(200).json({ lines: arr });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
