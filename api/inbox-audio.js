import { list } from '@vercel/blob';
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).end();}
  const id=String(req.query.id||'').replace(/[^a-zA-Z0-9._-]/g,'');
  if(!id)return res.status(400).json({error:'ID ausente'});
  const found=await list({prefix:'sefaz-inbox/'+id+'.audio',limit:1});
  const b=found.blobs[0]; if(!b)return res.status(404).json({error:'Áudio não encontrado'});
  const r=await fetch(b.downloadUrl||b.url,{headers:{Authorization:'Bearer '+process.env.BLOB_READ_WRITE_TOKEN}});
  if(!r.ok)return res.status(502).json({error:'Falha ao ler áudio'});
  res.setHeader('Content-Type',r.headers.get('content-type')||'audio/webm');
  const buf=Buffer.from(await r.arrayBuffer()); return res.status(200).send(buf);
}