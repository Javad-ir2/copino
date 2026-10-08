const view = document.getElementById('view');
let authed = sessionStorage.getItem('kp_admin') === '1';
function show(fn) { view.replaceChildren(); fn(); }
const backBtn = () => el('button', { class: 'link', text: 'بازگشت به منو', onclick: () => show(menu) });

// ارسال دستور پنهان برای بقیه‌ی نسخه‌ها؛ پیام دستور بلافاصله پاک می‌شود تا کسی نبیندش
async function sendCmd(obj) {
  const m = await tg('products', 'sendMessage', { chat_id: CFG.products.chat, text: CMD + JSON.stringify(obj) });
  try { await tg('products', 'deleteMessage', { chat_id: CFG.products.chat, message_id: String(m.message_id) }); } catch (_) {}
}

function login() {
  const pw = el('input', { type: 'password', autocomplete: 'current-password', dir: 'ltr' });
  const msg = el('div', { class: 'msg' });
  const go = () => {
    if (pw.value === CFG.adminPassword) { authed = true; sessionStorage.setItem('kp_admin', '1'); show(menu); }
    else say(msg, 'رمز اشتباه است.', 'err');
  };
  pw.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  view.append(el('div', { class: 'card' }, el('h2', { text: 'ورود مدیر' }),
    el('label', { text: 'رمز مدیر' }), pw, msg, el('button', { class: 'primary', text: 'ورود', onclick: go })));
}

function menu() {
  view.append(el('div', { class: 'card menu' },
    el('button', { text: 'ویرایش درباره ما', onclick: () => show(aboutPage) }),
    el('button', { text: 'ارسال پیام یا عکس جدید به کانال', onclick: () => show(newPost) }),
    el('button', { text: 'مدیریت و حذف پیام‌ها', onclick: () => show(managePosts) }),
    el('button', { text: 'تغییر اسم برنامه', onclick: () => show(namePage) }),
    el('button', { text: 'مشاهده سایت', onclick: () => { location.href = 'copino.html'; } }),
    el('button', { class: 'danger', text: 'خروج', onclick: () => { authed = false; sessionStorage.removeItem('kp_admin'); show(login); } })));
}

function aboutPage() {
  const ta = el('textarea', { style: 'min-height:220px' }); ta.value = DB.about || '';
  const msg = el('div', { class: 'msg' });
  view.append(el('div', { class: 'card' }, el('h2', { text: 'ویرایش درباره ما' }), ta, msg,
    el('button', { class: 'primary', text: 'ذخیره و ارسال به کانال', onclick: async function () {
      if (!ta.value.trim()) return say(msg, 'متن خالی است.', 'err');
      this.disabled = true; say(msg, 'در حال ارسال...');
      try {
        const m = await tg('products', 'sendMessage', { chat_id: CFG.products.chat, text: ABOUT + '\n' + ta.value.trim() });
        if (DB.aboutMid) try { await tg('products', 'deleteMessage', { chat_id: CFG.products.chat, message_id: String(DB.aboutMid) }); } catch (_) {}
        DB.about = ta.value.trim(); DB.aboutMid = m.message_id; saveDB();
        say(msg, 'ذخیره شد و روی سایت اعمال می‌شود.', 'ok');
      } catch (e) { say(msg, e.message, 'err'); }
      this.disabled = false;
    } }), backBtn()));
}

