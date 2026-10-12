import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBackup, sha256, objectPath } from './backup-site.mjs';
import { verifyBackup } from './verify-backup.mjs';

async function fixture() {
  const directory=await mkdtemp(path.join(tmpdir(),'my-blog-backup-'));
  const backup=path.join(directory,'backup'); await mkdir(backup); await mkdir(path.join(backup,'media'));
  const sql=`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT); CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),content TEXT,created_at INTEGER); CREATE TABLE sessions(session_id TEXT,user_id INTEGER);
    INSERT INTO users VALUES(1,'owner'); INSERT INTO posts VALUES(42,1,'原始 **Markdown**',1791648000123); INSERT INTO sessions VALUES('old-cookie',1);`;
  const bytes=Buffer.from([0,255,16,32,128]);
  await writeFile(path.join(backup,'database.sql'),sql); await writeFile(path.join(backup,'media/file.bin'),bytes); await writeFile(path.join(backup,'INCOMPLETE'),'pending');
  const manifest={format:'my-blog-backup',version:1,database:{file:'database.sql',bytes:Buffer.byteLength(sql),sha256:sha256(sql)},media:{count:1,bytes:bytes.length,objects:[{key:'目录/file.png',file:'media/file.bin',size:bytes.length,sha256:sha256(bytes),http_metadata:{contentType:'image/png'},custom_metadata:{owner:'fixture'}}]}};
  await writeFile(path.join(backup,'manifest.json'),JSON.stringify(manifest));
  return {directory,backup,manifest,close:()=>rm(directory,{recursive:true,force:true})};
}

test('完整备份恢复到新数据库并核对媒体字节，恢复时清除旧会话', async () => {
  const f=await fixture();
  try {
    const restore=path.join(f.directory,'restore'); const report=await verifyBackup(f.backup,restore);
    assert.equal(report.integrity_check,'ok'); assert.equal(report.media_count,1); assert.equal(report.invalidated_sessions,1);
    const db=new DatabaseSync(path.join(restore,'restored.sqlite'));
    try { assert.equal(db.prepare('SELECT created_at FROM posts WHERE id=42').get().created_at,1791648000123); assert.equal(db.prepare('SELECT content FROM posts WHERE id=42').get().content,'原始 **Markdown**'); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0); } finally { db.close(); }
    await assert.rejects(stat(path.join(f.backup,'INCOMPLETE')),error=>error.code==='ENOENT');
    assert.match(await readFile(path.join(restore,'restore.sql'),'utf8'),/DELETE FROM sessions/);
    const restoredManifest=JSON.parse(await readFile(path.join(restore,'manifest.json'),'utf8'));
    assert.equal(restoredManifest.media.objects[0].key,'目录/file.png');
    assert.equal(restoredManifest.media.objects[0].http_metadata.contentType,'image/png');
    assert.equal(restoredManifest.media.objects[0].custom_metadata.owner,'fixture');
  } finally { await f.close(); }
});

test('损坏媒体、篡改数据库、路径越界和已有恢复目录均拒绝通过，不误标完整', async () => {
  for(const failure of ['media','database','path','existing']) {
    const f=await fixture();
    try {
      const restore=path.join(f.directory,'restore');
      if(failure==='media') await writeFile(path.join(f.backup,'media/file.bin'),'corrupt');
      if(failure==='database') await writeFile(path.join(f.backup,'database.sql'),'DROP TABLE posts;');
      if(failure==='path') { f.manifest.media.objects[0].file='../secret'; await writeFile(path.join(f.backup,'manifest.json'),JSON.stringify(f.manifest)); }
      if(failure==='existing') await mkdir(restore);
      await assert.rejects(verifyBackup(f.backup,restore));
      assert.equal((await stat(path.join(f.backup,'INCOMPLETE'))).isFile(),true);
      await assert.rejects(stat(path.join(f.backup,'VERIFIED.json')),error=>error.code==='ENOENT');
    } finally { await f.close(); }
  }
});

test('R2对象路径保持字面斜杠并转义每个路径段', () => {
  assert.equal(objectPath('目录/a b#c.png'),'%E7%9B%AE%E5%BD%95/a%20b%23c.png');
});

