import {it,expect,vi,afterEach} from 'vitest';
import {sourceCatalog} from './catalog-server.js';
import type {AquiferStorage} from './storage.js';
import type {Env} from './types.js';
const revision='a'.repeat(40),identity={organization:'BibleAquifer',resourceCode:'FIAKeyTerms',language:'eng',revision};
function storage(){const data=new Map();return {getJSON:async(key:string)=>({data:data.get(key)??null}),putJSON:async(key:string,value:unknown)=>{data.set(key,structuredClone(value));return true;}} as unknown as AquiferStorage;}
afterEach(()=>vi.unstubAllGlobals());
it('binds original pinned JSON bytes and discovers embedded dictionary audio without fetching assets',async()=>{
 const raw=' \n'+JSON.stringify([{content_id:'eng-t1-v1-audio',language:'eng',title:'Abraham',media_type:'Text',content:'<a href="https://example.org/abraham.mp3">Audio</a>'}])+'\n';
 const calls:string[]=[];vi.stubGlobal('fetch',async(url:string)=>{calls.push(url);return new Response(url.includes('/git/trees/')?JSON.stringify({sha:'b'.repeat(40),truncated:false,tree:[{type:'blob',path:'eng/json/000001.content.json'}]}):raw)});
 const result=await sourceCatalog(identity,{} as Env,storage());expect(result.complete).toBe(true);expect(result.entries[0]?.media[0]?.kind).toBe('audio');expect(result.entries[0]?.contentFileSha256).toBe(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),x=>x.toString(16).padStart(2,'0')).join(''));expect(calls).toHaveLength(3);expect(calls.some(url=>url.includes(`/${revision}/eng/json/`))).toBe(true);
});
it('continues only from server-owned state and keeps actual localized IDs',async()=>{
 const store=storage();vi.stubGlobal('fetch',async(url:string)=>new Response(url.includes('/git/trees/')?JSON.stringify({sha:'b'.repeat(40),truncated:false,tree:Array.from({length:5},(_,i)=>({type:'blob',path:`spa/json/${i}.content.json`}))}):JSON.stringify([{content_id:url.split('/').at(-1),language:'spa',content:'texto'}])));
 const first=await sourceCatalog({...identity,language:'spa'},{} as Env,store);expect(first.complete).toBe(false);expect(first.entries).toHaveLength(4);const final=await sourceCatalog({...identity,language:'spa'},{} as Env,store,first.nextCursor!);expect(final.complete).toBe(true);expect(final.entries).toHaveLength(5);expect(final.entries.every(e=>!e.contentId.startsWith('eng-'))).toBe(true);await expect(sourceCatalog({...identity,language:'spa'},{} as Env,storage(),first.nextCursor!)).rejects.toThrow('snapshot unavailable');
});
it('reports failed and truncated discovery without false absence',async()=>{vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({sha:'b'.repeat(40),truncated:true,tree:[]})));const result=await sourceCatalog(identity,{} as Env,storage());expect(result.complete).toBe(false);expect(result.expectedFiles).toBeNull();});
it('binds known collection rights from pinned matching-language metadata only',async()=>{vi.stubGlobal('fetch',async(url:string)=>new Response(JSON.stringify(url.includes('/git/trees/')?{sha:'b'.repeat(40),truncated:false,tree:[{type:'blob',path:'eng/json/1.content.json'}]}:url.endsWith('metadata.json')?{resource_metadata:{language:'eng',license_info:{title:'CC BY-SA 4.0'}}}:[{content_id:'one',content:'<audio src="https://example.org/a.mp3"></audio>'}])));const result=await sourceCatalog(identity,{} as Env,storage());expect(result.entries[0]?.media[0]?.rights).toEqual({scope:'collection',statement:'{"title":"CC BY-SA 4.0"}',metadataUrl:`https://raw.githubusercontent.com/BibleAquifer/FIAKeyTerms/${revision}/eng/metadata.json`});expect(result.entries[0]?.media[0]?.assetRights).toBe('unverified');});
it('stops oversized tree bodies before parsing or fetching content',async()=>{const fetch=vi.fn(async()=>new Response(' '.repeat(8_000_001)));vi.stubGlobal('fetch',fetch);await expect(sourceCatalog(identity,{} as Env,storage())).rejects.toThrow('byte budget');expect(fetch).toHaveBeenCalledTimes(2);});
it('rejects invalid language before constructing any network request',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await expect(sourceCatalog({...identity,language:'../spa'},{} as Env,storage())).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();});
it('uses complete pinned manifest without tree calls and binds metadata hash into continuation',async()=>{
 const store=storage();const ingredients=Object.fromEntries(Array.from({length:5},(_,i)=>[`json/${i}.content.json`,{mimeType:'text/json'}]));const metadata={resource_metadata:{language:'eng'},scripture_burrito:{format:'scripture burrito',ingredients}};
 const fetch=vi.fn(async(url:string)=>url.includes('/git/trees/')?new Response('denied',{status:403}):new Response(JSON.stringify(url.endsWith('metadata.json')?metadata:[{content_id:url.split('/').at(-1),content:'text'}])));vi.stubGlobal('fetch',fetch);
 const first=await sourceCatalog(identity,{} as Env,store);expect(first.complete).toBe(false);expect(first.nextCursor).toBeTruthy();const final=await sourceCatalog(identity,{} as Env,store,first.nextCursor!);expect(final.complete).toBe(true);expect(fetch.mock.calls.some(([url])=>url.includes('/git/trees/'))).toBe(false);
 await store.putJSON(`raw/pinned-v2/BibleAquifer/FIAKeyTerms/${revision}/eng/metadata.json`,JSON.stringify({...metadata,changed:true}));await expect(sourceCatalog(identity,{} as Env,store,first.nextCursor!)).rejects.toThrow('mismatch');
});
it.each([{}, {'../escape.content.json':{}}, {'json/a.content.json':null}])('invalid or empty manifest cannot claim absence; safe403 headers only',async ingredients=>{
 vi.stubGlobal('fetch',async(url:string)=>url.endsWith('metadata.json')?new Response(JSON.stringify({resource_metadata:{language:'eng'},scripture_burrito:{format:'scripture burrito',ingredients}})):new Response('SECRET BODY',{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'123','retry-after':'unsafe text'}}));await expect(sourceCatalog(identity,{} as Env,storage())).rejects.toThrow('Source discovery failed (403) x-ratelimit-remaining=0 x-ratelimit-reset=123');
});
it('missing listed manifest file keeps coverage partial',async()=>{vi.stubGlobal('fetch',async(url:string)=>url.endsWith('metadata.json')?new Response(JSON.stringify({resource_metadata:{language:'eng'},scripture_burrito:{format:'scripture burrito',ingredients:{'json/1.content.json':{mimeType:'text/json'}}}})):new Response('',{status:404}));const result=await sourceCatalog(identity,{} as Env,storage());expect(result.complete).toBe(false);expect(result.failedFiles).toHaveLength(1);expect(result.expectedFiles).toBe(1);});
it('invalid tree path is never persisted and a later valid tree can recover',async()=>{const store=storage();let invalid=true;vi.stubGlobal('fetch',async(url:string)=>url.endsWith('metadata.json')?new Response('',{status:404}):url.includes('/git/trees/')?new Response(JSON.stringify({sha:'b'.repeat(40),truncated:false,tree:[{type:'blob',path:invalid?'eng/json/../bad.content.json':'eng/json/good.content.json'}]})):new Response('[]'));await expect(sourceCatalog(identity,{} as Env,store)).rejects.toThrow();expect((await store.getJSON(`tree/pinned-v2/BibleAquifer/FIAKeyTerms/${revision}/eng`)).data).toBeNull();invalid=false;expect((await sourceCatalog(identity,{} as Env,store)).complete).toBe(true);});

