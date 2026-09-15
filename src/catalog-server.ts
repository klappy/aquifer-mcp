import { buildLanguageCatalog, pinnedCatalogUrl, type CatalogEnvelope, type CatalogIdentity, type Discovery } from './language-catalog.js';
import { extractMediaReferences, type CollectionRights } from './media.js';
import type { AquiferStorage } from './storage.js';
import type { Env } from './types.js';
// Continuations reference immutable server-owned snapshots, never client-supplied state.
async function boundedText(response:Response,limit:number){
 const reader=response.body?.getReader();if(!reader)throw Error('Source body missing');let size=0;const chunks:Uint8Array[]=[];
 for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw Error('Source response exceeds byte budget');}chunks.push(part.value);}
 const all=new Uint8Array(size);let offset=0;for(const part of chunks){all.set(part,offset);offset+=part.length;}return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(all);
}
export async function sourceCatalog(identity:CatalogIdentity, env:Env, storage:AquiferStorage, cursor?:string){
 pinnedCatalogUrl(identity,`${identity.language}/metadata.json`);
 const headers:Record<string,string>={'User-Agent':'aquifer-mcp','Accept':'application/vnd.github+json'};
 if(env.GITHUB_TOKEN)headers.Authorization=`Bearer ${env.GITHUB_TOKEN}`;
 let rights:CollectionRights|undefined;
 let metadataText:string|null=null;
 const metadataPath=`${identity.language}/metadata.json`,metadataKey=`raw/pinned-v2/${identity.organization}/${identity.resourceCode}/${identity.revision}/${metadataPath}`;
 try{metadataText=(await storage.getJSON<string>(metadataKey)).data;if(metadataText===null){const response=await fetch(pinnedCatalogUrl(identity,metadataPath),{headers:{'User-Agent':'aquifer-mcp'}});if(response.ok){metadataText=await boundedText(response,2_000_000);await storage.putJSON(metadataKey,metadataText);}}
 if(metadataText){const metadata=JSON.parse(metadataText);const rm=metadata.resource_metadata;if(rm?.language===identity.language&&rm.license_info)rights={scope:'collection',statement:JSON.stringify(rm.license_info),metadataUrl:pinnedCatalogUrl(identity,metadataPath)};}
 }catch{/* Optional collection rights remain unknown; never infer asset rights. */}
 let discovery:Discovery|undefined;
 if(metadataText){try{
  const metadata=JSON.parse(metadataText),ingredients=metadata.scripture_burrito?.ingredients;
  if(metadata.resource_metadata?.language===identity.language&&['scripture burrito','scripture_burrito'].includes(metadata.scripture_burrito?.format)&&ingredients&&typeof ingredients==='object'&&!Array.isArray(ingredients)){
   const paths:string[]=[];for(const [path,info] of Object.entries(ingredients)){
    // Validate every manifest path, including non-content entries; never silently drop escapes.
    pinnedCatalogUrl(identity,`${identity.language}/${path}`);
    if(!info||typeof info!=='object'||Array.isArray(info))throw Error('Invalid ingredient');
    if(path.startsWith('json/')&&path.endsWith('.content.json'))paths.push(`${identity.language}/${path}`);
   }
   if(paths.length){const metadataSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(metadataText))),b=>b.toString(16).padStart(2,'0')).join('');
    discovery={revision:identity.revision,language:identity.language,method:'metadata',exhaustive:true,paths,metadataSha256} as Discovery;
   }
  }
 }catch{/* Invalid or empty metadata never establishes absence; use independently authoritative tree. */}}
 const treeKey=`tree/pinned-v2/${identity.organization}/${identity.resourceCode}/${identity.revision}`;
 if(!discovery){const cached=(await storage.getJSON<Discovery>(treeKey+'/'+identity.language)).data;
  if(cached){try{for(const path of cached.paths)pinnedCatalogUrl(identity,path);discovery=cached;}catch{/* Ignore historical invalid snapshots; do not reuse poisoned discovery. */}}
 }
 if(!discovery){
  const response=await fetch(`https://api.github.com/repos/${identity.organization}/${identity.resourceCode}/git/trees/${identity.revision}?recursive=1`,{headers});
  if(!response.ok){const diagnostics=['x-ratelimit-remaining','x-ratelimit-reset','retry-after'].flatMap(name=>{const value=response.headers.get(name);return value&&/^[0-9]{1,16}$/.test(value)?[`${name}=${value}`]:[];});throw Error(`Source discovery failed (${response.status})${diagnostics.length?' '+diagnostics.join(' '):''}`);}
  const tree=JSON.parse(await boundedText(response,8_000_000)) as {sha:string;truncated:boolean;tree:Array<{path:string;type:string}>};
  if(!/^[a-f0-9]{40}$/.test(tree.sha)||!Array.isArray(tree.tree)||typeof tree.truncated!=='boolean')throw Error('Invalid tree response');
  discovery={revision:identity.revision,language:identity.language,method:'git-tree',exhaustive:!tree.truncated,truncated:tree.truncated,paths:tree.tree.filter(x=>x.type==='blob'&&x.path.startsWith(`${identity.language}/json/`)&&x.path.endsWith('.content.json')).map(x=>x.path)};
  // Reject every selected content path before persisting discovery.
  for(const path of discovery.paths)pinnedCatalogUrl(identity,path);
  await storage.putJSON(treeKey+'/'+identity.language,discovery);
 }
 let previous:CatalogEnvelope|undefined;
 if(cursor){if(cursor.length>4096||!/^[\w-]+$/.test(cursor))throw Error('Invalid scan cursor');const saved=await storage.getJSON<CatalogEnvelope>(`catalog-state/v2/${cursor}`);if(!saved.data)throw Error('Scan snapshot unavailable; restart without cursor');previous=saved.data;}
 const envelope=await buildLanguageCatalog({identity,discovery,previous,cursor,read:async({path,revision,maxBytes})=>{
  const key=`raw/pinned-v2/${identity.organization}/${identity.resourceCode}/${revision}/${path}`;
  const cached=await storage.getJSON<string>(key);let content=cached.data;
  if(content===null){const r=await fetch(pinnedCatalogUrl(identity,path),{headers:{'User-Agent':'aquifer-mcp'}});if(!r.ok)return{status:r.status===404?'missing':'error',code:`HTTP-${r.status}`};
   const reader=r.body?.getReader();if(!reader)return{status:'error',code:'empty-body'};const chunks:Uint8Array[]=[];let size=0;for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes){await reader.cancel();return{status:'error',code:'byte-budget'};}chunks.push(part.value);}const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(all);await storage.putJSON(key,content);}
  return{status:'found',path,revision,content};
 }});
 if(envelope.nextCursor)await storage.putJSON(`catalog-state/v2/${envelope.nextCursor}`,envelope);
 const entries=await Promise.all(envelope.entries.map(async entry=>({...entry,...await extractMediaReferences({html:entry.content,rights,source:{...identity,contentId:entry.contentId,contentPath:entry.contentPath,contentFileSha256:entry.contentFileSha256,articleHtmlSha256:entry.articleHtmlSha256}})})));
 return {...envelope,entries};
}