function newPost() {
  const ta = el('textarea', { placeholder: 'متن پیام' });
  const file = el('input', { type: 'file', accept: 'image/png,image/jpeg' });
  const msg = el('div', { class: 'msg' });
  view.append(el('div', { class: 'card' }, el('h2', { text: 'ارسال به کانال محصولات' }), ta,
    el('label', { text: 'عکس (اختیاری)' }), file, msg,
    el('button', { class: 'primary', text: 'ارسال', onclick: async function () {
      const text = ta.value.trim(), img = file.files[0];
      if (!text && !img) return say(msg, 'متن یا عکس را وارد کنید.', 'err');
      if (img && text.length > 1000) return say(msg, 'متن زیر عکس باید کمتر از ۱۰۰۰ حرف باشد.', 'err');
      this.disabled = true; say(msg, 'در حال ارسال...');
      try {
        let m;
        if (img) {
          const f = new FormData(); f.append('chat_id', CFG.products.chat); if (text) f.append('caption', text); f.append('photo', img);
          m = await tg('products', 'sendPhoto', null, f);
        } else m = await tg('products', 'sendMessage', { chat_id: CFG.products.chat, text });
        processUpdate({ channel_post: m }); saveDB();
        ta.value = ''; file.value = ''; say(msg, 'ارسال شد و در بخش خانه نمایش داده می‌شود.', 'ok');
      } catch (e) { say(msg, e.message, 'err'); }
      this.disabled = false;
    } }), backBtn()));
}

async function managePosts() {
  const box = el('div', { class: 'card' }, el('h2', { text: 'پیام‌های بخش خانه' }));
  const msg = el('div', { class: 'msg' });
  view.append(box, msg, backBtn());
  say(msg, 'در حال دریافت...');
  try { await sync(); say(msg, ''); } catch (e) { say(msg, e.message, 'err'); }
  const posts = sortedPosts();
  if (!posts.length) box.append(el('div', { class: 'empty', text: 'پیامی نیست.' }));
  for (const p of posts) {
    const row = el('div', { class: 'post-row' }, el('pre', { text: (p.photo || p.video ? '[دارای عکس یا ویدیو]\n' : '') + (p.text || '(بدون متن)') }));
    const actions = el('div', { class: 'row' },
      el('button', { text: 'ویرایش متن', onclick: () => {
        const ta = el('textarea'); ta.value = p.text;
        row.replaceChildren(ta, el('button', { class: 'primary', text: 'ذخیره', onclick: async function () {
          const text = ta.value.trim(); if (!text) return say(msg, 'متن خالی است.', 'err');
          this.disabled = true;
          try {
            const base = { chat_id: CFG.products.chat, message_id: String(p.mid) };
            if (p.photo || p.video) await tg('products', 'editMessageCaption', { ...base, caption: text });
            else await tg('products', 'editMessageText', { ...base, text });
            DB.posts[p.key].text = text; saveDB(); say(msg, 'ویرایش شد.', 'ok'); show(managePosts);
          } catch (e) { say(msg, e.message, 'err'); this.disabled = false; }
        } }));
      } }),
      el('button', { class: 'danger', text: 'حذف', onclick: async () => {
        if (!confirm('این پیام حذف شود؟')) return;
        try {
          await sendCmd({ action: 'delete_message', key: p.key });
          let warn = '';
          try { await tg('products', 'deleteMessage', { chat_id: CFG.products.chat, message_id: String(p.mid) }); }
          catch (_) { warn = 'از سایت حذف شد ولی حذف از خود کانال انجام نشد.'; }
          applyCmd(JSON.stringify({ action: 'delete_message', key: p.key })); saveDB();
          say(msg, warn || 'حذف شد.', warn ? 'err' : 'ok'); row.remove();
        } catch (e) { say(msg, e.message, 'err'); }
      } }));
    row.append(actions); box.append(row);
  }
}

function namePage() {
  const inp = el('input', { maxlength: '40' }); inp.value = DB.name || CFG.appName;
  const msg = el('div', { class: 'msg' });
  view.append(el('div', { class: 'card' }, el('h2', { text: 'تغییر اسم برنامه' }), inp, msg,
    el('button', { class: 'primary', text: 'ذخیره', onclick: async () => {
      const v = inp.value.trim(); if (!v) return say(msg, 'اسم خالی است.', 'err');
      try { await sendCmd({ action: 'set_name', value: v }); DB.name = v; saveDB(); say(msg, 'ذخیره شد.', 'ok'); }
      catch (e) { say(msg, e.message, 'err'); }
    } }), backBtn()));
}

show(authed ? menu : login);
