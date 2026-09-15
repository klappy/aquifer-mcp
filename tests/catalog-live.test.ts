import {it,expect,vi} from 'vitest';
import {writeFileSync} from 'node:fs';
import {handleBrowse,handleGet} from '../src/tools.js';
import type {Env} from '../src/types.js';
import type {AquiferStorage} from '../src/storage.js';
vi.mock('../src/registry.js',async(importOriginal)=>({...await importOriginal<object>(),getOrBuildIndex:async()=>({registry:[{resource_code:'FIAKeyTerms',language:'eng',title:'FIA Key Terms',order:'alphabetical'}],repo_shas:new Map([['FIAKeyTerms','de6c69e6e5b1056914cf2e9e93784d513515c02a']])})}));
it.runIf(process.env.AQUIFER_LIVE_PROOF==='1')('reads actual pinned JSON through browse/get without asset fetch',async()=>{
 const values=new Map();const storage={getJSON:async(k:string)=>({data:values.get(k)??null}),putJSON:async(k:string,v:unknown)=>{values.set(k,v);return true;}} as unknown as AquiferStorage;
 const env={AQUIFER_ORG:'BibleAquifer'} as Env;
 const browse=await handleBrowse({resource_code:'FIAKeyTerms',language:'eng',modality:'audio'},env,storage);expect('structuredContent' in browse).toBe(true);
 const result=browse as any;const beyond=await handleBrowse({resource_code:'FIAKeyTerms',language:'eng',page:9999},env,storage) as any;expect(beyond.structuredContent.complete).toBe(false);expect(beyond.structuredContent.nextCursor).toBeTruthy();
 expect(result.structuredContent.entries.some((a:any)=>a.contentId==='eng-t1-v1-audio')).toBe(true);
 const get=await handleGet({resource_code:'FIAKeyTerms',language:'eng',content_id:'eng-t1-v1-audio',include_media:true},env,storage) as any;
 expect(get.structuredContent.article.media[0].kind).toBe('audio');expect(get.content[0].text).toContain('Abraham');expect(get.content[0].text).toContain('FIA');
 writeFileSync('evidence/aquifer-media-integration/pinned-live-readback.json',JSON.stringify({observed:new Date().toISOString(),browse:{complete:result.structuredContent.complete,scannedFiles:result.structuredContent.scannedFiles,expectedFiles:result.structuredContent.expectedFiles,entries:result.structuredContent.entries.filter((entry:any)=>entry.contentId==='eng-t1-v1-audio')},get:{...get.structuredContent,article:{...get.structuredContent.article,content:undefined}}},null,2));
},30000);
