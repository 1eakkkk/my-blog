import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequestPost } from '../functions/api/posts.js';

test('新帖成功返回实际插入编号，发布期间的新输入可继续编辑同一帖子', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,nickname TEXT,role TEXT,status TEXT,ban_expires_at INTEGER);
    CREATE TABLE sessions(session_id TEXT PRIMARY KEY,user_id INTEGER,created_at INTEGER);
    CREATE TABLE posts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,author_name TEXT,title TEXT,content TEXT,category TEXT,mood TEXT,created_at INTEGER);
    INSERT INTO users VALUES(1,'author','作者','user','active',0);`);
  sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run('test-session',1,Date.now());
  const DB={prepare(sql){return{bind(...args){return{
    first:async()=>sqlite.prepare(sql).get(...args),
    run:async()=>{const result=sqlite.prepare(sql).run(...args);return{meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}
  };}};}};
  try {
    const responses=await Promise.all(['第一篇','第二篇'].map(title=>onRequestPost({env:{DB},request:new Request('https://test.local/api/posts',{
      method:'POST',headers:{Cookie:'session_id=test-session','Content-Type':'application/json'},body:JSON.stringify({title,content:'发布时的正文',category:'生活'})
    })})));
    const results=await Promise.all(responses.map(response=>response.json()));
    assert.deepEqual(results.map(result=>result.id).sort(),[1,2]);
    for(const[index,result]of results.entries()){
      assert.equal(result.success,true);
      assert.equal(sqlite.prepare('SELECT title FROM posts WHERE id=?').get(result.id).title,['第一篇','第二篇'][index]);
    }
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM posts').get().n,2);
  }finally{sqlite.close();}
});
