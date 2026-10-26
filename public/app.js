const $ = s => document.querySelector(s);
const api = {
  get: (u) => fetch(u).then(r => r.json()),
  post: (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json()),
  put: (u, b) => fetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
  del: (u) => fetch(u, { method: 'DELETE' }).then(r => r.json()),
};

let state = { running: false, channels: [], schedule: { posts: [] }, log: [], hasToken: false };

async function refresh() {
  state = await api.get('/api/state');
  render();
}

function render() {
  // Статус
  $('#statusDot').classList.toggle('on', state.running);
  $('#statusLine').textContent = state.running
    ? `Постинг работает · каналов: ${state.channels.length} · постов: ${(state.schedule.posts || []).length}`
    : `Постинг остановлен · каналов: ${state.channels.length} · постов: ${(state.schedule.posts || []).length}`;
  $('#tokenStatus').textContent = state.hasToken ? 'Токен: ✓' : 'Токен: ✗ заполните .env';
  $('#btnStart').disabled = state.running;
  $('#btnStop').disabled = !state.running;

  // Посты
  const pl = $('#postsList');
  pl.innerHTML = '';
  const dayShort = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 7: 'Вс' };
  for (const p of (state.schedule.posts || [])) {
    const when = (p.date ? p.date + ' ' : '') + p.time + (p.days?.length ? ' · ' + p.days.map(d => dayShort[d]).join(',') : ' (ежедневно)');
    const div = document.createElement('div');
    div.className = 'post-item';
    div.innerHTML = `
      <div class="info">
        <div><span class="time">${escapeHtml(when)}</span> <b>${escapeHtml(p.id)}</b> ${p.media ? '📷' : ''} ${p.buttons?.length ? '🔘' : ''}</div>
        <div class="text">${escapeHtml(p.text || '')}</div>
        <div class="chans">${(p.channels || []).join(', ')}</div>
      </div>
      <div class="row">
        <button class="btn-sm primary" data-send-post>🚀 Отправить</button>
        <button class="btn-sm" data-edit-post>✏️</button>
        <button class="btn-sm danger" data-del-post>🗑</button>
      </div>`;
    div.querySelector('[data-send-post]').onclick = () => openSendModal(p);
    div.querySelector('[data-edit-post]').onclick = () => openPostModal(p);
    div.querySelector('[data-del-post]').onclick = async () => {
      await api.put('/api/schedule', { ...state.schedule, posts: (state.schedule.posts || []).filter(x => x.id !== p.id) });
      refresh();
    };
    pl.appendChild(div);
  }

  // Каналы
  const cl = $('#channelsList');
  cl.innerHTML = '';
  for (const ch of state.channels) {
    const div = document.createElement('div');
    div.className = 'chan-item';
    div.innerHTML = `
      <div class="info"><b>${escapeHtml(ch.name)}</b> <span class="mut">chat_id: ${ch.chat_id}</span></div>
      <div class="row">
        <button class="btn-sm" data-edit-chan>✏️</button>
        <button class="btn-sm danger" data-del-chan>🗑</button>
      </div>`;
    div.querySelector('[data-edit-chan]').onclick = () => openChannelModal(ch);
    div.querySelector('[data-del-chan]').onclick = async () => {
      await api.put('/api/channels', state.channels.filter(x => x.name !== ch.name));
      refresh();
    };
    cl.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== Модалки =====
function openModal(html) {
  $('#modalContent').innerHTML = html;
  $('#modalBg').classList.remove('hidden');
  $('#modalBg').onclick = e => { if (e.target === $('#modalBg')) closeModal(); };
}
function closeModal() { $('#modalBg').classList.add('hidden'); }

async function openPostModal(post) {
  const p = post || { id: '', time: '09:00', channels: [], text: '', media: '', buttons: [], days: [], date: '' };
  const chans = state.channels.map(c => c.name);
  const dayNames = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 7: 'Вс' };
  const daysHtml = Object.entries(dayNames).map(([n, label]) =>
    `<label style="margin-right:10px"><input type="checkbox" value="${n}" ${(p.days || []).map(String).includes(n) ? 'checked' : ''}>${label}</label>`
  ).join('');
  // Чекбоксы-каналы: каждый канал — кликабельный тумблер
  const chansHtml = chans.length
    ? chans.map(c =>
        `<label class="chan-opt" style="display:inline-block; margin:4px 6px 4px 0; padding:6px 12px; border:1px solid var(--border); border-radius:20px; cursor:pointer; user-select:none;" >
           <input type="checkbox" value="${escapeHtml(c)}" style="display:none" ${(p.channels || []).includes(c) ? 'checked' : ''}>${escapeHtml(c)}
         </label>`
      ).join('')
    : '<span class="mut">Сначала добавьте каналы в разделе «Каналы»</span>';
  openModal(`
    <h3>${post ? 'Редактировать пост' : 'Новый пост'}</h3>
    <div class="field"><label>ID (уникальный)</label><input id="f-id" value="${escapeHtml(p.id)}"></div>
    <div class="field-row">
      <div class="field"><label>Время (HH:MM)</label><input id="f-time" value="${escapeHtml(p.time)}" placeholder="09:00"></div>
      <div class="field"><label>Дата (необязательно, YYYY-MM-DD)</label><input id="f-date" value="${escapeHtml(p.date || '')}" placeholder="2026-10-30"></div>
    </div>
    <div class="field"><label>Дни недели (пусто = каждый день)</label><div id="f-days">${daysHtml}</div></div>
    <div class="field"><label>Куда постить (выберите каналы)</label><div id="f-chans">${chansHtml}</div></div>
    <div class="field"><label>Текст</label><textarea id="f-text" rows="3">${escapeHtml(p.text)}</textarea></div>
    <div class="field">
      <label>Картинка к посту (кликните, чтобы выбрать из загруженных)</label>
      <div id="f-media-picker" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px;"></div>
      <input id="f-media" value="${escapeHtml(p.media)}" placeholder="или введите путь вручную: contents/photo.jpg" style="width:100%">
    </div>
    <div class="field"><label>Кнопки (формат: Текст|URL — по одной на строку)</label><textarea id="f-buttons" rows="2">${(p.buttons || []).map(b => `${b.text}|${b.url || b.payload || ''}`).join('\n')}</textarea></div>
    <div class="row" style="justify-content:flex-end">
      <button onclick="closeModal()">Отмена</button>
      <button class="primary" id="btnSavePost">Сохранить</button>
    </div>
  `);
  // Подсветка выбранных каналов
  const chanBoxes = [...document.querySelectorAll('#f-chans input[type=checkbox]')];
  const paintChans = () => {
    chanBoxes.forEach(cb => {
      const lbl = cb.closest('label');
      if (lbl) lbl.style.borderColor = cb.checked ? 'var(--green)' : 'var(--border)';
      if (lbl) lbl.style.color = cb.checked ? 'var(--green)' : 'var(--text)';
      if (lbl) lbl.style.background = cb.checked ? 'rgba(0,255,65,0.1)' : 'transparent';
    });
  };
  chanBoxes.forEach(cb => cb.addEventListener('change', paintChans));
  paintChans();

  // Загрузка и отображение картинок для выбора
  const mediaInput = document.getElementById('f-media');
  const picker = document.getElementById('f-media-picker');
  const currentlySelected = (p.media || '').replace(/^contents\//, '');
  let selectedMedia = currentlySelected;
  const images = await api.get('/api/images');
  if (images.length) {
    picker.innerHTML = images.map(name => {
      const full = 'contents/' + name;
      const active = (selectedMedia === name);
      return `<div data-media="${escapeHtml(name)}" style="cursor:pointer; text-align:center; border:2px solid ${active ? 'var(--green)' : 'var(--border)'}; border-radius:8px; padding:6px; width:110px;">
        <img src="/contents/${encodeURIComponent(name)}" loading="lazy" style="width:90px; height:60px; object-fit:cover; border-radius:4px; display:block; margin:0 auto 4px;" onerror="this.style.display='none'">
        <div style="font-size:0.65rem; color:var(--dim); word-break:break-all;">${escapeHtml(name)}</div>
      </div>`;
    }).join('');
    picker.querySelectorAll('[data-media]').forEach(el => {
      el.onclick = () => {
        const name = el.getAttribute('data-media');
        if (selectedMedia === name) {
          selectedMedia = '';
          mediaInput.value = '';
        } else {
          selectedMedia = name;
          mediaInput.value = 'contents/' + name;
        }
        picker.querySelectorAll('[data-media]').forEach(x => {
          const isActive = x.getAttribute('data-media') === selectedMedia;
          x.style.borderColor = isActive ? 'var(--green)' : 'var(--border)';
        });
      };
    });
  } else {
    picker.innerHTML = '<span class="mut">Пока нет загруженных картинок — загрузите их в разделе ниже или впишите путь вручную.</span>';
  }

  $('#btnSavePost').onclick = async () => {
    const buttons = ($('#f-buttons').value || '').split('\n').filter(Boolean).map(line => {
      const [text, url] = line.split('|');
      return url ? { text: text.trim(), url: url.trim() } : { text: text.trim(), payload: text.trim() };
    });
    const days = [...$('#f-days').querySelectorAll('input:checked')].map(i => Number(i.value));
    const selectedChans = chanBoxes.filter(cb => cb.checked).map(cb => cb.value);
    if (!selectedChans.length) { alert('Выберите хотя бы один канал'); return; }
    const data = {
      id: $('#f-id').value.trim() || 'post-' + Date.now(),
      time: $('#f-time').value.trim() || '09:00',
      date: $('#f-date').value.trim() || undefined,
      days: days.length ? days : undefined,
      channels: selectedChans,
      text: $('#f-text').value,
      media: $('#f-media').value.trim() || undefined,
      buttons,
    };
    const posts = (state.schedule.posts || []).filter(x => x.id !== p.id);
    posts.push(data);
    await api.put('/api/schedule', { ...state.schedule, posts });
    closeModal();
    refresh();
  };
}

function openChannelModal(chan) {
  const c = chan || { name: '', chat_id: '' };
  openModal(`
    <h3>${chan ? 'Редактировать канал' : 'Новый канал'}</h3>
    <div class="field"><label>Название</label><input id="c-name" value="${escapeHtml(c.name)}"></div>
    <div class="field"><label>chat_id</label><input id="c-id" type="number" value="${c.chat_id || ''}"></div>
    <div class="row" style="justify-content:flex-end">
      <button onclick="closeModal()">Отмена</button>
      <button class="primary" id="btnSaveChan">Сохранить</button>
    </div>
  `);
  $('#btnSaveChan').onclick = async () => {
    const data = { name: $('#c-name').value.trim(), chat_id: Number($('#c-id').value) };
    if (!data.name || !data.chat_id) return;
    const chans = state.channels.filter(x => x.name !== (c.name || ''));
    chans.push(data);
    await api.put('/api/channels', chans);
    closeModal();
    refresh();
  };
}

// Модалка немедленной отправки поста
function openSendModal(post) {
  const chans = state.channels;
  if (!chans.length) { alert('Сначала добавьте каналы'); return; }
  const opts = chans.map(c =>
    `<option value="${c.chat_id}">${escapeHtml(c.name)} (${c.chat_id})</option>`
  ).join('');
  openModal(`
    <h3>Отправить пост «${escapeHtml(post.id)}» сейчас</h3>
    <div class="field"><label>Куда отправить</label><select id="send-target">${opts}</select></div>
    <div class="row" style="justify-content:flex-end">
      <button onclick="closeModal()">Отмена</button>
      <button class="primary" id="btnSendNow">🚀 Отправить</button>
    </div>
  `);
  $('#btnSendNow').onclick = async () => {
    const chatId = Number($('#send-target').value);
    const btn = $('#btnSendNow');
    btn.disabled = true; btn.textContent = 'Отправляю...';
    try {
      const res = await api.post('/api/send-now', { post, chatId });
      if (res.ok) { alert('✅ Отправлено!'); closeModal(); }
      else {
        const extra = res.code ? ` [${res.status} ${res.code}]` : (res.status ? ` [${res.status}]` : '');
        alert('Ошибка: ' + (res.error || 'неизвестно') + extra);
      }
    } catch (e) { alert('Ошибка сети: ' + e.message); }
    btn.disabled = false; btn.textContent = '🚀 Отправить';
  };
}

// Получение chat_id каналов, где бот состоит
$('#btnDiscover').onclick = async () => {
  const btn = $('#btnDiscover');
  const out = $('#discoverResult');
  btn.disabled = true; btn.textContent = 'Ищу...';
  out.innerHTML = '';
  try {
    const res = await api.post('/api/discover-channels');
    if (!res.ok) throw new Error(res.error || 'неизвестно');
    if (!res.channels.length) {
      out.innerHTML = '<span style="color:var(--red)">Каналов не найдено. Добавьте бота в канал или напишите ему из канала, затем повторите.</span>';
    } else {
      const names = res.channels.map(c => `${c.name} (${c.chat_id})`).join(', ');
      out.innerHTML = `Найдено: <b>${names}</b>. <button class="btn-sm primary" id="btnAddFound">Добавить все</button>`;
      const btnAdd = document.getElementById('btnAddFound');
      btnAdd.onclick = async () => {
        const existing = new Set(state.channels.map(c => String(c.chat_id)));
        const chans = [...state.channels];
        for (const c of res.channels) {
          if (!existing.has(String(c.chat_id))) chans.push({ name: c.name, chat_id: c.chat_id });
        }
        await api.put('/api/channels', chans);
        out.innerHTML = '✅ Добавлены';
        refresh();
      };
    }
  } catch (e) {
    out.innerHTML = `<span style="color:var(--red)">Ошибка: ${escapeHtml(e.message)}</span>`;
  }
  btn.disabled = false; btn.textContent = '🛰 Получить chat_id';
};

// ===== SSE =====
function setupSSE() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.type === 'log') appendLog(d);
    if (d.type === 'state') { state.running = d.running; render(); }
  };
}
function appendLog(entry) {
  const box = $('#logBox');
  const div = document.createElement('div');
  div.className = 'entry';
  div.innerHTML = `<span class="t">${escapeHtml(entry.time)}</span>${escapeHtml(entry.msg)}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  if (box.children.length > 200) box.removeChild(box.firstChild);
}

// ===== Инициализация =====
$('#btnStart').onclick = async () => { await api.post('/api/start'); refresh(); };
$('#btnStop').onclick = async () => { await api.post('/api/stop'); refresh(); };
$('#btnAddPost').onclick = () => openPostModal();
$('#btnAddChannel').onclick = () => openChannelModal();

$('#btnUpload').onclick = async () => {
  const file = $('#fileInput').files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('image', file);
  const r = await fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json());
  if (r.ok) { loadImages(); $('#fileInput').value = ''; }
};

async function loadImages() {
  const list = await api.get('/api/images');
  $('#imgCount').textContent = list.length;
  const box = $('#imgList');
  box.innerHTML = '';
  for (const name of list) {
    const div = document.createElement('div');
    div.className = 'img-item';
    div.innerHTML = `<img src="/contents/${encodeURIComponent(name)}" alt=""><div class="nm">${escapeHtml(name)}</div><button class="btn-sm danger" data-del-img>🗑</button>`;
    div.querySelector('[data-del-img]').onclick = async () => {
      await api.del('/api/images/' + encodeURIComponent(name));
      loadImages();
    };
    box.appendChild(div);
  }
}

/* ===== Запуск ===== */
refresh();
setupSSE();
loadImages();