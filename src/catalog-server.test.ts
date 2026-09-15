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
it('drops invalid git-tree paths before caching so a mixed tree can complete',async()=>{
 const store=storage();let trees=0;vi.stubGlobal('fetch',async(url:string)=>{
  if(url.includes('/git/trees/')){trees++;return new Response(JSON.stringify({sha:'b'.repeat(40),truncated:false,tree:[{type:'blob',path:'eng/json/map (1).content.json'},{type:'blob',path:'eng/json/1.content.json'}]}));}
  if(url.endsWith('metadata.json'))return new Response('',{status:404});
  if(url.includes('map'))throw Error('invalid path must not be fetched');
  return new Response(JSON.stringify([{content_id:'one',language:'eng',content:'text'}]));
 });
 const first=await sourceCatalog(identity,{} as Env,store);expect(first.complete).toBe(true);expect(first.entries.map(e=>e.contentId)).toEqual(['one']);
 const second=await sourceCatalog(identity,{} as Env,store);expect(second.complete).toBe(true);expect(trees).toBe(1);
});
it('heals a previously cached invalid tree path without refetching',async()=>{
 const store=storage();await store.putJSON(`tree/pinned-v2/BibleAquifer/FIAKeyTerms/${revision}/eng`,{revision,language:'eng',method:'git-tree',exhaustive:true,truncated:false,paths:['eng/json/map (1).content.json','eng/json/1.content.json']});
 vi.stubGlobal('fetch',async(url:string)=>{if(url.includes('/git/trees/'))throw Error('must not refetch poisoned tree');if(url.endsWith('metadata.json'))return new Response('',{status:404});if(url.includes('map'))throw Error('invalid path must not be fetched');return new Response(JSON.stringify([{content_id:'one',content:'text'}]));});
 const result=await sourceCatalog(identity,{} as Env,store);expect(result.complete).toBe(true);expect(result.entries[0]?.contentId).toBe('one');
});
