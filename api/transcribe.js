export const config = { api: { bodyParser: false } };

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_AUDIO_TYPES = [
  'audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a',
  'audio/wav', 'audio/x-wav', 'audio/ogg', 'application/octet-stream',
  'multipart/form-data'
];

function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
}

export default async function handler(req, res) {
  securityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'Serviço de transcrição indisponível' });
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!ALLOWED_AUDIO_TYPES.some(t => contentType.startsWith(t))) {
    return res.status(415).json({ error: 'Formato de áudio não permitido' });
  }

  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > MAX_BYTES) {
    return res.status(413).json({ error: 'Áudio excede o limite de 20 MB' });
  }

  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BYTES) {
        return res.status(413).json({ error: 'Áudio excede o limite de 20 MB' });
      }
      chunks.push(chunk);
    }

    if (!total) return res.status(400).json({ error: 'Áudio vazio' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    let upstream;
    try {
      upstream = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
          'Content-Type': contentType
        },
        body: Buffer.concat(chunks),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error('Transcription upstream error:', upstream.status);
      return res.status(502).json({ error: 'Não foi possível concluir a transcrição' });
    }

    return res.status(200).json({ text: typeof data.text === 'string' ? data.text : '' });
  } catch (e) {
    console.error('Transcription handler error:', e?.name || 'Error');
    return res.status(500).json({ error: 'Erro interno de transcrição' });
  }
}