test('导出后读取Wrangler续期凭据，弱ETag正确匹配，最终清单坏游标拒绝标为完成', async () => {
  const previousFetch=globalThis.fetch;
  const previousToken=process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_API_TOKEN;
  try {
    for(const malformedCursor of [false,true]) {
      const f=await fixture();
      try {
        const oauth=path.join(f.directory,'oauth.toml');
        const wrangler=path.join(f.directory,'wrangler-fixture.mjs');
        await writeFile(oauth,'oauth_token = "expired-fixture-token"\n');
        await writeFile(wrangler,`import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(oauth)},'oauth_token = "renewed-fixture-token"\\n'); fs.writeFileSync(process.argv[process.argv.indexOf('--output')+1],'CREATE TABLE users(id INTEGER); CREATE TABLE posts(id INTEGER);');`);
        let calls=0;
        globalThis.fetch=async(url,options)=>{
          calls++;
          assert.equal(options.headers.Authorization,'Bearer renewed-fixture-token');
          if(!String(url).includes('?'))return new Response(Buffer.from('test'),{headers:{ETag:'W/"same-etag"'}});
          return Response.json({success:true,result:[{key:'file.png',size:4,etag:'"same-etag"',http_metadata:{contentType:'image/png'}}],result_info:{is_truncated:malformedCursor&&calls===3}});
        };
        const destination=path.join(f.directory,'copied');
        const backup=createBackup({out:destination,config:'fixture.toml',account:'a'.repeat(32),database:'DB',bucket:'myblogr2','oauth-config':oauth,'wrangler-js':wrangler});
        if(malformedCursor) {
          await assert.rejects(backup,/最终核对分页游标异常/);
          assert.equal((await stat(path.join(destination,'INCOMPLETE'))).isFile(),true);
          await assert.rejects(stat(path.join(destination,'manifest.json')),error=>error.code==='ENOENT');
        } else {
          const manifest=await backup;
          assert.equal(manifest.media.count,1);
          assert.equal(manifest.media.objects[0].etag,'same-etag');
        }
      } finally { await f.close(); }
    }
  } finally {
    globalThis.fetch=previousFetch;
    if(previousToken===undefined)delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN=previousToken;
  }
});

test('D1 REST导出持续轮询同一任务，签名SQL下载不携带Cloudflare凭据', async () => {
  const f=await fixture();const previousFetch=globalThis.fetch;const previousToken=process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_API_TOKEN='api-fixture-token';
  try {
    let polls=0;let downloads=0;
    globalThis.fetch=async(url,options)=>{
      const location=new URL(url);
      if(location.hostname==='fixture.example') {
        downloads++;assert.equal(options.headers,undefined);
        return new Response('CREATE TABLE users(id INTEGER); CREATE TABLE posts(id INTEGER); CREATE TABLE sessions(session_id TEXT);');
      }
      assert.equal(options.headers.Authorization,'Bearer api-fixture-token');
      if(location.pathname.endsWith('/export')) {
        const body=JSON.parse(options.body);assert.equal(body.output_format,'polling');
        polls++;
        if(polls===1) { assert.equal(body.current_bookmark,undefined); return Response.json({success:true,result:{at_bookmark:'fixture-bookmark'}}); }
        assert.equal(body.current_bookmark,'fixture-bookmark');
        return Response.json({success:true,result:{status:'complete',result:{signed_url:'https://fixture.example/database.sql?signature=fixture'}}});
      }
      return Response.json({success:true,result:[],result_info:{is_truncated:false}});
    };
    const backup=path.join(f.directory,'api-backup');
    const manifest=await createBackup({out:backup,account:'a'.repeat(32),database:'DB',bucket:'myblogr2','database-id':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
    assert.equal(polls,2);assert.equal(downloads,1);assert.equal(manifest.media.count,0);
    assert.match(await readFile(path.join(backup,'database.sql'),'utf8'),/CREATE TABLE sessions/);
  } finally {
    globalThis.fetch=previousFetch;
    if(previousToken===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=previousToken;
    await f.close();
  }
});
