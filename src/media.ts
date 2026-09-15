/** Pure, bounded extraction of declared media references. Never fetches an asset. */
export type MediaKind = 'audio' | 'video' | 'image';
export interface MediaSource {
  organization: string; resourceCode: string; contentId: string; language: string;
  revision: string; contentPath: string; contentFileSha256: string; articleHtmlSha256: string;
}
export interface CollectionRights {
  scope: 'collection'; statement: string; metadataUrl: string;
}
export interface MediaReference {
  tag: string; attribute: string; original: string; decoded: string;
}
export interface MediaDescriptor {
  kind: MediaKind; url: string; references: MediaReference[]; source: MediaSource;
  rights: { scope: 'unknown' } | CollectionRights;
  assetRights: 'unverified'; bytes: null; durationSeconds: null; assetSha256: null;
  playable: 'unverified'; narrator: 'unknown';
}
export interface MediaExtraction {
  media: MediaDescriptor[]; image_url: string | null;
  status: 'complete' | 'partial'; issues: string[];
}
const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const safeUrl = (text: string, base: string): string | null => {
  if(!text || /[\u0000-\u0020\u007f]/u.test(text))return null;
  try{const u=new URL(text,base);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
};
function decode(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(whole,entity:string)=>{
    if(entity[0]==='#'){const hex=entity[1]?.toLowerCase()==='x';const n=Number.parseInt(entity.slice(hex?2:1),hex?16:10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'\u0000';}
    return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'} as Record<string,string>)[entity.toLowerCase()]??whole;
  });
}
function inferredKind(url:string,type:string):MediaKind|null{
  if(/^audio\//i.test(type))return'audio';if(/^video\//i.test(type))return'video';if(/^image\//i.test(type))return'image';
  const path=new URL(url).pathname.toLowerCase();
  if(/\.(mp3|m4a|aac|wav|flac|opus|oga)$/.test(path))return'audio';
  if(/\.(mp4|webm|mov|m4v|ogv)$/.test(path))return'video';
  if(/\.(png|jpe?g|gif|webp|avif|svg)$/.test(path))return'image';return null;
}
/** `complete` means the bounded supported-syntax scan completed, not complete catalog coverage. */
export async function extractMediaReferences(input:{html:string;source:MediaSource;rights?:CollectionRights}):Promise<MediaExtraction>{
 const {html,source}=input;
 for(const key of ['organization','resourceCode','language'] as const)if(!/^[\w.-]+$/.test(source[key])||source[key]==='.'||source[key]==='..')throw Error('Invalid source identity');
 if(!source.contentId||!/^[\da-f]{40}$/.test(source.revision)||!/^[\da-f]{64}$/.test(source.articleHtmlSha256)||!/^[\da-f]{64}$/.test(source.contentFileSha256))throw Error('Invalid source binding');
 const segments=source.contentPath.split('/');if(segments[0]!==source.language||segments.some(s=>!s||s==='.'||s==='..'||!/^[\w.-]+$/.test(s)))throw Error('Invalid source path/language');
 if(await sha256(html)!==source.articleHtmlSha256)throw Error('Source content hash mismatch');
 const sourceCopy={...source};const base=`https://raw.githubusercontent.com/${source.organization}/${source.resourceCode}/${source.revision}/${source.contentPath}`;
 if(input.rights&&(input.rights.scope!=='collection'||!input.rights.statement||!safeUrl(input.rights.metadataUrl,base)))throw Error('Invalid collection rights');
 const rights=input.rights?{...input.rights}:{scope:'unknown' as const};
 const result:MediaExtraction={media:[],image_url:null,status:'complete',issues:[]};
 const issue=(text:string)=>{result.status='partial';if(!result.issues.includes(text))result.issues.push(text);};
 if(html.length>2_000_000){issue('html-limit');return result;}
 const seen=new Map<string,MediaDescriptor>();let pos=0;let parent:MediaKind|null=null;
 while(pos<html.length){
  const start=html.indexOf('<',pos);if(start<0)break;
  if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);if(end<0){issue('unterminated-comment');break;}pos=end+3;continue;}
  let end=start+1,quote='';for(;end<html.length;end++){const c=html[end]!;if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
  if(end===html.length){issue('unterminated-tag');break;}pos=end+1;
  const token=html.slice(start+1,end);const match=token.match(/^(\/?)([a-z][\w:-]*)\b/i);if(!match){issue('unrecognized-markup');continue;}
  const tag=match[2]!.toLowerCase(),closing=!!match[1];
  if(closing){if(tag==='audio'||tag==='video')parent=null;continue;}
  if(['script','style','textarea','title'].includes(tag)){const close=new RegExp(`</${tag}\\s*>`,'ig');close.lastIndex=pos;const found=close.exec(html);if(!found){issue('unterminated-raw-text');break;}pos=close.lastIndex;continue;}
  if(!['audio','video','source','img','a'].includes(tag))continue;
  const attrs=new Map<string,string>();let rest=token.slice(match[0].length),bad=false;
  while(rest.trim()&&rest.trim()!=='/'){
   const a=rest.match(/^\s*([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/);
   if(!a){bad=true;break;}const key=a[1]!.toLowerCase();if(attrs.has(key)){bad=true;break;}attrs.set(key,a[2]??a[3]??a[4]??'');rest=rest.slice(a[0].length);
  }
  if(bad){issue('malformed-attributes');continue;}
  if(tag==='audio'||tag==='video')parent=tag;
  const candidates:Array<[string,MediaKind|null]> = tag==='a'?[['href',null]]:tag==='img'?[['src','image']]:tag==='source'?[['src',parent]]: [['src',tag as MediaKind],...(tag==='video'?[['poster','image'] as [string,MediaKind]]:[])];
  for(const [attribute,declared]of candidates){
   const original=attrs.get(attribute);if(original===undefined)continue;
   if(tag==='source'&&!parent){issue('orphan-source');continue;}
   const decoded=decode(original);const url=safeUrl(decoded,base);
   const relative=!/^[a-z][a-z0-9+.-]*:/i.test(decoded)&&!decoded.startsWith('//');
   const revisionRoot=`https://raw.githubusercontent.com/${source.organization}/${source.resourceCode}/${source.revision}/`;
   if(relative&&url&&!url.startsWith(revisionRoot)){issue('relative-reference-escapes-revision');continue;}
   if(!url){issue('unsafe-or-invalid-reference');continue;}
   const kind=declared??inferredKind(url,decode(attrs.get('type')??''));if(!kind)continue;
   const reference={tag,attribute,original,decoded};const key=kind+'\n'+url;
   let descriptor=seen.get(key);if(!descriptor){if(result.media.length>=1000){issue('media-limit');return result;}descriptor={kind,url,references:[],source:sourceCopy,rights,assetRights:'unverified',bytes:null,durationSeconds:null,assetSha256:null,playable:'unverified',narrator:'unknown'};seen.set(key,descriptor);result.media.push(descriptor);}
   descriptor.references.push(reference);
   if(kind==='image'&&tag==='img'&&!result.image_url)result.image_url=url;
  }
  if(/\/\s*$/.test(token)&&(tag==='audio'||tag==='video'))parent=null;
 }
 return result;
}
