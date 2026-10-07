const MAX_CHARS = 24000;

function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export default async function handler(req, res) {
  headers(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'Serviço de oficina indisponível' });

  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Transcrição vazia' });
    if (text.length > MAX_CHARS) return res.status(413).json({ error: 'Texto muito longo para uma única revisão' });

    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.25,
        messages: [
          { role: 'system', content: 'Você é um editor literário em português brasileiro. Converta transcrição oral em prosa de livro clara e natural. Preserve rigorosamente fatos, ideias, sentido, voz autoral e ordem lógica. Corrija pontuação, concordância e repetições acidentais; remova vícios de fala apenas quando não acrescentarem significado. Não invente fatos, exemplos, argumentos ou conclusões. Não resuma conteúdo relevante. Separe em parágrafos. Responda SOMENTE JSON válido no formato {"title":"...","text":"..."}. O título deve ser curto e derivado do assunto; se não houver assunto claro, use "Sem título".' },
          { role: 'user', content: text }
        ],
        response_format: { type: 'json_object' }
      })
    });
    const raw = await upstream.text();
    let data={}; try { data=JSON.parse(raw) } catch {}
    if (!upstream.ok) {
      console.error('Groq workshop error', upstream.status, raw.slice(0,1000));
      return res.status(502).json({ error: 'Não foi possível trabalhar o texto' });
    }
    const content=data?.choices?.[0]?.message?.content || '{}';
    let result={}; try { result=JSON.parse(content) } catch { result={text:content,title:'Sem título'} }
    return res.status(200).json({ title:String(result.title||'Sem título'), text:String(result.text||'') });
  } catch(e) {
    console.error('Workshop handler error', e);
    return res.status(500).json({ error: 'Erro interno na oficina' });
  }
}