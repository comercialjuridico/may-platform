const {test}=require('node:test'); const assert=require('node:assert/strict');
const {lerZip,importarConversa}=require('../backend/services/whatsappImport');
function crc32(buf) {let crc=0xffffffff;for(const byte of buf){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(files) {
 const locals=[],central=[];let offset=0;
 for(const [name,value,flags=0,attributes=0] of files){const n=Buffer.from(name),b=Buffer.isBuffer(value)?value:Buffer.from(value);const l=Buffer.alloc(30),c=Buffer.alloc(46);
 l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(flags,6);l.writeUInt32LE(crc32(b),14);l.writeUInt32LE(b.length,18);l.writeUInt32LE(b.length,22);l.writeUInt16LE(n.length,26);
 c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(flags,8);c.writeUInt32LE(crc32(b),16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(attributes>>>0,38);c.writeUInt32LE(offset,42);
 locals.push(l,n,b);central.push(c,n);offset+=l.length+n.length+b.length;}
 const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,cd,end]);
}
test('WhatsApp archive preserves text order, inserts media at references and reports failed/unsupported content',async()=>{
 const b=zip([['_chat.txt','[01/10/2026, 10:00] Ana: Olá\n[01/10/2026, 10:01] Cliente: voz.opus (arquivo anexado)\n[01/10/2026, 10:02] Ana: retorno\n[01/10/2026, 10:03] Cliente: erro.mp3\n'],['voz.opus','audio'],['erro.mp3','bad'],['foto.png',Buffer.from([137,80,78,71,13,10,26,10])],['video.mov','video']]);
 const r=await importarConversa(b,{transcrever:async(buf,n)=>{if(n==='erro.mp3')throw Error('provider details private');return 'Fala do cliente';},analisarImagem:async()=> 'Receita médica'});
 assert(r.texto.indexOf('Olá')<r.texto.indexOf('Fala do cliente')); assert(r.texto.indexOf('Fala do cliente')<r.texto.indexOf('retorno'));
 assert.equal(r.manifesto.find(m=>m.nome==='erro.mp3').status,'falhou'); assert.equal(r.manifesto.find(m=>m.nome==='video.mov').status,'ignorado'); assert(r.avisos.some(a=>a.includes('foto.png'))); assert.doesNotMatch(r.texto,/provider details/);
});
test('ZIP traversal, absolute paths, symlinks, duplicate names and encryption fail closed',async()=>{
 for(const files of [[['../outside.txt','x']],[['/absolute.txt','x']],[['link.txt','x',0,0xa0000000]],[['one/a.txt','x'],['two/a.txt','y']],[['_chat.txt','x',1]]]) await assert.rejects(lerZip(zip(files)));
 await assert.rejects(lerZip(Buffer.from('not zip')));
});
test('archive cannot call providers without exactly one chat TXT, and media count is bounded',async()=>{
 let calls=0;const deps={transcrever:async()=>{calls++;return 'text';},analisarImagem:async()=>{calls++;return 'image';}};
 await assert.rejects(importarConversa(zip([['a.txt','a'],['b.txt','b'],['audio.mp3','x']]),deps));assert.equal(calls,0);
 const r=await importarConversa(zip([['_chat.txt','conversation'],...Array.from({length:14},(_,i)=>[`audio-${i}.mp3`,'x'])]),deps);
 assert.equal(calls,12); assert.equal(r.manifesto.filter(m=>m.status==='ignorado').length,2);
});
test('entry and expansion bounds reject excessive archives; text/media truncation is explicit',async()=>{
 await assert.rejects(lerZip(zip(Array.from({length:201},(_,i)=>[`file-${i}.bin`,'x']))));
 await assert.rejects(lerZip(zip([['oversize.bin',Buffer.alloc(21*1024*1024)]])));
 const r=await importarConversa(zip([['_chat.txt','a'.repeat(51000)]]),{transcrever:()=>{throw Error()},analisarImagem:()=>{throw Error()}});
 assert(r.truncado); assert(r.texto.length<=50000); assert.match(r.texto,/TRUNCADA/);
});
module.exports={zip};
