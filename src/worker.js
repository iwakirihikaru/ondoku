const GOOGLE_API='https://generativelanguage.googleapis.com';

export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if(url.pathname==='/api/health') return json({ok:true,provider:'gemini-3.5-transcribe'});
    if(url.pathname==='/api/transcribe' && request.method==='POST') return handleTranscribe(request,env);
    return env.ASSETS.fetch(request);
  }
};

async function handleTranscribe(request,env){
  if(!env.GEMINI_API_KEY) return json({error:'GEMINI_API_KEY が未設定です'},500);
  let form;try{form=await request.formData()}catch{return json({error:'multipart/form-data が必要です'},400)}
  const audio=form.get('audio');const reference=String(form.get('reference')||'').slice(0,12000);
  if(!(audio instanceof File)) return json({error:'audio がありません'},400);
  if(audio.size===0||audio.size>12*1024*1024) return json({error:'音声サイズが不正です'},413);
  const mime=(audio.type||'audio/webm').split(';')[0];
  let uploaded=null;
  try{
    uploaded=await uploadGeminiFile(audio,mime,env.GEMINI_API_KEY);
    const transcript=await transcribeGemini(uploaded.uri,mime,reference,env.GEMINI_API_KEY);
    return json({transcript,provider:'gemini-3.5-transcribe'});
  }catch(e){
    console.error(e);return json({error:safeError(e)},502);
  }finally{
    if(uploaded?.name){try{await deleteGeminiFile(uploaded.name,env.GEMINI_API_KEY)}catch(e){console.error('Gemini temp file delete failed',e)}}
  }
}

async function uploadGeminiFile(file,mime,key){
  const start=await fetch(`${GOOGLE_API}/upload/v1beta/files`,{
    method:'POST',
    headers:{'x-goog-api-key':key,'X-Goog-Upload-Protocol':'resumable','X-Goog-Upload-Command':'start','X-Goog-Upload-Header-Content-Length':String(file.size),'X-Goog-Upload-Header-Content-Type':mime,'Content-Type':'application/json'},
    body:JSON.stringify({file:{display_name:'ondoku-temp'}})
  });
  if(!start.ok) throw new Error(`Gemini upload start ${start.status}: ${await start.text()}`);
  const uploadUrl=start.headers.get('x-goog-upload-url');if(!uploadUrl) throw new Error('Gemini upload URLが取得できません');
  const finish=await fetch(uploadUrl,{method:'POST',headers:{'Content-Length':String(file.size),'X-Goog-Upload-Offset':'0','X-Goog-Upload-Command':'upload, finalize','Content-Type':mime},body:await file.arrayBuffer()});
  if(!finish.ok) throw new Error(`Gemini upload ${finish.status}: ${await finish.text()}`);
  const info=await finish.json();if(!info?.file?.uri||!info?.file?.name) throw new Error('Gemini file metadataが不正です');return info.file;
}

async function transcribeGemini(uri,mime,reference,key){
  const vocabulary=extractVocabulary(reference);
  const body={contents:[{parts:[{fileData:{fileUri:uri,mimeType:mime}}]}],generationConfig:{audioTranscriptionConfig:{languageCodes:['ja-JP'],mode:'verbatim',...(vocabulary.length?{customVocabulary:vocabulary}:{})}}};
  const res=await fetch(`${GOOGLE_API}/v1beta/models/gemini-3.5-transcribe:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok) throw new Error(`Gemini transcribe ${res.status}: ${await res.text()}`);
  const data=await res.json();
  const text=(data?.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim();
  if(!text) throw new Error('文字起こし結果が空です');return text;
}

async function deleteGeminiFile(name,key){
  await fetch(`${GOOGLE_API}/v1beta/${name}`,{method:'DELETE',headers:{'x-goog-api-key':key}});
}

function extractVocabulary(text){
  if(!text)return[];
  const cleaned=text.normalize('NFKC').replace(/[「」『』（）()\[\]【】、。,.!?！？:：;；\n\r\t]/g,' ');
  const tokens=cleaned.split(/\s+/).map(x=>x.trim()).filter(x=>x.length>=2&&x.length<=20);
  return [...new Set(tokens)].slice(0,80);
}
function safeError(e){const s=String(e?.message||e||'unknown error');return s.replace(/AIza[\w-]+/g,'[REDACTED]').slice(0,500);}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}})}
