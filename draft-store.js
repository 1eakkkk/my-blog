// 草稿只存本机；IndexedDB 事务按账号读写，跨页面的版本检查和更新在同一事务完成。
(function (root) {
  class DraftError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const databaseName = 'blog-drafts-v3';
  const accountStore = 'accounts';
  let connection = null;
  let channel = null;
  const listeners = new Set();
  function broadcastChannel() {
    if (channel || !root.document || typeof root.BroadcastChannel !== 'function') return channel;
    try {
      channel = new root.BroadcastChannel(databaseName);
      channel.onmessage = event => {
        const owner = event.data?.owner;
        if (typeof owner !== 'string' || !/^[1-9]\d*$/.test(owner)) return;
        for (const listener of listeners) if (listener.owner === owner) {
          try { Promise.resolve(listener.callback()).catch(() => {}); } catch (_) { /* 已提交的草稿不受界面回调影响。 */ }
        }
      };
    } catch (_) { /* 广播不可用时，事务版本检查仍会拒绝旧版本写入。 */ }
    return channel;
  }
  function notify(owner) { try { broadcastChannel()?.postMessage({ owner }); } catch (_) {} }
  function subscribe(owner, callback) {
    if (!Number.isSafeInteger(Number(owner)) || Number(owner) <= 0 || typeof callback !== 'function') return () => {};
    const listener = { owner: String(Number(owner)), callback };
    listeners.add(listener); broadcastChannel();
    return () => listeners.delete(listener);
  }

  function openDatabase() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      let request;
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true; connection = null;
        reject(new DraftError('storage', '浏览器不允许打开本机草稿数据库'));
      };
      try { request = root.indexedDB.open(databaseName, 1); } catch (_) { fail(); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(accountStore)) request.result.createObjectStore(accountStore, { keyPath: 'owner' });
      };
      request.onerror = fail;
      request.onblocked = fail;
      request.onsuccess = () => {
        const database = request.result;
        if (settled) { database.close(); return; }
        settled = true;
        database.onversionchange = () => { database.close(); connection = null; };
        database.onclose = () => { connection = null; };
        resolve(database);
      };
    });
    // A synchronous browser denial inside the Promise executor must also reset the cached attempt.
    connection.catch(() => { connection = null; });
    return connection;
  }

  const browserDriver = {
    async transact(owner, change) {
      const database = await openDatabase();
      return new Promise((resolve, reject) => {
        let transaction;
        let failure;
        let result;
        try { transaction = database.transaction(accountStore, change ? 'readwrite' : 'readonly'); }
        catch (_) { reject(new DraftError('storage', '浏览器不允许访问本机草稿数据库')); return; }
        transaction.oncomplete = () => { if (change) notify(owner); resolve(result); };
        transaction.onabort = transaction.onerror = () => reject(failure || new DraftError('storage', '本机空间不足或浏览器禁止保存'));
        const store = transaction.objectStore(accountStore);
        const request = store.get(owner);
        request.onsuccess = () => {
          if (!change) { result = request.result || null; return; }
          try {
            // The callback is synchronous: no asynchronous gap is allowed between read, CAS and put.
            const outcome = change(request.result || null);
            if (!outcome || typeof outcome.then === 'function') throw new DraftError('storage', '草稿事务无效');
            result = outcome.result;
            if (outcome.data !== undefined) {
              if (outcome.data.owner !== owner) throw new DraftError('owner', '草稿账号不匹配');
              store.put(outcome.data);
            }
          } catch (error) { failure = error; transaction.abort(); }
        };
      });
    }
  };

  function create(driver, owner) {
    if (!Number.isSafeInteger(Number(owner)) || Number(owner) <= 0) throw new DraftError('owner', '请先登录');
    owner = String(Number(owner));
    const key = `blog:drafts:v2:${owner}`;
    driver = driver || browserDriver;
    if (typeof driver.transact !== 'function') throw new DraftError('storage', '草稿存储驱动无效');
    function envelope(value) {
      if (!value) return { version: 2, owner, activeId: '', items: [] };
      try {
        const data = value;
        if (data.version !== 2 || data.owner !== owner || typeof data.activeId !== 'string' || !Array.isArray(data.items) ||
          !data.items.every(d => typeof d.id === 'string' && d.id && Number.isSafeInteger(d.revision) && d.revision > 0 &&
            typeof d.title === 'string' && typeof d.content === 'string' && Number.isFinite(d.savedAt)) ||
          new Set(data.items.map(d => d.id)).size !== data.items.length) throw new Error();
        return { ...data, items: data.items.map(item => ({ ...item })) };
      } catch (_) { throw new DraftError('corrupt', '本机草稿数据损坏，已保留原数据'); }
    }
    async function transact(change) {
      try { return await driver.transact(owner, change); }
      catch (error) {
        if (error instanceof DraftError) throw error;
        throw new DraftError('storage', '本机空间不足或浏览器禁止保存');
      }
    }
    async function read() { return envelope(await transact()); }
    async function save(draft, expectedRevision = 0) {
      if (!draft || typeof draft.id !== 'string' || !draft.id) throw new DraftError('id', '草稿标识无效');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw new DraftError('revision', '草稿版本无效');
      return transact(value => {
        const data = envelope(value);
        const index = data.items.findIndex(d => d.id === draft.id);
        const existing = data.items[index];
        if ((existing?.revision || 0) !== expectedRevision) throw new DraftError('conflict', '此草稿在另一个页面已修改，请加载新版本或另存副本');
        const item = { id: draft.id, title: String(draft.title || ''), content: String(draft.content || ''),
          category: String(draft.category || '灌水'), mood: String(draft.mood || ''), postId: draft.postId || null,
          savedAt: Date.now(), revision: expectedRevision + 1 };
        if (index < 0) data.items.unshift(item); else data.items[index] = item;
        // 不自动删除旧草稿。容量不足时事务回滚，由界面提示导出、整理。
        data.items.sort((a, b) => b.savedAt - a.savedAt);
        data.activeId = item.id;
        return { data, result: item };
      });
    }
    async function remove(id, expectedRevision) {
      return transact(value => {
        const data = envelope(value);
        const existing = data.items.find(d => d.id === id);
        if (!existing) return { result: undefined };
        if (existing.revision !== expectedRevision) throw new DraftError('conflict', '此草稿已更新，请刷新草稿箱后再删除');
        data.items = data.items.filter(d => d.id !== id);
        if (data.activeId === id) data.activeId = '';
        return { data, result: undefined };
      });
    }
    return { key, owner, read, save, remove };
  }
  function markdown(draft) {
    return `${draft.title ? '# ' + draft.title.replace(/\r?\n/g, ' ') + '\n\n' : ''}${draft.content || ''}\n`;
  }
  const api = { create, markdown, DraftError, databaseName, subscribe };
  root.DraftStore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
