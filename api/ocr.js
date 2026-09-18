// api/ocr.js — Gemini 고유 좌표 형식(box_2d, 0~1000)으로 텍스트 위치 인식
import { requireApproved } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!await requireApproved(req, res)) return;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: '버셀 환경변수 GEMINI_API_KEY가 설정되지 않았어요.' });

  try {
    const { image } = req.body;
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: 'image/jpeg', data: image } },
              { text: `You are a precise OCR engine. Your task has TWO steps:

STEP 1: For each text region, identify the dominant color of the text (e.g. "red", "yellow", "white", "black", "orange", "blue", "green", "pink", "gold", "gray").

STEP 2: Output each text segment as a separate object. Characters that share the same color AND are visually grouped together belong to one segment. Characters with a DIFFERENT color MUST be a separate segment even if they are on the same line.

SPLITTING RULES:
- DIFFERENT COLOR → ALWAYS split into separate segments.
- DIFFERENT font weight, size, or style → split.
- Same color + same style + same line → keep together.

Detect all text in this image (Korean, Japanese, English, numbers).
Return each segment with:
- "box_2d": tight bounding box [ymin, xmin, ymax, xmax] normalized to 0-1000
- "label": the text content
- "color": the dominant color name of that text` }
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
                  box_2d: { type: 'ARRAY', items: { type: 'NUMBER' } },
                  label: { type: 'STRING' },
                  color: { type: 'STRING' }
                },
                required: ['box_2d', 'label', 'color']
              }
            }
          }
        })
      }
    );
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    let raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '[]';
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) raw = m[0];
    let arr;
    try { arr = JSON.parse(raw); }
    catch { return res.status(400).json({ error: 'AI 응답 해석 실패 — 이미지를 다시 업로드해보세요.' }); }

    // box_2d [ymin,xmin,ymax,xmax] (0~1000) → x,y,w,h 퍼센트(0~100)
    const lines = arr
      .filter(l => l && l.label && Array.isArray(l.box_2d) && l.box_2d.length === 4)
      .map(l => {
        const [y0, x0, y1, x1] = l.box_2d.map(Number);
        return {
          text: String(l.label),
          x: Math.max(0, Math.min(99, x0 / 10)),
          y: Math.max(0, Math.min(99, y0 / 10)),
          w: Math.max(0.5, (x1 - x0) / 10),
          h: Math.max(0.5, (y1 - y0) / 10)
        };
      });
    res.status(200).json({ lines });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
