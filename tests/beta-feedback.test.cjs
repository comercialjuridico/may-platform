const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { recursosUsuario } = require('../backend/services/recursos');
const { buildSystemPrompt } = require('../backend/services/may');
const source = fs.readFileSync('frontend/js/app.js','utf8');
const agora = Date.now();

test('media access includes actual trial and paid accounts, denies expired, pending and invented plans', () => {
  const user = { plano:'free', created_at:new Date(agora - 86400000).toISOString() };
  assert.equal(recursosUsuario(user,agora).audio,true);
  for (const patch of [{ created_at:new Date(agora - 8*86400000).toISOString() }, { plano_status:'pagamento_pendente' }, { plano_status:'pagamento_falhou' }, { plano_status:'cancelado' }, { _trial_expirado:true }, { plano:'inventado' }]) assert.equal(recursosUsuario({...user,...patch},agora).audio,false);
  assert.equal(recursosUsuario({...user,plano:'mensal',plano_fim:new Date(agora+86400000).toISOString()},agora).audio,true);
  assert.equal(recursosUsuario({...user,plano:'mensal',plano_fim:new Date(agora-1).toISOString()},agora).audio,false);
});
function audioFixture({ failure=false, denied=false }={}) {
  const dom = new JSDOM('<button id="btn-audio"></button><textarea id="message-input">Rascunho</textarea>');
  let stopped = 0, handler, calls = 0, recorder;
  const requests=[],notices=[];
  class Recorder {
    static isTypeSupported(t) { return t==='audio/mp4'; }
    constructor(stream,options) { this.mimeType=options.mimeType; this.state='inactive'; recorder=this; }
    start() { this.state='recording'; }
    stop() { this.state='inactive'; handler=async()=>{ this.ondataavailable({data:new Blob(['voice'],{type:this.mimeType})}); await this.onstop(); }; }
  }
  const ctx = { document:dom.window.document, navigator:{mediaDevices:{getUserMedia:async()=>{ if (denied) throw Object.assign(Error(),{name:'NotAllowedError'}); return {getTracks:()=>[{stop:()=>stopped++}]}; }}},
    window:{addEventListener(){}}, estado:{user:{recursos:{audio:true}}}, MediaRecorder:Recorder, Blob, FormData, Event:dom.window.Event,
    setTimeout:()=>1,clearTimeout(){}, mostrarToast:m=>notices.push(m),
    api:{upload:async(url,form)=>{ calls++; requests.push({url,name:form.get('audio').name,type:form.get('audio').type,stopped}); if(failure) throw Error('offline'); return {ok:true,json:async()=>({transcricao:'Texto falado'})}; }} };
  vm.runInNewContext(source.slice(source.indexOf('function acessoMidias()'),source.indexOf('// ─── Modal de diagnóstico')),ctx);
  return {ctx,requests,notices,stopCount:()=>stopped,flush:()=>handler(),calls:()=>calls,recorder:()=>recorder};
}
test('MP4 recorder preserves format, stops microphone before network, preserves draft and prevents double start', async () => {
  const f=audioFixture(); await f.ctx.toggleGravacao(); await f.ctx.toggleGravacao();
  assert.equal(f.stopCount(),1); assert.equal(f.calls(),0);
  await f.ctx.toggleGravacao(); assert.equal(f.stopCount(),1);
  await f.flush(); assert.equal(f.requests[0].name,'gravacao.m4a'); assert.equal(f.requests[0].type,'audio/mp4'); assert(f.requests[0].stopped>=1);
  assert.equal(f.ctx.document.getElementById('message-input').value,'Rascunho\n\nTexto falado');
});
test('network failure still releases microphone and preserves draft',async()=>{
  const f=audioFixture({failure:true}); await f.ctx.toggleGravacao(); await f.ctx.toggleGravacao(); await f.flush();
  assert(f.stopCount()>=1); assert.equal(f.ctx.document.getElementById('message-input').value,'Rascunho'); assert(f.notices.includes('offline'));
});
test('microphone denial gives actionable permission message without upload',async()=>{
  const f=audioFixture({denied:true}); await f.ctx.toggleGravacao(); assert.equal(f.calls(),0); assert(f.notices.at(-1).includes('Permita o microfone'));
});
test('simulation asks area and service first, carries selected health context and no fixed labor dispute',()=>{
  const dom=new JSDOM('<div id="messages-container"></div>'); const prompts=[];
  const ctx={document:dom.window.document,estado:{user:{nicho:'Saúde',produto:'Reajuste abusivo'}},selecionarFerramenta(){},mostrarInputChat(){},enviarMensagemRapida:p=>prompts.push(p)};
  const scenarios=source.slice(source.indexOf('const CENARIOS_SIMULACAO'),source.indexOf('// ─── Inicialização'));
  const functions=source.slice(source.indexOf('function iniciarSimulacao('),source.indexOf('// ─── Utilitários'));
  const escape=source.slice(source.indexOf('function escapeHtml('),source.indexOf('// String JavaScript'));
  vm.runInNewContext(scenarios+functions+escape,ctx); ctx.iniciarSimulacao('apresentacao_inicial');
  assert.equal(prompts.length,0); const form=dom.window.document.querySelector('form');
  assert.equal(form.elements.area.value,'Saúde'); assert.equal(form.elements.servico.value,'Reajuste abusivo');
  form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  assert.equal(prompts.length,1); assert.match(prompts[0],/Saúde/); assert.match(prompts[0],/Reajuste abusivo/); assert.doesNotMatch(prompts[0],/disputa trabalhista|patrão|FGTS/);
  const system=buildSystemPrompt({nicho:'Saúde'},'simular_reuniao'); assert.match(system,/exclusivamente o potencial cliente fictício/); assert.match(system,/encerrar simulação/);
});
test('usage label identifies trial end and unlimited messages without false quota',()=>{
  const dom=new JSDOM('<span id="usage-counter"></span>');const ctx={document:dom.window.document,estado:{uso:{mensagens_usadas:56,limite:null,restantes:null,teste_ativo:true,teste_fim:new Date(agora+86400000).toISOString()}}};
  vm.runInNewContext(source.slice(source.indexOf('function atualizarContadorUso()'),source.indexOf('// ─── Selecionar ferramenta')),ctx);
  ctx.atualizarContadorUso();assert.match(dom.window.document.body.textContent,/mensagens sem limite/);assert.match(dom.window.document.body.textContent,/Teste até/);
});
test('multipart renews expired session once, preserves browser boundary and never retries provider failures',async()=>{
  const apiSource=fs.readFileSync('frontend/js/api.js','utf8'); const store=new Map([['may_access','old'],['may_refresh','refresh']]);const calls=[];
  const ctx={window:{location:{}},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},fetch:async(url,options)=>{calls.push({url,options:{...options,headers:{...options.headers}}});
    if(url.endsWith('/auth/refresh'))return new Response(JSON.stringify({accessToken:'new',refreshToken:'new-refresh'}),{status:200});
    if(calls.length===1)return new Response(JSON.stringify({code:'TOKEN_EXPIRADO'}),{status:401});
    return new Response(JSON.stringify({erro:'provider failure'}),{status:503});
  }};
  vm.runInNewContext(apiSource,ctx);const form=new FormData();form.append('audio',new Blob(['audio']),'audio.mp3');
  const res=await ctx.window.api.upload('/upload/audio',form);
  assert.equal(res.status,503);assert.equal(calls.length,3);assert.equal(calls[2].options.headers.Authorization,'Bearer new');assert.equal(calls[2].options.headers['Content-Type'],undefined);assert.equal(calls[2].options.body,form);
});
