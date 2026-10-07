export const config = { api: { bodyParser: false } };

const MAX_BYTES = 20 * 1024 * 1024;

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
    return res.status(503).json({ error: 'GROQ_API_KEY não configurada na Vercel' });
  }

  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BYTES) return res.status(413).json({ error: 'Áudio excede o limite de 20 MB' });
      chunks.push(chunk);
    }
    if (!total) return res.status(400).json({ error: 'Áudio vazio' });

    // O navegador envia multipart/form-data. Encaminhamos o corpo multipart
    // intacto para a Groq, preservando o boundary gerado pelo navegador.
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      return res.status(415).json({ error: 'Formato de envio inválido' });
    }

    const body = Buffer.concat(chunks);
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2]);
    if (!boundary) return res.status(400).json({ error: 'Envio multipart sem boundary' });

    // Injeta os campos exigidos pela API Groq antes do boundary final,
    // mantendo o arquivo de áudio recebido sem reprocessamento.
    const closing = Buffer.from(`--${boundary}--`);
    const closeAt = body.lastIndexOf(closing);
    if (closeAt < 0) return res.status(400).json({ error: 'Corpo multipart inválido' });

    const prefix = body.subarray(0, closeAt);
    const fields = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\npt\r\n`
    );
    const upstreamBody = Buffer.concat([prefix, fields, closing, Buffer.from('\r\n')]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    let upstream;
    try {
      upstream = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.GROQ_API_KEY,
          'Content-Type': contentType,
          'Content-Length': String(upstreamBody.length)
        },
        body: upstreamBody,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const raw = await upstream.text();
    let data = {};
    try { data = JSON.parse(raw); } catch {}
    if (!upstream.ok) {
      console.error('Groq transcription error', upstream.status, raw.slice(0, 1000));
      const detail = data?.error?.message || data?.error || 'Falha no serviço de transcrição';
      return res.status(502).json({ error: 'Groq: ' + String(detail) });
    }
    return res.status(200).json({ text: typeof data.text === 'string' ? data.text : '' });
  } catch (e) {
    console.error('Transcription handler error:', e);
    return res.status(500).json({ error: e?.name === 'AbortError' ? 'A transcrição excedeu o tempo limite' : 'Erro interno de transcrição' });
  }
}
