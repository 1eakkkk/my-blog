import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { onRequestGet as getPosts, onRequestDelete as deletePost, onRequestPut as editPost } from '../functions/api/posts.js';
import { onRequestGet as getComments, onRequestDelete as deleteComment, onRequestPost as createComment, onRequestPut as editComment } from '../functions/api/comments.js';
import { onRequestGet as getRecycle, onRequestPost as restore } from '../functions/api/recycle.js';
import { onRequestPost as like } from '../functions/api/like.js';
const { postMarkdown } = createRequire(import.meta.url)('../recovery-ui.js');

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY,username TEXT,nickname TEXT,role TEXT,status TEXT DEFAULT 'active',avatar_variant INTEGER,avatar_url TEXT,password TEXT);
    CREATE TABLE sessions (session_id TEXT PRIMARY KEY,user_id INTEGER,created_at INTEGER);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER,title TEXT,content TEXT,category TEXT,mood TEXT,author_name TEXT,created_at INTEGER,updated_at INTEGER,like_count INTEGER DEFAULT 0,is_pinned INTEGER DEFAULT 0,pinned_until INTEGER);
    CREATE TABLE comments (id INTEGER PRIMARY KEY,post_id INTEGER,user_id INTEGER,content TEXT,parent_id INTEGER,reply_to_uid INTEGER,created_at INTEGER,is_pinned INTEGER DEFAULT 0,like_count INTEGER DEFAULT 0);
    CREATE TABLE likes (id INTEGER PRIMARY KEY,user_id INTEGER,target_id INTEGER,target_type TEXT,created_at INTEGER);
    INSERT INTO users (id,username,role) VALUES (1,'owner','user'),(2,'friend','user'),(3,'admin','admin');
    INSERT INTO posts (id,user_id,title,content,category,created_at,updated_at,like_count) VALUES (1,1,'原帖','完整 Markdown 正文','生活',1791648000000,1791650000000,1),(2,2,'朋友帖','正文','技术',1791648000001,NULL,0);
    INSERT INTO comments(id,post_id,user_id,content,parent_id,created_at) VALUES (1,1,1,'主评论',NULL,1001),(2,1,2,'先单独删除的回复',1,1002),(3,1,2,'仍保留的回复',1,1003),(4,1,1,'另一条主评论',NULL,1004);
    INSERT INTO likes VALUES (1,2,1,'post',100),(2,1,3,'comment',200);`);
  sqlite.exec(readFileSync(new URL('../migrations/002_recycle.sql', import.meta.url), 'utf8'));
  for (const user of [1,2,3]) sqlite.prepare('INSERT INTO sessions VALUES (?,?,?)').run('user'+user,user,Date.now());
  let beforeWrite = null;
  function prepare(sql, args = []) {
    return { bind(...values) { return prepare(sql,values); },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { if (beforeWrite) { const hook=beforeWrite; beforeWrite=null; hook(sql); } const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; }
    };
  }
  const env = { DB: { prepare, async batch(statements) { sqlite.exec('BEGIN'); try { const result=[]; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; } catch(error) { sqlite.exec('ROLLBACK'); throw error; } } } };
  function context(endpoint, user=1, body, method=body === undefined ? 'GET' : 'POST') {
    return { env, request: new Request('https://test.local/api/'+endpoint,{method,headers:{Cookie:'session_id=user'+user,...(body === undefined ? {} : {'Content-Type':'application/json'})},...(body === undefined ? {} : {body:JSON.stringify(body)})}) };
  }
  const remove = (kind,id,user=1) => (kind==='post' ? deletePost : deleteComment)(context((kind==='post'?'posts':'comments')+'?id='+id,user,undefined,'DELETE'));
  const recover = (kind,id,user=1) => restore(context('recycle',user,{action:'restore',kind,id}));
  const count = name => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n;
  return { sqlite, context, remove, recover, count, beforeWrite(hook) { beforeWrite=hook; }, close:()=>sqlite.close() };
}

test('帖子回收与恢复不改变原内容、ID、时间、评论和点赞，所有读取路径隐藏回收内容', async () => {
  const f=fixture();
  try {
    const original = ['posts','comments','likes'].map(table=>JSON.stringify(f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
    assert.equal((await f.remove('post',1)).status,200);
    assert.equal(f.count('posts'),2); assert.equal(f.count('comments'),4); assert.equal(f.count('likes'),2);
    assert.equal(f.count('active_posts'),1); assert.equal(f.count('active_comments'),0);
    assert.equal(await (await getPosts(f.context('posts?id=1'))).json(),null);
    assert.deepEqual(await (await getPosts(f.context('posts?search=完整'))).json(),[]);
    assert.deepEqual((await (await getPosts(f.context('posts?user_id=1&archive=1'))).json()).days,[]);
    assert.equal((await getComments(f.context('comments?post_id=1&locate_id=3'))).status,404);
    assert.equal((await createComment(f.context('comments',1,{post_id:1,content:'不可写入'}))).status,404);
    assert.equal((await like(f.context('like',1,{target_id:3,target_type:'comment'}))).status,404);
    assert.equal((await f.recover('post',1)).status,200);
    assert.equal(f.count('active_posts'),2); assert.equal(f.count('active_comments'),4);
    assert.deepEqual(['posts','comments','likes'].map(table=>JSON.stringify(f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all())),original);
    assert.equal((await f.recover('post',1)).status,404);
  } finally { f.close(); }
});

test('恢复主评论或帖子不会复活先前单独删除的回复，父级恢复顺序受约束', async () => {
  const f=fixture();
  try {
    assert.equal((await f.remove('comment',2,2)).status,200);
    assert.equal((await f.remove('comment',1)).status,200);
    assert.equal(f.count('active_comments'),1);
    assert.equal((await f.recover('comment',2,2)).status,409);
    assert.equal((await f.recover('comment',1)).status,200);
    assert.deepEqual(f.sqlite.prepare('SELECT id FROM active_comments ORDER BY id').all().map(c=>c.id),[1,3,4]);
    assert.equal((await f.remove('post',1)).status,200);
    assert.equal((await f.recover('comment',2,2)).status,409);
    assert.equal((await f.recover('post',1)).status,200);
    assert.equal((await f.recover('comment',2,2)).status,200);
    assert.equal(f.count('active_comments'),4);
  } finally { f.close(); }
});

test('回收站只显示自己的记录，普通用户不能恢复他人的记录或撤销管理员删除', async () => {
  const f=fixture();
  try {
    assert.equal((await f.remove('post',2)).status,403);
    assert.equal((await f.remove('post',2,2)).status,200);
    assert.deepEqual((await (await getRecycle(f.context('recycle'))).json()).items,[]);
    assert.equal((await f.recover('post',2)).status,403);
    assert.equal((await f.remove('post',1,3)).status,200);
    const own=(await (await getRecycle(f.context('recycle'))).json()).items;
    assert.equal(own.length,1); assert.equal(own[0].restore_allowed,false);
    assert.equal((await f.recover('post',1)).status,403);
    assert.equal((await f.recover('post',1,3)).status,200);
    const all=(await (await getRecycle(f.context('recycle',3))).json()).items;
    assert.equal(all.length,1); assert.equal(all[0].owner_id,2);
  } finally { f.close(); }
});

test('回收内容不能编辑/置顶，重复删除无副作用，封禁及无效恢复参数被拒绝', async () => {
  const f=fixture();
  try {
    await f.remove('comment',1); await f.remove('post',1);
    assert.equal((await f.remove('post',1)).status,404);
    for(const action of ['edit','pin']) {
      const p=await editPost(f.context('posts',1,{id:1,action,title:'新标题',content:'新内容'},'PUT'));
      assert.equal((await p.json()).success,false);
      const c=await editComment(f.context('comments',1,{id:1,action,content:'新评论'},'PUT'));
      assert.equal((await c.json()).success,false);
    }
    for(const body of [{action:'restore',kind:'post',id:[]},{action:'purge',kind:'post',id:1},{action:'restore',kind:'user',id:1}]) assert.equal((await restore(f.context('recycle',1,body))).status,400);
    assert.equal((await getRecycle(f.context('recycle?page=0'))).status,400);
    f.sqlite.exec("UPDATE users SET status='banned' WHERE id=1");
    assert.equal((await f.recover('post',1)).status,403);
    assert.equal((await getRecycle(f.context('recycle'))).status,403);
  } finally { f.close(); }
});

test('并发新删除使用独立删除ID，旧恢复请求不能误撤销同毫秒的新状态', async () => {
  const f=fixture();
  try {
    await f.remove('post',1);
    const deletion=f.sqlite.prepare("SELECT * FROM content_recycle WHERE kind='post' AND target_id=1").get();
    f.beforeWrite(sql=>{ assert.match(sql,/DELETE FROM content_recycle/); f.sqlite.prepare("UPDATE content_recycle SET deletion_id='new-deletion' WHERE kind='post' AND target_id=1").run(); });
    assert.equal((await f.recover('post',1)).status,409);
    assert.equal(f.count('active_posts'),1);
    assert.equal(f.sqlite.prepare("SELECT deleted_at FROM content_recycle WHERE kind='post' AND target_id=1").get().deleted_at,deletion.deleted_at);
  } finally { f.close(); }
});

test('回收站分页覆盖更早记录，Markdown导出保留原文和准确时间', async () => {
  const f=fixture();
  try {
    for(let id=10;id<35;id++) { f.sqlite.prepare('INSERT INTO posts(id,user_id,title,content,category,created_at) VALUES (?,1,?,?,?,?)').run(id,'旧帖'+id,'正文','生活',id); await f.remove('post',id); }
    const first=await (await getRecycle(f.context('recycle'))).json();
    const second=await (await getRecycle(f.context('recycle?page=2'))).json();
    assert.equal(first.items.length,20); assert.equal(first.has_more,true); assert.equal(second.items.length,5); assert.equal(second.has_more,false);
    assert.equal(new Set([...first.items,...second.items].map(i=>i.target_id)).size,25);
    const markdown=postMarkdown({id:1,title:'标题',content:'**原文**\n![图](/api/media/image.png)',created_at:1791648000000,category:'生活'});
    assert.match(markdown,/\*\*原文\*\*/); assert.match(markdown,/!\[图\]\(\/api\/media\/image\.png\)/);
    assert.match(markdown,/发布时间/);
  } finally { f.close(); }
});

test('取消点赞读取后遇到并发回收，帖子与评论原点赞均保留，恢复后仍可正常取消', async () => {
  for(const [kind,targetId,userId] of [['post',1,2],['comment',3,1]]) {
    const f=fixture();
    try {
      const table=kind==='post'?'posts':'comments';
      f.sqlite.prepare(`UPDATE ${table} SET like_count=1 WHERE id=?`).run(targetId);
      const originalLikes=JSON.stringify(f.sqlite.prepare('SELECT * FROM likes ORDER BY id').all());
      f.beforeWrite(sql=>{
        assert.match(sql,/DELETE FROM likes/);
        f.sqlite.prepare('INSERT INTO content_recycle(kind,target_id,owner_id,deleted_by,deleted_at,deletion_id) VALUES (?,?,?,?,?,?)').run(kind,targetId,kind==='post'?1:2,3,Date.now(),'concurrent-delete');
      });
      const hidden=await like(f.context('like',userId,{target_id:targetId,target_type:kind}));
      assert.equal(hidden.status,404);
      assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM likes ORDER BY id').all()),originalLikes);
      assert.equal(f.sqlite.prepare(`SELECT like_count FROM ${table} WHERE id=?`).get(targetId).like_count,1);
      assert.equal((await f.recover(kind,targetId,3)).status,200);
      const visible=await like(f.context('like',userId,{target_id:targetId,target_type:kind}));
      assert.equal(visible.status,200);
      assert.deepEqual(await visible.json(),{success:true,action:'unliked',like_count:0});
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM likes WHERE user_id=? AND target_id=? AND target_type=?').get(userId,targetId,kind).n,0);
    } finally { f.close(); }
  }
});
