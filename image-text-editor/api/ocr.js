// api/ocr.js — 버셀 서버에서 실행됨 (API 키는 여기서만 사용, 브라우저에 노출 안 됨)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: '버셀 환경변수 ANTHROPIC_API_KEY가 설정되지 않았어요.' });

  try {
    const { image } = req.body; // base64 jpeg
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            { type: 'text', text: `이 이미지에 있는 모든 텍스트를 줄 단위로 찾아줘. 각 줄의 위치를 이미지 전체 크기 대비 퍼센트(0~100)로 알려줘.
반드시 아래 JSON 배열만 출력해. 다른 설명, 마크다운 백틱 금지.
[{"text":"읽은 텍스트","x":좌측%,"y":상단%,"w":너비%,"h":높이%}]
텍스트가 없으면 [] 출력.` }
          ]
        }]
      })
    });
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    const raw = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const arr = JSON.parse(raw.replace(/```json|```/g, '').trim());
    res.status(200).json({ lines: arr });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
