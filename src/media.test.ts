import {describe,it,expect,vi} from 'vitest';
import{extractMediaReferences,type MediaSource}from'./media.js';
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const fixture=async(html:string,changes:Partial<MediaSource>={})=>({html,source:{organization:'BibleAquifer',resourceCode:'FIAKeyTerms',contentId:'eng-t1-v1-audio',language:'eng',revision:'a'.repeat(40),contentPath:'eng/json/000001.content.json',contentFileSha256:'b'.repeat(64),articleHtmlSha256:await hash(html),...changes}});
describe('pure source-bound media references',()=>{
 it('extracts actual FIA audio anchor without invented observations or asset fetch',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch');
  const html="<h3>Audio Content</h3><p><a href='https://s3.amazonaws.com/cbbt-er.public/terms/audio/eng/t1/v1/vbr4.mp3'>mp3 file</a> (2502188 KB)</p>";
  const input=await fixture(html);const result=await extractMediaReferences({...input,rights:{scope:'collection',statement:'Word Collective ©2025 CC BY-SA 4.0',metadataUrl:'https://example.org/metadata.json'}});
  expect(result.status).toBe('complete');expect(result.media).toHaveLength(1);expect(result.media[0]).toMatchObject({kind:'audio',source:input.source,rights:{scope:'collection'},assetRights:'unverified',playable:'unverified',narrator:'unknown',bytes:null,durationSeconds:null,assetSha256:null});expect(input.html).toBe(html);expect(fetch).not.toHaveBeenCalled();fetch.mockRestore();
 });
 it('retains coexisting audio/video/source/image and first img compatibility',async()=>{
  const result=await extractMediaReferences(await fixture('<audio src="voice.mp3"><source src="voice.opus" type="audio/opus"></audio><video src="film.mp4" poster="poster.jpg"><source src="film.webm"></video><img src="map.png"><a href="notes.html">notes</a>'));
  expect(result.media.map(m=>m.kind)).toEqual(['audio','audio','video','image','video','image']);expect(result.image_url).toContain('/'+'a'.repeat(40)+'/eng/json/map.png');expect(result.media.every(m=>m.source.language==='eng')).toBe(true);
 });
 it('deduplicates equivalent relative URLs but retains original references and query decoding',async()=>{
  const r=await extractMediaReferences(await fixture('<audio src="./clip.mp3?x=1&amp;y=2"></audio><a href="clip.mp3?x=1&#38;y=2">clip</a>'));
  expect(r.media).toHaveLength(1);expect(r.media[0]!.references.map(x=>x.original)).toEqual(['./clip.mp3?x=1&amp;y=2','clip.mp3?x=1&#38;y=2']);expect(r.media[0]!.url).toContain('?x=1&y=2');
 });
 it('does not convert arbitrary links, Drive folders, comments, or script content',async()=>{
  const r=await extractMediaReferences(await fixture('<!-- <audio src="fake.mp3"> --><script>"<img src=\"fake.png\">"</script><style>audio{background:url(fake.mp3)}</style><textarea><audio src="fake.mp3"></textarea><a href="https://drive.google.com/folder/123">audio download</a><a href="help">mp3</a>'));
  expect(r.media).toEqual([]);expect(r.status).toBe('complete');
 });
 it('accepts an explicit media MIME anchor without extending to unknown downloads',async()=>{
  const r=await extractMediaReferences(await fixture('<a href="https://cdn.example.org/asset/123" type="audio/mpeg">audio</a><a href="/download/unknown">download</a>'));
  expect(r.media).toHaveLength(1);expect(r.media[0]!.url).toBe('https://cdn.example.org/asset/123');
 });
 it.each(['javascript:alert(1)','data:audio/mp3;base64,AA','file:///clip.mp3','blob:https://example.org/123','https://name:password@example.org/a.mp3','java&#x73;cript:alert(1)','https://example.org/a&#10;.mp3'])('rejects unsafe reference %s',async(url)=>{
  const r=await extractMediaReferences(await fixture(`<audio src="${url}"></audio>`));expect(r.media).toEqual([]);expect(r.status).toBe('partial');
 });
 it.each(['<audio src="missing.mp3','<!-- unfinished','<script>unfinished','<audio src="one.mp3" src="two.mp3"></audio>','<source src="orphan.mp3">'])('reports malformed or ambiguous HTML: %s',async(html)=>{
  const r=await extractMediaReferences(await fixture(html));expect(r.status).toBe('partial');expect(r.media).toEqual([]);
 });
 it('binds real source locale and rejects inconsistent path/hash/revision',async()=>{
  const input=await fixture('<audio src="clip.mp3"></audio>',{language:'spa',contentId:'spa-audio',contentPath:'spa/json/000001.content.json'});expect((await extractMediaReferences(input)).media[0]!.source.language).toBe('spa');
  await expect(extractMediaReferences({...input,html:input.html+'changed'})).rejects.toThrow('hash');
  await expect(extractMediaReferences({...input,source:{...input.source,contentPath:'eng/json/file.json'}})).rejects.toThrow('path/language');
  await expect(extractMediaReferences({...input,source:{...input.source,revision:'main'}})).rejects.toThrow('binding');
 });
 it('does not infer rights and rejects a false asset-scoped claim',async()=>{
  const input=await fixture('<img src="map.png">');expect((await extractMediaReferences(input)).media[0]!.rights).toEqual({scope:'unknown'});
  await expect(extractMediaReferences({...input,rights:{scope:'asset' as 'collection',statement:'free',metadataUrl:'https://example.org'}})).rejects.toThrow('rights');
 });
 it('keeps valid references but reports incomplete scan and explicit resource limits',async()=>{
  const input=await fixture('<img src="map.png"><audio src="unfinished');const r=await extractMediaReferences(input);expect(r.media).toHaveLength(1);expect(r.status).toBe('partial');
  const limit=await extractMediaReferences(await fixture(' '.repeat(2_000_001)));expect(limit.status).toBe('partial');expect(limit.issues).toContain('html-limit');
 });
 it('matches content-file relative image bases and preserves explicit external URLs',async()=>{
  const r=await extractMediaReferences(await fixture('<img src="images/NT001.png"><img src="../images/map.png"><audio src="clip%20one.mp3"></audio><img src="//cdn.example.org/photo.png">'));
  const root='https://raw.githubusercontent.com/BibleAquifer/FIAKeyTerms/'+'a'.repeat(40);
  expect(r.media.map(m=>m.url)).toEqual([root+'/eng/json/images/NT001.png',root+'/eng/images/map.png',root+'/eng/json/clip%20one.mp3','https://cdn.example.org/photo.png']);expect(r.image_url).toBe(root+'/eng/json/images/NT001.png');
 });
 it('does not guess ambiguous ogg modality without an explicit tag or MIME',async()=>{
  const r=await extractMediaReferences(await fixture('<a href="unknown.ogg">ogg</a><a href="sound.ogg" type="audio/ogg">sound</a><video src="film.ogg"></video>'));expect(r.media.map(m=>m.kind)).toEqual(['audio','video']);
 });
 it.each(['../../../../main/escape.mp3','%2e%2e/%2e%2e/%2e%2e/main/escape.mp3','/BibleAquifer/FIAKeyTerms/main/escape.mp3'])('rejects relative paths escaping revision: %s',async(src)=>{const r=await extractMediaReferences(await fixture(`<audio src="${src}"></audio>`));expect(r.media).toEqual([]);expect(r.issues).toContain('relative-reference-escapes-revision');});

});
