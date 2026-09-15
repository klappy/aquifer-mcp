/** Language-aware catalog assembly. All I/O is an injected, revision-bound reader. */
export const LANGUAGE_CATALOG_SCHEMA = 2;
export interface CatalogIdentity { organization:string; resourceCode:string; language:string; revision:string; }
export interface Discovery { revision:string; language:string; paths:string[]; exhaustive:boolean; method:'git-tree'|'metadata'|'probe'; truncated?:boolean; issues?:string[]; }
export type FileRead = {status:'found';path:string;revision:string;content:string|Uint8Array}|{status:'missing'|'error';code?:string};
export type ContentReader = (request:{path:string;revision:string;maxBytes:number})=>Promise<FileRead>;
export interface CatalogEntry {
 contentId:string; language:string; languageBasis:'declared'|'source-path'; title:string; content:string; mediaType:string;
 associations:unknown; contentPath:string; contentFileSha256:string; articleHtmlSha256:string; revision:string;
 articleSha256:string; aliases:Array<{id:string;metadataPath:string;metadataSha256:string;revision:string}>;
}
export interface CatalogEnvelope {
 schemaVersion:typeof LANGUAGE_CATALOG_SCHEMA; identity:CatalogIdentity; queryKey:string; discoverySha256:string;
 entries:CatalogEntry[]; discoveryComplete:boolean; scanComplete:boolean; complete:boolean;
 scannedFiles:number; expectedFiles:number|null; pendingFiles:string[]; failedFiles:Array<{path:string;code:string}>;
 conflicts:string[]; issues:string[]; nextCursor:string|null; localizationMetadataSha256?:string;
}
const bytes=(s:string|Uint8Array)=>typeof s==='string'?new TextEncoder().encode(s):new Uint8Array(s);
const hash=async(s:string|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(s))),b=>b.toString(16).padStart(2,'0')).join('');
function validateIdentity(id:CatalogIdentity){for(const s of[id.organization,id.resourceCode,id.language])if(!/^[\w.-]+$/.test(s)||s==='.'||s==='..')throw Error('Invalid catalog identity');if(!/^[a-f\d]{40}$/.test(id.revision))throw Error('Immutable revision required');}
function validPath(path:string,language:string,contentOnly=true){const parts=path.split('/');return parts[0]===language&&(!contentOnly||parts[1]==='json'&&path.endsWith('.content.json'))&&parts.every(p=>!!p&&p!=='.'&&p!=='..'&&/^[\w.-]+$/.test(p));}
export function pinnedCatalogUrl(id:CatalogIdentity,path:string):string{validateIdentity(id);if(!validPath(path,id.language,false))throw Error('Invalid pinned source path');return`https://raw.githubusercontent.com/${id.organization}/${id.resourceCode}/${id.revision}/${path}`;}
export function pinnedCatalogCacheKey(kind:'catalog'|'content'|'metadata',id:CatalogIdentity,path=''):string{validateIdentity(id);if(path&&!validPath(path,id.language,false))throw Error('Invalid cache path');return`pinned-${kind}:v${LANGUAGE_CATALOG_SCHEMA}:${id.organization}:${id.resourceCode}:${id.revision}:${id.language}:${path}`;}
const stateForCursor=(e:CatalogEnvelope)=>JSON.stringify({...e,nextCursor:null});
const encode=(o:unknown)=>btoa(Array.from(new TextEncoder().encode(JSON.stringify(o)),b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function decode(s:string):unknown{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));}catch{throw Error('Invalid catalog cursor');}}
export async function buildLanguageCatalog(input:{
 identity:CatalogIdentity;discovery:Discovery;read:ContentReader;queryKey?:string;
 maxFiles?:number;maxBytes?:number;previous?:CatalogEnvelope;cursor?:string;
 localizationMetadata?:{path:string;language:string;revision:string;content:string|Uint8Array};
}):Promise<CatalogEnvelope>{
 const id=input.identity;validateIdentity(id);const queryKey=input.queryKey??'';if(queryKey.length>512)throw Error('Query key too long');
 const d=input.discovery;if(!['git-tree','metadata','probe'].includes(d.method)||typeof d.exhaustive!=='boolean'||!Array.isArray(d.paths))throw Error('Invalid discovery provenance');if(d.revision!==id.revision||d.language!==id.language)throw Error('Discovery identity mismatch');
 if(d.method==='probe'&&d.exhaustive)throw Error('Probes cannot establish exhaustive discovery');
 if(d.paths.some(p=>!validPath(p,id.language)))throw Error('Discovery path escapes language content');
 const paths=[...new Set(d.paths)].sort();const discoverySha256=await hash(JSON.stringify({...d,paths}));
 const maxFiles=input.maxFiles??4,maxBytes=input.maxBytes??2_000_000;if(!Number.isInteger(maxFiles)||maxFiles<1||maxFiles>32||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>8_000_000)throw Error('Invalid scan limits');
 let e:CatalogEnvelope;
 if(input.previous||input.cursor){
  if(!input.previous||!input.cursor)throw Error('Continuation requires prior envelope and cursor');
  const prev=input.previous;const cursor=decode(input.cursor) as {state?:string;discovery?:string;query?:string;identity?:string;schema?:number};
  if(prev.nextCursor!==input.cursor||cursor.state!==await hash(stateForCursor(prev))||cursor.discovery!==discoverySha256||cursor.identity!==JSON.stringify(id)||cursor.query!==queryKey||cursor.schema!==LANGUAGE_CATALOG_SCHEMA)throw Error('Stale or mismatched cursor');
  if(prev.schemaVersion!==LANGUAGE_CATALOG_SCHEMA||prev.discoverySha256!==discoverySha256||JSON.stringify(prev.identity)!==JSON.stringify(id)||prev.queryKey!==queryKey)throw Error('Prior catalog mismatch');
  e=structuredClone(prev);
 }else e={schemaVersion:LANGUAGE_CATALOG_SCHEMA,identity:{...id},queryKey,discoverySha256,entries:[],discoveryComplete:d.exhaustive&&!d.truncated&&!(d.issues?.length),scanComplete:false,complete:false,scannedFiles:0,expectedFiles:d.exhaustive&&!d.truncated&&!(d.issues?.length)?paths.length:null,pendingFiles:paths,failedFiles:[],conflicts:[],issues:[...(d.issues??[]),...(d.truncated?['truncated-discovery']:[])],nextCursor:null};
 const issues=(code:string)=>{if(!e.issues.includes(code))e.issues.push(code);};
 const failed=(path:string,code:string)=>{if(!e.failedFiles.some(f=>f.path===path&&f.code===code))e.failedFiles.push({path,code});};
 let used=0,count=0;
 while(e.pendingFiles.length&&count<maxFiles&&used<maxBytes){
  const path=e.pendingFiles.shift()!;count++;e.scannedFiles++;
  let response:FileRead;try{response=await input.read({path,revision:id.revision,maxBytes:maxBytes-used});}catch{failed(path,'read-error');continue;}
  if(response.status!=='found'){failed(path,response.status==='missing'?'missing-file':'read-error');continue;}
  if(response.path!==path||response.revision!==id.revision){failed(path,'reader-identity-mismatch');continue;}
  const body=bytes(response.content);if(body.byteLength>maxBytes-used){failed(path,'byte-limit');break;}used+=body.byteLength;
  const contentFileSha256=await hash(body);let rows:unknown;try{rows=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(body));}catch{failed(path,'invalid-json');continue;}
  if(!Array.isArray(rows)){failed(path,'non-array-content');continue;}
  for(const raw of rows){
   if(!raw||typeof raw!=='object'){failed(path,'invalid-article');continue;}const row=raw as Record<string,unknown>;
   if((typeof row.content_id!=='string'&&typeof row.content_id!=='number')||!String(row.content_id)||(typeof row.content_id==='number'&&!Number.isSafeInteger(row.content_id))||typeof row.content!=='string'){failed(path,'invalid-article');continue;}
   if(row.language!==undefined&&row.language!==id.language){failed(path,'article-language-mismatch');continue;}
   const contentId=String(row.content_id);if(e.conflicts.includes(contentId))continue;
   const articleSha256=await hash(JSON.stringify(row));const existing=e.entries.find(x=>x.contentId===contentId);
   if(existing){if(existing.articleSha256!==articleSha256){e.entries=e.entries.filter(x=>x.contentId!==contentId);e.conflicts.push(contentId);failed(path,'conflicting-article-id');}continue;}
   e.entries.push({contentId,language:id.language,languageBasis:row.language===undefined?'source-path':'declared',title:typeof row.title==='string'?row.title:`Article ${contentId}`,content:row.content,mediaType:typeof row.media_type==='string'?row.media_type:'',associations:row.associations??null,contentPath:path,contentFileSha256,articleHtmlSha256:await hash(row.content),revision:id.revision,articleSha256,aliases:[]});
  }
 }
 if(input.localizationMetadata){
  const m=input.localizationMetadata;if(m.revision!==id.revision||!validPath(m.path,m.language,false))throw Error('Localization metadata identity mismatch');
  const body=bytes(m.content);if(body.byteLength>8_000_000)throw Error('Metadata limit');const metadataSha256=await hash(body);if(e.localizationMetadataSha256&&e.localizationMetadataSha256!==metadataSha256)throw Error('Localization metadata changed within revision');e.localizationMetadataSha256=metadataSha256;let metadata:unknown;
  try{metadata=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(body));}catch{throw Error('Invalid localization metadata');}
  const articleMetadata=(metadata as {article_metadata?:Record<string,{localizations?:Record<string,{content_id?:string|number}>}>})?.article_metadata;
  if(!articleMetadata||typeof articleMetadata!=='object'||Array.isArray(articleMetadata))throw Error('Invalid localization mapping');
  for(const [primaryId,value]of Object.entries(articleMetadata)){const target=value?.localizations?.[id.language]?.content_id;if(target===undefined)continue;if((typeof target!=='string'&&typeof target!=='number')||(typeof target==='number'&&!Number.isSafeInteger(target))||!String(target))throw Error('Invalid localized identity');const entry=e.entries.find(x=>x.contentId===String(target));if(entry&&primaryId!==entry.contentId&&!e.entries.some(x=>x.contentId===primaryId)&&!entry.aliases.some(a=>a.id===primaryId))entry.aliases.push({id:primaryId,metadataPath:m.path,metadataSha256,revision:id.revision});}
 }
 if(e.failedFiles.length)issues('failed-sources');if(e.conflicts.length)issues('conflicting-ids');
 e.scanComplete=e.pendingFiles.length===0&&e.failedFiles.length===0&&e.conflicts.length===0;
 e.complete=e.discoveryComplete&&e.scanComplete&&e.issues.length===0;
 e.nextCursor=e.pendingFiles.length?encode({schema:LANGUAGE_CATALOG_SCHEMA,identity:JSON.stringify(id),query:queryKey,discovery:discoverySha256,state:await hash(stateForCursor(e))}):null;
 return e;
}
/** Result paging is separate from scan continuation. Count is a lower bound until complete. */
export function languageCatalogPage(e:CatalogEnvelope,offset=0,limit=50){if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid result page');return{entries:e.entries.slice(offset,offset+limit),offset,knownEntries:e.entries.length,totalIsExact:e.complete,verifiedEmpty:e.complete&&e.entries.length===0,nextOffset:offset+limit<e.entries.length?offset+limit:null,scanCursor:e.nextCursor};}
