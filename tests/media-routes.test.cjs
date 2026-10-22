const {test}=require('node:test'); const assert=require('node:assert/strict');const express=require('express');
const {loadRoute,database,withApp}=require('./helpers.cjs');
const {transcreverAudio}=require('../backend/services/audioUpload');
const {recursosUsuario}=require('../backend/services/recursos');
const {execFileSync}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');

test('real OGG conversion sends MP3 and removes temporary files even on provider failure',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'may-test-'));const before=fs.readdirSync(os.tmpdir()).filter(x=>x.startsWith('may-audio-'));
 try {
  const f=path.join(dir,'sample.ogg');execFileSync(require('@ffmpeg-installer/ffmpeg').path,['-nostdin','-f','lavfi','-i','sine=frequency=440:duration=0.1','-c:a','libopus',f],{stdio:'ignore'});
  let calls=0;
  const openai={audio:{transcriptions:{create:async({file})=>{calls++;assert.equal(file.name,'audio.mp3');assert(file.size>0);throw Error('provider unavailable');}}}};
  await assert.rejects(transcreverAudio(openai,fs.readFileSync(f),'note.opus'));
  assert.equal(calls,1);assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(x=>x.startsWith('may-audio-')),before);
  await assert.rejects(transcreverAudio(openai,Buffer.from('#EXTM3U\nfile:///etc/passwd'),'fake.ogg'));assert.equal(calls,1);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
function routeFixture(user) {
 const db=database({uploads:[]});const calls=[];
 class OpenAI {constructor(){this.audio={transcriptions:{create:async a=>{calls.push(a);return 'transcrição';}}};}}
 const router=loadRoute('backend/routes/upload.js', {openai:OpenAI,'../services/supabase':{supabase:db},'../middleware/auth':{authMiddleware(req,res,next){req.user=user;next();}}});
 return {router,calls,db};
}
async function multipart(router,run) {
 const app=express();app.use(router);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
 try {await run(async(p,name,buf=Buffer.from('test audio'),mime='application/octet-stream')=>{const form=new FormData();form.append(p==='/audio'?'audio':'arquivo',new Blob([buf],{type:mime}),name);const res=await fetch(`http://127.0.0.1:${server.address().port}${p}`,{method:'POST',body:form});return {status:res.status,data:await res.json()};});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('trial audio accepts generic MIME with audio extension, rejects unsupported files and expired access before provider work',async()=>{
 const f=routeFixture({id:'audio-trial',plano:'free',created_at:new Date().toISOString()});
 await multipart(f.router,async request=>{const ok=await request('/audio','voice.m4a');assert.equal(ok.status,200);assert.equal(ok.data.transcricao,'transcrição');const bad=await request('/audio','virus.exe');assert.equal(bad.status,400);});
 assert.equal(f.calls.length,1);
 const denied=routeFixture({id:'expired',plano:'free',created_at:'2020-01-01'});
 await multipart(denied.router,async request=>assert.equal((await request('/audio','voice.mp3')).status,403));assert.equal(denied.calls.length,0);
});
test('invalid archives return JSON errors without writing uploads or calling providers',async()=>{
 const f=routeFixture({id:'zip-user',plano:'mensal'});
 await multipart(f.router,async request=>{const r=await request('/whatsapp','conversation.zip',Buffer.from('invalid zip'),'application/zip');assert.equal(r.status,400);assert.equal(typeof r.data.erro,'string');});assert.equal(f.db.tables.uploads.length,0);assert.equal(f.calls.length,0);
});
test('usage is zero for previous month and trial capabilities are exposed',async()=>{
 const user={id:'user',plano:'free',created_at:new Date().toISOString(),mensagens_mes:999,mes_referencia:'2020-01'};const db=database({streak:[]});
 const router=loadRoute('backend/routes/user.js',{'../services/supabase':{supabase:db},'../middleware/auth':{authMiddleware(req,res,next){req.user=user;next();}}});
 await withApp(router,async request=>{
  const usage=await request('/uso');assert.equal(usage.data.mensagens_usadas,0);assert.equal(usage.data.limite,null);assert.equal(usage.data.teste_ativo,true);
  const me=await request('/me');assert.equal(me.data.user.recursos.audio,true);
 });
});
