import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getPosts } from '../functions/api/posts.js';
import { literalSearch, searchExcerpt } from '../functions/api/_search.js';
const utils = createRequire(import.meta.url)('../blog-utils.js');

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,nickname TEXT,avatar_variant INTEGER,avatar_url TEXT,role TEXT);
    CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,title TEXT,content TEXT,category TEXT,created_at INTEGER,like_count INTEGER DEFAULT 0,is_pinned INTEGER DEFAULT 0,pinned_until INTEGER);
    CREATE TABLE comments(id INTEGER PRIMARY KEY,post_id INTEGER,user_id INTEGER,content TEXT,parent_id INTEGER,created_at INTEGER);
    CREATE TABLE likes(target_id INTEGER,target_type TEXT,user_id INTEGER);
    INSERT INTO users VALUES (1,'owner','作者',0,'','user'),(2,'friend','朋友 <img>',0,'','user');`);
  sqlite.exec(readFileSync(new URL('../migrations/002_recycle.sql', import.meta.url), 'utf8'));
  const now = Date.parse('2026-10-11T08:00:00+08:00');
  const add = (id, title, content = '普通正文', category = '生活') => sqlite.prepare('INSERT INTO posts(id,user_id,title,content,category,created_at) VALUES (?,1,?,?,?,?)').run(id,title,content,category,now);
  const comment = (id, postId, content) => sqlite.prepare('INSERT INTO comments VALUES (?,?,2,?,NULL,?)').run(id,postId,content,now);
  function prepare(sql, values = []) { return { bind(...args) { assert.ok(args.length <= 100); return prepare(sql,args); }, first:async()=>sqlite.prepare(sql).get(...values),all:async()=>({results:sqlite.prepare(sql).all(...values)}) }; }
  const get = async query => { const res=await getPosts({request:new Request('https://test.local/api/posts?'+query),env:{DB:{prepare}}}); assert.equal(res.status,200); return res.json(); };
  return {sqlite,add,comment,get,close:()=>sqlite.close()};
}

test('正文后段和评论命中返回附近摘录，区分来源并保留直接定位编号', async () => {
  const f=fixture();
  try {
    f.add(1,'正文命中','开头'.repeat(500)+' 关键词在这里 '+'结尾'.repeat(500));
    f.add(2,'只有评论命中'); f.comment(3,2,'讨论里的关键词，有自己的上下文。');
    f.comment(4,2,'较新的关键词回复。');
    const results=await f.get('search=关键词');
    const body=results.find(p=>p.id===1), comment=results.find(p=>p.id===2);
    assert.equal(body.content.length,600); assert.doesNotMatch(body.content,/关键词/);
    assert.equal(body.search_matches[0].source,'body'); assert.match(body.search_matches[0].excerpt,/关键词在这里/);
    assert.ok(body.search_matches[0].excerpt.length<200); assert.match(body.search_matches[0].excerpt,/^…/);
    assert.deepEqual(comment.search_matches.map(m=>m.source),['comment']); assert.equal(comment.search_matches[0].comment_id,4);
    assert.equal(comment.search_matches[0].author,'朋友 <img>');
  } finally {f.close();}
});

test('百分号、下划线、反斜线和SQL片段按文字搜索，正文/评论/日历条件一致', async () => {
  const f=fixture();
  try {
    f.add(1,'进度100%'); f.add(2,'进度1000'); f.add(3,'普通','a_b'); f.add(4,'路径','D:\\图片');
    f.add(5,'SQL笔记',"x' OR 1=1 --"); f.comment(6,2,'评论中的 a_b');
    for (const [term,ids] of [['%',[1]],['_',[3,2]],['\\',[4]],["x' OR 1=1 --",[5]]]) {
      const query=new URLSearchParams({search:term}); const rows=await f.get(query);
      assert.deepEqual(rows.map(p=>p.id),ids,term);
      const dates=await f.get(query+'&archive=1'); assert.equal(dates.days[0].count,ids.length);
    }
    assert.equal(literalSearch('%_\\'),'%\\%\\_\\\\%');
  } finally {f.close();}
});

test('回收内容不参与搜索或摘录，恢复后出现；最大页遵守D1绑定上限', async () => {
  const f=fixture();
  try {
    for(let id=1;id<=100;id++){f.add(id,'帖子'+id);f.comment(id,id,'测试关键词');}
    let rows=await f.get('search=关键词&limit=100'); assert.equal(rows.length,100); assert.ok(rows.every(p=>p.search_matches.length===1));
    f.sqlite.exec("INSERT INTO content_recycle VALUES ('comment',1,2,2,1,'delete-one')");
    rows=await f.get('search=关键词&limit=100'); assert.equal(rows.length,99); assert.ok(rows.every(p=>p.id!==1));
    f.sqlite.exec("DELETE FROM content_recycle WHERE target_id=1"); rows=await f.get('search=关键词&limit=100'); assert.equal(rows.length,100);
  } finally {f.close();}
});

test('高亮对搜索词和全部摘录转义，正则特殊字符不改变含义', () => {
  assert.equal(utils.highlightText('<img onerror="x"> & 关键词','关键词'),'&lt;img onerror=&quot;x&quot;&gt; &amp; <mark>关键词</mark>');
  assert.equal(utils.highlightText('a+b aab','a+b'),'<mark>a+b</mark> aab');
  assert.equal(utils.highlightText('MARKdown markdown','markdown'),'<mark>MARKdown</mark> <mark>markdown</mark>');
  assert.equal(utils.highlightText("<script>'</script>","<script>"),'<mark>&lt;script&gt;</mark>&#39;&lt;/script&gt;');
  assert.equal(utils.highlightText('$1\\.*[]','\\.*[]'),'$1<mark>\\.*[]</mark>');
  assert.equal(utils.highlightText('text',''), 'text');
  assert.match(searchExcerpt('![标题](https://img.test/keyword.png)','keyword'),/keyword/);
});

test('首页筛选URL可往返，编码中文及特殊字符并规范化无效参数', () => {
  const filters={search:'回忆 & 100% #1',category:'生活',sort:'comments',date:'2026-10-11'};
  const route=utils.homeRoute(filters); assert.deepEqual(utils.homeFilters(route),filters);
  assert.equal(utils.homeRoute(utils.homeFilters('#home')),'#home');
  const invalid=utils.homeFilters('#home?category=bad&sort=bad&date=2026-02-30&search='+encodeURIComponent('x'.repeat(300)));
  assert.equal(invalid.category,''); assert.equal(invalid.sort,'latest'); assert.equal(invalid.date,''); assert.equal(invalid.search.length,200);
});
