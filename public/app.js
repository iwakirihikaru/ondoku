const $ = id => document.getElementById(id);
const state={stream:null,recorder:null,chunks:[],startedAt:0,timerId:null,audioCtx:null,analyser:null,voiceFrames:0,totalFrames:0,rafId:null};

function normalizeJapanese(s=''){return s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');}
function bigrams(s){const n=normalizeJapanese(s),out=new Set();for(let i=0;i<n.length-1;i++)out.add(n.slice(i,i+2));return out;}
function similarity(a,b){const A=bigrams(a),B=bigrams(b);if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return(2*hit)/(A.size+B.size);}
function preferredMime(){return ['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t))||'';}

async function startReading(){
  if(!$('studentNo').value.trim()){alert('出席番号を入れてください');return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){alert('このブラウザでは録音機能を利用できません。');return;}
  state.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  state.chunks=[];state.voiceFrames=0;state.totalFrames=0;
  const mime=preferredMime();state.recorder=mime?new MediaRecorder(state.stream,{mimeType:mime}):new MediaRecorder(state.stream);
  state.recorder.ondataavailable=e=>{if(e.data.size)state.chunks.push(e.data)};
  state.recorder.start(500);
  setupVoiceDetection(state.stream);
  state.startedAt=Date.now();state.timerId=setInterval(updateTimer,250);
  $('setupCard').classList.add('hidden');$('readingCard').classList.remove('hidden');$('resultCard').classList.add('hidden');
}

function setupVoiceDetection(stream){
  state.audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  const source=state.audioCtx.createMediaStreamSource(stream);state.analyser=state.audioCtx.createAnalyser();state.analyser.fftSize=512;source.connect(state.analyser);
  const data=new Uint8Array(state.analyser.fftSize);
  const loop=()=>{state.analyser.getByteTimeDomainData(data);let sum=0;for(const v of data){const x=(v-128)/128;sum+=x*x}const rms=Math.sqrt(sum/data.length);state.totalFrames++;if(rms>0.028)state.voiceFrames++;$('voiceMeter').style.width=Math.min(100,Math.round(rms*1400))+'%';$('voiceText').textContent=rms>0.028?'声をひろっています ✓':'声が小さいかもしれません';state.rafId=requestAnimationFrame(loop)};loop();
}
function updateTimer(){const sec=Math.floor((Date.now()-state.startedAt)/1000);$('timer').textContent=`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;}

async function stopReading(){
  $('stopBtn').disabled=true;clearInterval(state.timerId);cancelAnimationFrame(state.rafId);
  const durationSec=(Date.now()-state.startedAt)/1000;
  const stopped=new Promise(resolve=>state.recorder.addEventListener('stop',resolve,{once:true}));state.recorder.stop();await stopped;
  state.stream?.getTracks().forEach(t=>t.stop());if(state.audioCtx)await state.audioCtx.close();
  const mime=state.recorder.mimeType||state.chunks[0]?.type||'audio/webm';const blob=new Blob(state.chunks,{type:mime});const voiceRatio=state.totalFrames?state.voiceFrames/state.totalFrames:0;
  $('readingCard').classList.add('hidden');$('resultCard').classList.remove('hidden');$('resultTitle').textContent='判定中…';$('resultEmoji').textContent='⏳';
  try{const r=await transcribeAndCheck(blob,durationSec,voiceRatio);renderResult(r);saveLocalResult(r);}catch(e){renderResult({status:'yellow',reason:'文字起こしに失敗しました。先生に確認してください。',durationSec,voiceRatio,similarity:0,error:String(e)})}finally{state.chunks=[];$('stopBtn').disabled=false;}
}

async function transcribeAndCheck(blob,durationSec,voiceRatio){
  const targetSec=Number($('targetSec').value||90),reference=$('referenceText').value.trim();
  if(blob.size>12*1024*1024)throw new Error('音声データが大きすぎます');
  const form=new FormData();form.append('audio',blob,`reading.${blob.type.includes('mp4')?'m4a':'webm'}`);form.append('reference',reference);
  const res=await fetch('/api/transcribe',{method:'POST',body:form});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
  const transcript=data.transcript||'',sim=similarity(reference,transcript),enoughTime=durationSec>=targetSec*.8,enoughVoice=voiceRatio>=.40;
  let status='green',reason='音読できました';if(!enoughTime){status='red';reason='読む時間が短すぎます';}else if(!enoughVoice){status='yellow';reason='声を十分に確認できませんでした';}else if(sim<.28){status='yellow';reason='本文との一致が低いため要確認です';}
  return{status,reason,durationSec,voiceRatio,similarity:sim,transcript,studentNo:$('studentNo').value.trim(),createdAt:new Date().toISOString(),provider:data.provider||'gemini'};
}

function renderResult(r){const map={green:['🟢','できた！'],yellow:['🟡','先生に確認'],red:['🔴','もう一度']};const [emoji,title]=map[r.status]||map.yellow;$('resultEmoji').textContent=emoji;$('resultTitle').textContent=title;$('resultMessage').innerHTML=`<div class="${r.status==='green'?'ok':r.status==='red'?'error':''}">${escapeHtml(r.reason||'')}</div>`;$('metrics').innerHTML=`<div class="metric"><span>音読時間</span><b>${Math.round(r.durationSec||0)}秒</b></div><div class="metric"><span>発声</span><b>${Math.round((r.voiceRatio||0)*100)}%</b></div><div class="metric"><span>本文一致</span><b>${Math.round((r.similarity||0)*100)}%</b></div>`;}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function saveLocalResult(r){const k='ondoku-results-v02';const xs=JSON.parse(localStorage.getItem(k)||'[]');xs.unshift({...r,transcript:undefined});localStorage.setItem(k,JSON.stringify(xs.slice(0,200)));}
function reset(){$('setupCard').classList.remove('hidden');$('readingCard').classList.add('hidden');$('resultCard').classList.add('hidden');}
$('startBtn').addEventListener('click',()=>startReading().catch(e=>alert('マイクを開始できません: '+e.message)));$('stopBtn').addEventListener('click',stopReading);$('againBtn').addEventListener('click',reset);