it.each([false,true])('cached=%s preserves residual deferral and next continuation eligibility',async cached=>{
 const store=storage(),paths=['eng/json/1.content.json','eng/json/2.content.json','eng/json/3.content.json','eng/json/4.content.json'];
 const sizes=[656003,583399,1702334,2],bodies=sizes.map(size=>'[]'+' '.repeat(size-2));
 const metadata={resource_metadata:{language:'eng'},scripture_burrito:{format:'scripture burrito',ingredients:Object.fromEntries(paths.map(p=>[p.slice(4),{}]))}};
 await store.putJSON(`raw/pinned-v2/BibleAquifer/FIAKeyTerms/${revision}/eng/metadata.json`,JSON.stringify(metadata));
 if(cached)for(let i=0;i<paths.length;i++)await store.putJSON(`raw/pinned-v2/BibleAquifer/FIAKeyTerms/${revision}/${paths[i]}`,bodies[i]);
 const requests:string[]=[];vi.stubGlobal('fetch',async(url:string)=>{requests.push(url);return new Response(bodies[paths.findIndex(p=>url.endsWith(p))]);});
 const first=await sourceCatalog(identity,{} as Env,store);expect(first).toMatchObject({scannedFiles:2,attemptedReads:3,attemptedBytes:2941736,acceptedBytes:1239402,failedFiles:[],pendingFiles:paths.slice(2)});
 expect(first.networkBytes).toBe(cached?0:2941736);expect(first.cacheBytes).toBe(cached?2941736:0);expect(requests.some(u=>u.endsWith(paths[3]!))).toBe(false);
 const final=await sourceCatalog(identity,{} as Env,store,first.nextCursor!);expect(final.complete).toBe(true);expect(final.scannedFiles).toBe(4);expect(final.attemptedReads).toBe(5);
});
it.each([false,true])('cached=%s whole oversized source stops before next file',async cached=>{
 const store=storage(),body=' '.repeat(2000001),key=`raw/pinned-v2/BibleAquifer/FIAKeyTerms/${revision}/eng/`;
 await store.putJSON(key+'metadata.json',JSON.stringify({resource_metadata:{language:'eng'},scripture_burrito:{format:'scripture burrito',ingredients:{'json/1.content.json':{},'json/2.content.json':{}}}}));
 if(cached)await store.putJSON(key+'json/1.content.json',body);
 const fetch=vi.fn(async()=>new Response(body));vi.stubGlobal('fetch',fetch);
 const result=await sourceCatalog(identity,{} as Env,store);expect(result.failedFiles).toEqual([{path:'eng/json/1.content.json',code:'oversized-file'}]);expect(result.pendingFiles).toEqual(['eng/json/2.content.json']);expect(result.attemptedBytes).toBe(2000001);expect(fetch).toHaveBeenCalledTimes(cached?0:1);
});
it('counts the discarded delivered chunk, immediately cancels, and performs no further fetch',async()=>{
 const store=storage(),key=`raw/pinned-v2/BibleAquifer/FIAKeyTerms/${revision}/eng/`;
 await store.putJSON(key+'metadata.json',JSON.stringify({resource_metadata:{language:'eng'},scripture_burrito:{format:'scripture burrito',ingredients:{'json/1.content.json':{},'json/2.content.json':{}}}}));
 let pulls=0,cancelled=false;
 const stream=new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(new Uint8Array(1100000));},cancel(){cancelled=true;}},{highWaterMark:0});
 const fetch=vi.fn(async()=>new Response(stream));vi.stubGlobal('fetch',fetch);
 const result=await sourceCatalog(identity,{} as Env,store);expect(pulls).toBe(2);expect(cancelled).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);expect(result.networkBytes).toBe(2200000);expect(result.acceptedBytes).toBe(0);expect(result.failedFiles[0]?.code).toBe('oversized-file');
});
it('preserves bytes already read when a stream genuinely fails',async()=>{
 const store=storage(),key=`raw/pinned-v2/BibleAquifer/FIAKeyTerms/${revision}/eng/`;
 await store.putJSON(key+'metadata.json',JSON.stringify({resource_metadata:{language:'eng'},scripture_burrito:{format:'scripture burrito',ingredients:{'json/1.content.json':{}}}}));let pulls=0;
 vi.stubGlobal('fetch',async()=>new Response(new ReadableStream<Uint8Array>({pull(c){if(pulls++===0)c.enqueue(new Uint8Array(120));else c.error(Error('private transport detail'));}},{highWaterMark:0})));
 const result=await sourceCatalog(identity,{} as Env,store);expect(result).toMatchObject({networkBytes:120,attemptedBytes:120,acceptedBytes:0,scannedFiles:1});expect(result.failedFiles).toEqual([{path:'eng/json/1.content.json',code:'read-error'}]);expect(JSON.stringify(result)).not.toContain('private transport');
});
