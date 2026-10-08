const CFG = window.CFG;
const FA = '۰۱۲۳۴۵۶۷۸۹';
const faDigits = s => String(s).replace(/\d/g, d => FA[d]);
const money = n => faDigits(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '،'));
const normDigits = s => String(s).replace(/[۰-۹]/g, c => FA.indexOf(c)).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
function say(node, text, kind) { node.className = 'msg ' + (kind || ''); node.textContent = text || ''; }
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (_) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};
function validNationalId(v) {
  if (!/^\d{10}$/.test(v) || /^(\d)\1{9}$/.test(v)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += +v[i] * (10 - i);
  const r = s % 11;
  return (r < 2 ? r : 11 - r) === +v[9];
}

// ------------------------------------------------------------------ تلگرام (مستقیم از مرورگر)
async function tg(bot, method, params, form) {
  const url = `https://api.telegram.org/bot${CFG[bot].token}/${method}`;
  let r;
  try {
    r = await fetch(url, { method: 'POST', body: form || new URLSearchParams(params || {}) });
  } catch (_) { throw new Error('ارتباط با تلگرام برقرار نشد. اینترنت یا فیلترشکن را بررسی کنید.'); }
  const d = await r.json().catch(() => ({}));
  if (!d.ok) {
    const e = new Error(r.status === 401 ? 'توکن ربات معتبر نیست.' : 'تلگرام درخواست را نپذیرفت.');
    e.status = r.status; e.desc = d.description || ''; throw e;
  }
  return d.result;
}
const urlCache = new Map();
async function fileUrl(fileId) {
  if (!urlCache.has(fileId)) {
    urlCache.set(fileId, tg('products', 'getFile', { file_id: fileId })
      .then(f => `https://api.telegram.org/file/bot${CFG.products.token}/${f.file_path}`)
      .catch(() => { urlCache.delete(fileId); return null; }));
  }
  return urlCache.get(fileId);
}

// ------------------------------------------------------------------ حافظه‌ی محلی پست‌ها
const CMD = '##ADMIN_CMD##', ABOUT = '#درباره_ما';
const DB = Object.assign({ posts: {}, hidden: [], about: '', aboutMid: null, name: '' }, store.get('kp_db', {}));
const saveDB = () => store.set('kp_db', DB);

function parsePost(text) {
  const t = normDigits(text || '');
  const idm = t.match(/#\s*(\d{4})(?!\d)/);
  const pm = t.match(/#قیمت[_\s:]*([\d,،٬.]+)/);
  const price = pm ? parseInt(pm[1].replace(/[^\d]/g, ''), 10) : null;
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const n = normDigits(line).trim();
    if (/^#برای_شناسه_کالا$/.test(n)) continue;
    if (/^#\s*\d{4}$/.test(n)) { out.push('شناسه : ' + line.trim().replace('#', '').trim().replace(/\d/g, d => FA[d])); continue; }
    if (/^#قیمت/.test(n)) continue;
    out.push(line);
  }
  const titleLine = out.map(l => l.trim()).find(l => l && !l.startsWith('شناسه'));
  return { id: idm ? idm[1] : null, price, body: out.join('\n').trim(), title: (titleLine || 'کالا').slice(0, 60) };
}
const sortedPosts = () => Object.values(DB.posts).sort((a, b) => b.date - a.date);
function findProduct(id) {
  for (const p of sortedPosts()) { const x = parsePost(p.text); if (x.id === id && x.price != null) return x; }
  return null;
}

function applyCmd(json) {
  try {
    const c = JSON.parse(json);
    if (c.action === 'delete_message' && c.key) {
      if (!DB.hidden.includes(c.key)) DB.hidden.push(c.key);
      delete DB.posts[c.key];
    } else if (c.action === 'set_name' && c.value) DB.name = String(c.value).slice(0, 40);
  } catch (_) {}
}

function processUpdate(u) {
  const post = u.channel_post || u.edited_channel_post;
  if (!post || String(post.chat.id) !== String(CFG.products.chat)) return;
  const key = post.chat.id + ':' + post.message_id;
  const raw = post.text || post.caption || '';
  if (raw.startsWith(CMD)) return applyCmd(raw.slice(CMD.length));
  if (raw.startsWith(ABOUT)) { DB.about = raw.slice(ABOUT.length).trim(); DB.aboutMid = post.message_id; return; }
  if (DB.hidden.includes(key)) return;
  const ex = DB.posts[key];
  if (ex) { if (u.edited_channel_post) ex.text = raw; return; }
  let photo = null, video = null;
  if (post.photo) photo = post.photo[post.photo.length - 1].file_id;
  if (post.video) video = post.video.file_id;
  const d = post.document;
  if (d && /^image\/(png|jpeg)$/.test(d.mime_type || '')) photo = d.file_id;
  if (d && d.mime_type === 'video/mp4') video = d.file_id;
  DB.posts[key] = { key, mid: post.message_id, text: raw, photo, video, date: post.date };
}

async function fetchUpdates() {
  const p = { limit: 100, timeout: 0, allowed_updates: JSON.stringify(['channel_post', 'edited_channel_post']) };
  try { return await tg('products', 'getUpdates', p); }
  catch (e) {
    if (e.status !== 409) throw e;
    if (/webhook/i.test(e.desc)) await tg('products', 'deleteWebhook', { drop_pending_updates: 'false' });
    else await new Promise(r => setTimeout(r, 1200));
    return tg('products', 'getUpdates', p);
  }
}
async function sync() {
  const res = await fetchUpdates();
  for (const u of res) processUpdate(u);
  const all = sortedPosts();
  for (const p of all.slice(300)) delete DB.posts[p.key];
  saveDB();
}

// ------------------------------------------------------------------ ساخت زیپ در مرورگر (بدون فشرده‌سازی)
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(), d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + (b.byteLength !== undefined ? b.byteLength : b.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
