// api/ocr.js — Gemini 2단계 호출: 색상 목록 → 색상별 텍스트 검출
import { requireApproved } from '../lib/auth.js';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent';

async function callGemini(key, imagePart, textPrompt, schema) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [imagePart, { text: textPrompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    })
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  let raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '[]';
  const m = raw.match(/[\[{][\s\S]*[}\]]/);
  if (m) raw = m[0];
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!await requireApproved(req, res)) return;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: '버셀 환경변수 GEMINI_API_KEY가 설정되지 않았어요.' });

  try {
    const { image } = req.body;
    const imagePart = { inline_data: { mime_type: 'image/jpeg', data: image } };

    // ── 1차 호출: 이미지에서 텍스트에 사용된 색상 목록 추출 ──
    const colors = await callGemini(key, imagePart,
      `List every distinct text color visible in this image. For each color, describe it with a simple name (e.g. "red", "yellow", "white", "black", "orange", "gold", "blue", "green", "pink", "gray"). Only list colors that are actually used for text, not background colors.`,
      {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { color: { type: 'STRING' } },
          required: ['color']
        }
      }
    );

    const colorList = colors.map(c => c.color);

    // ── 2차 호출: 색상별로 해당 색상 텍스트만 검출 ──
    const allSegments = await callGemini(key, imagePart,
      `Detect text in this image (Korean, Japanese, English, numbers).
The image contains text in these colors: ${colorList.join(', ')}.

For EACH color, detect ONLY the text characters that are in that specific color. Output a separate segment for each color group.
If a visual line contains text in multiple colors (e.g. "꿀" is red but "드림 위크" is yellow), they MUST be separate segments — one per color.
Do NOT combine text of different colors into one segment.

Return each segment with:
- "box_2d": tight bounding box [ymin, xmin, ymax, xmax] normalized to 0-1000
- "label": the text content (only characters of that one color)
- "color": the color name`,
      {
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
    );

    // box_2d [ymin,xmin,ymax,xmax] (0~1000) → x,y,w,h 퍼센트(0~100)
    const lines = allSegments
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
