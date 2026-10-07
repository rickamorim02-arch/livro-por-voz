import { put, list } from '@vercel/blob';

const ORIGIN = 'https://rickamorim02-arch.github.io';
const MAX_BYTES = 20 * 1024 * 1024;

function cors(req,res){
  const origin=String(req.headers.origin||'');
  if(origin===ORIGIN) res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,X-SEFAZ-ID,X-SEFAZ-CREATED,X-SEFAZ-DURATION,X-SEFAZ-SUBJECT,X-SEFAZ-LESSON,X-SEFAZ-QUESTION,X-DEVICE-CODE');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
}
function safe(v,n=160){return String(v||'').slice(0,n);}
export default async function handler(req,res){
  cors(req,res);
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method==='POST'){
    if(String(req.headers.origin||'')!==ORIGIN) return res.status(403).json({error:'Origem não permitida'});
    const device=safe(req.headers['x-device-code'],40).toUpperCase().replace(/[^A-Z0-9-]/g,'');
    const id=safe(req.headers['x-sefaz-id'],100).replace(/[^a-zA-Z0-9._-]/g,'');
    if(!device)return res.status(400).json({error:'Código do aparelho ausente'});
    if(!id) return res.status(400).json({error:'ID ausente'});
    const chunks=[]; let total=0;
    for await(const c of req){total+=c.length;if(total>MAX_BYTES)return res.status(413).json({error:'Áudio excede 20 MB'});chunks.push(c);}
    if(!total)return res.status(400).json({error:'Áudio vazio'});
    const meta={deviceCode:device,sefazId:id,created:safe(req.headers['x-sefaz-created'],40),duration:Number(req.headers['x-sefaz-duration']||0)||0,subject:safe(req.headers['x-sefaz-subject']),lesson:safe(req.headers['x-sefaz-lesson']),questionId:safe(req.headers['x-sefaz-question'],100),type:safe(req.headers['content-type'],80)||'audio/webm'};
    const audio=await put('sefaz-inbox/'+device+'/'+id+'.audio',Buffer.concat(chunks),{access:'private',addRandomSuffix:false,contentType:meta.type,allowOverwrite:true});
    await put('sefaz-inbox/'+device+'/'+id+'.json',JSON.stringify({...meta,audioUrl:audio.url}),{access:'private',addRandomSuffix:false,contentType:'application/json',allowOverwrite:true});
    return res.status(201).json({ok:true,id});
  }
  if(req.method==='GET'){
    const device=safe(req.query.device,40).toUpperCase().replace(/[^A-Z0-9-]/g,'');
    if(!device)return res.status(400).json({error:'Código do aparelho ausente'});
    const out=await list({prefix:'sefaz-inbox/'+device+'/',limit:100});
    const metas=out.blobs.filter(b=>b.pathname.endsWith('.json'));
    const items=[];
    for(const m of metas){
      try{
        const rr=await fetch(m.downloadUrl||m.url,{headers:{Authorization:'Bearer '+process.env.BLOB_READ_WRITE_TOKEN}});
        if(rr.ok)items.push(await rr.json());
      }catch{}
    }
    items.sort((a,b)=>String(a.created).localeCompare(String(b.created)));
    return res.status(200).json({items});
  }
  res.setHeader('Allow','GET,POST,OPTIONS'); return res.status(405).json({error:'Método não permitido'});
}
