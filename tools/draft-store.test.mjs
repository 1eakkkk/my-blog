import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { create, markdown } = createRequire(import.meta.url)('../draft-store.js');

// Driver contract fixture: commits are serialized and staged writes roll back on failure.
// Browser QA separately exercises the real IndexedDB driver in Chromium and WebKit.
function atomicMemory() {
  const data = new Map();
  let queue = Promise.resolve();
  const driver = { data, failWrites: false, failReads: false, beforeCommit: null,
    transact(owner, change) {
      const operation = queue.then(async () => {
        if (driver.failReads) throw new Error('Read denied');
        const value = structuredClone(data.get(owner) || null);
        if (!change) return value;
        const outcome = change(value);
        assert.ok(outcome && typeof outcome.then !== 'function');
        if (outcome.data !== undefined) {
          if (driver.beforeCommit) await driver.beforeCommit();
          if (driver.failWrites) throw new Error('Commit quota exceeded');
          data.set(owner, structuredClone(outcome.data));
        }
        return structuredClone(outcome.result);
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    }
  };
  return driver;
}
const draft = (id, content = '正文') => ({ id, title: '标题', content, category: '生活', mood: '' });

test('账号隔离，不自动读取旧版无归属草稿', async () => {
  const driver = atomicMemory();
  const legacy = new Map([['draftList','[{"content":"旧私密草稿"}]']]);
  driver.getItem = () => { throw new Error('Legacy storage must not be read'); };
  await create(driver, 1).save(draft('one'));
  assert.deepEqual((await create(driver, 2).read()).items, []);
  assert.equal((await create(driver, 1).read()).items[0].content, '正文');
  assert.equal(legacy.get('draftList'),'[{"content":"旧私密草稿"}]');
  assert.throws(() => create(driver, null), { code: 'owner' });
});

test('超过旧十篇上限仍保留每一篇，刷新可恢复当前草稿', async () => {
  const driver = atomicMemory(); const store = create(driver, 1);
  for (let i = 0; i < 14; i++) await store.save(draft(String(i)));
  assert.equal((await store.read()).items.length, 14);
  assert.equal((await create(driver, 1).read()).activeId, '13');
});

test('并发保存不同草稿不会丢条目，同篇相同版本仅一笔可提交', async () => {
  const driver = atomicMemory(); const a = create(driver, 1), b = create(driver, 1);
  await Promise.all(Array.from({length:32},(_,index)=>(index % 2 ? a : b).save(draft('parallel-'+index))));
  assert.equal((await a.read()).items.length,32);
  const first = await a.save(draft('same'));
  const attempts = await Promise.allSettled(Array.from({length:12},(_,index)=>(index % 2 ? a : b).save(draft('same','页面 '+index),first.revision)));
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  const rejected = attempts.filter(result=>result.status==='rejected');
  assert.equal(rejected.length,11);assert.ok(rejected.every(result=>result.reason.code==='conflict'));
  const current = (await b.read()).items.find(item=>item.id==='same');
  assert.equal(current.revision,2);assert.equal(current.content,'页面 0');
  assert.equal((await a.read()).items.length,33);
});

test('同篇旧版本及并发删除不能覆盖新内容或复活已删除版本', async () => {
  const driver = atomicMemory(); const a = create(driver, 1), b = create(driver, 1);
  const first = await a.save(draft('one'));
  await a.save(draft('one','新正文'),first.revision);
  await assert.rejects(b.save(draft('one','旧页面'),first.revision),{code:'conflict'});
  await assert.rejects(b.remove('one',first.revision),{code:'conflict'});
  const current = (await a.read()).items[0];
  const results = await Promise.allSettled([a.remove('one',current.revision),b.save(draft('one','删除前旧页面'),current.revision)]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.code,'conflict');
  assert.deepEqual((await a.read()).items,[]);
});

test('等待事务提交才报告成功，提交失败回滚原草稿且允许之后重试', async () => {
  const driver = atomicMemory(), store = create(driver, 1);
  await store.save(draft('one')); const previous = structuredClone(driver.data.get('1'));
  let release;
  driver.beforeCommit = () => new Promise(resolve=>{release=resolve;});
  const saving = store.save(draft('one','尚未提交'),1);
  let settled = false;saving.then(()=>{settled=true;},()=>{settled=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false);assert.deepEqual(driver.data.get('1'),previous);
  driver.failWrites=true;release();
  await assert.rejects(saving,{code:'storage'});assert.deepEqual(driver.data.get('1'),previous);
  driver.beforeCommit=null;driver.failWrites=false;
  assert.equal((await store.save(draft('one','重试成功'),1)).revision,2);
  driver.failReads=true;await assert.rejects(store.read(),{code:'storage'});
});

test('损坏数据不覆盖原记录，缺失 IndexedDB 不退回无事务的存储', async () => {
  const driver = atomicMemory(), store = create(driver, 1);
  driver.data.set('1',{version:2,owner:'1',activeId:'broken',items:[{id:'broken',revision:1,title:'',content:'',savedAt:null}]});
  const previous=structuredClone(driver.data.get('1'));
  await assert.rejects(store.save(draft('new')),{code:'corrupt'});assert.deepEqual(driver.data.get('1'),previous);
  await assert.rejects(create(null,1).read(),{code:'storage'});
  await assert.rejects(create(null,1).save(draft('new')),{code:'storage'});
});

test('明确删除与编辑备份、Markdown导出保留内容', async () => {
  const store = create(atomicMemory(), 1);
  const saved = await store.save({ ...draft('edit'), postId: 42 });
  assert.equal((await store.read()).items[0].postId, 42);
  assert.equal(markdown({ title: '标题\n第二行', content: '**正文**' }), '# 标题 第二行\n\n**正文**\n');
  await store.remove('edit',saved.revision);
  assert.deepEqual((await store.read()).items, []);assert.equal((await store.read()).activeId,'');
});
