import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot } from '@maxhub/max-bot-api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, 'config');

export function loadJson(rel) {
  const p = path.join(CONFIG_DIR, rel);
  if (!existsSync(p)) throw new Error(`Нет файла конфига: ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function saveJson(rel, data) {
  const p = path.join(CONFIG_DIR, rel);
  // Нормализуем: каналы храним как { channels: [...] }
  if (rel === 'channels.json' && Array.isArray(data)) {
    data = { channels: data };
  }
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

// Чтение каналов с поддержкой обоих форматов (массив или {channels:[...]})
export function loadChannels() {
  const raw = loadJson('channels.json');
  return Array.isArray(raw) ? raw : (raw.channels || []);
}

export function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!existsSync(envPath)) return null;
  const text = readFileSync(envPath, 'utf8');
  const m = text.match(/^MAX_BOT_TOKEN\s*=\s*(.+)$/m);
  return (m && m[1].trim() && m[1].trim() !== 'ЗАМЕНИТЕ_НА_ВАШ_ТОКЕН') ? m[1].trim() : null;
}

export class Scheduler {
  constructor() {
    this.running = false;
    this.timer = null;
    this.discoverTimer = null;
    this.lastSent = new Set();
    this.discoveredChats = [];   // накопленные chat_id из событий
    this.listeners = [];       // (event: 'log'|'state', payload) => void
    this._logHistory = [];
  }

  on(listener) { this.listeners.push(listener); }

  log(msg) {
    const entry = { time: new Date().toLocaleTimeString('ru-RU'), msg };
    this._logHistory.push(entry);
    if (this._logHistory.length > 300) this._logHistory.shift();
    console.log('[scheduler] ' + msg);
    this._emit('log', entry);
  }

  _emit(type, data) { for (const l of this.listeners) l(type, data); }

  get state() {
    return {
      running: this.running,
      channels: loadChannels(),
      schedule: loadJson('schedule.json'),
      log: this._logHistory.slice(-100),
    };
  }

  start() {
    if (this.running) return false;
    const token = loadEnv();
    if (!token) { this.log('❌ Нет токена — заполните .env'); return false; }
    try {
      this.bot = new Bot(token);
      this.api = this.bot.api;
    } catch (e) {
      this.log('❌ Ошибка инициализации бота: ' + e.message);
      return false;
    }

    this.running = true;
    this._emit('state', { running: true });
    this.log('🚀 Постинг запущен');
    this.timer = setInterval(() => this.tick(), 30000);
    this.tick(); // проверить сразу
    // Фоновый сбор chat_id из событий (в т.ч. когда бота добавляют в канал)
    this.startDiscoverLoop();
    return true;
  }

  async startDiscoverLoop() {
    if (this.discoverTimer) clearInterval(this.discoverTimer);
    const collect = async () => {
      try {
        if (!this.api) return;
        const resp = await Promise.race([
          this.api.getUpdates(['bot_added', 'bot_started', 'message_created'], { timeout: 2, limit: 100 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
        ]);
        const items = resp?.updates || [];
        let changed = false;
        for (const u of items) {
          const chatId = u?.chat_id ?? u?.payload?.chat_id ?? u?.message?.chat_id ?? u?.message?.payload?.chat_id;
          if (chatId && !this.discoveredChats.some(c => c.chat_id === chatId)) {
            const name = u?.payload?.chat_name ?? u?.chat_name ?? u?.message?.chat_name ?? `Канал ${chatId}`;
            this.discoveredChats.push({ chat_id: chatId, update_type: u?.update_type || 'unknown', name });
            // Автодобавление в конфиг channels.json
            try {
              const channels = loadChannels();
              if (!channels.some(c => c.chat_id === chatId)) {
                channels.push({ name, chat_id: chatId });
                saveJson('channels.json', channels);
                changed = true;
                this.log(`🛰 Найден и добавлен канал: ${name} (${chatId})`);
              }
            } catch (e) {
              this.log(`⚠️ Не удалось сохранить канал ${chatId}: ${e.message}`);
            }
          }
        }
        if (changed) this._emit('state', {});
      } catch (_e) { /* игнорируем таймаут/ошибку сбора */ }
    };
    await collect();
    this.discoverTimer = setInterval(collect, 60000);
  }

  stop() {
    if (!this.running) return false;
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this._emit('state', { running: false });
    this.log('⏹ Постинг остановлен');
    return true;
  }

  resetDayCache() { this.lastSent.clear(); }

  // Получение chat_id каналов, где бот есть (из накопленных событий + быстрый сбор)
  async discoverChannels() {
    if (!this.api) {
      const token = loadEnv();
      if (!token) throw new Error('Нет токена в .env');
      this.bot = new Bot(token);
      this.api = this.bot.api;
    }
    // Быстрая попытка собрать новые события
    try {
      const resp = await Promise.race([
        this.api.getUpdates(['bot_added', 'bot_started', 'message_created'], { timeout: 2, limit: 100 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
      ]);
      const items = resp?.updates || [];
      for (const u of items) {
        const chatId = u?.chat_id ?? u?.payload?.chat_id ?? u?.message?.chat_id ?? u?.message?.payload?.chat_id;
        if (chatId && !this.discoveredChats.some(c => c.chat_id === chatId)) {
          const name = u?.payload?.chat_name ?? u?.chat_name ?? u?.message?.chat_name ?? `Канал ${chatId}`;
          this.discoveredChats.push({ chat_id: chatId, update_type: u?.update_type || 'unknown', name });
        }
      }
    } catch (_e) { /* таймаут — ок */ }

    return this.discoveredChats.slice();
  }

  // Немедленная публикация поста
  async sendNow(post, chatId) {
    if (!this.api) {
      const token = loadEnv();
      if (!token) throw new Error('Нет токена в .env');
      this.bot = new Bot(token);
      this.api = this.bot.api;
    }
    return await this.sendPost(post, chatId);
  }

  // ===== Внутренности =====
  parseTimeHHMM(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }

  timezoneOffsetMs(tz) {
    const m = tz && tz.match(/([+-])(\d{2}):(\d{2})/);
    if (!m) return 0;
    const sign = m[1] === '+' ? 1 : -1;
    return sign * (Number(m[2]) * 60 + Number(m[3])) * 60000;
  }

  resolveChatId(chanIdOrName) {
    const channels = loadChannels();
    if (typeof chanIdOrName === 'number') return chanIdOrName;
    const ch = channels.find(c => c.name === chanIdOrName);
    if (!ch) throw new Error(`Канал не найден: ${chanIdOrName}`);
    return ch.chat_id;
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  buildKeyboard(buttons) {
    // Каждая строка клавиатуры = массив кнопок (Button[][]) — по 2 кнопки в ряд
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
      rows.push(buttons.slice(i, i + 2).map(b =>
        b.url
          ? { type: 'link', text: b.text, url: b.url }
          : { type: 'callback', text: b.text, payload: b.payload || b.text }
      ));
    }
    return {
      type: 'inline_keyboard',
      payload: { buttons: rows },
    };
  }

  async uploadImage(fileRel) {
    const p = path.join(__dirname, fileRel);
    if (!existsSync(p)) throw new Error(`Файл не найден: ${p}`);
    // Возвращаем токен из API (структура: { photos: { "0": { token } } })
    const img = await this.api.uploadImage({ source: p });
    const firstKey = Object.keys(img?.photos || {})[0];
    const token = img?.photos?.[firstKey]?.token;
    if (!token) throw new Error('API не вернул токен для картинки');
    return token;
  }

  async sendPost(post, chatId) {
    const attachments = [];
    if (post.media) {
      try {
        const token = await this.uploadImage(post.media);
        // Правильная структура вложения для POST /messages
        attachments.push({ type: 'image', payload: { token } });
        this.log(`  📷 загружено: ${post.media}`);
      } catch (e) {
        this.log(`  ⚠️ Картинка ${post.media}: ${e.message}`);
      }
    }
    if (post.buttons && post.buttons.length) {
      attachments.push(this.buildKeyboard(post.buttons));
    }
    if (post.media) await this.sleep(3000); // даём файлу "дозреть"
    const extra = attachments.length ? { attachments } : {};
    return await this.api.sendMessageToChat(chatId, post.text || '', extra);
  }

  isPostDue(post, nowMs, tzMs) {
    const localNow = new Date(nowMs + tzMs);
    const todayStr = localNow.toISOString().slice(0, 10);        // YYYY-MM-DD (по локальному времени)
    const curMin = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
    // Проверка времени
    if (curMin !== this.parseTimeHHMM(post.time)) return false;
    // Если задана конкретная дата — постим только в неё
    if (post.date && post.date !== todayStr) return false;
    // Если заданы дни недели — постим только в них (1=пн..7=вс)
    if (post.days && post.days.length) {
      const jsDay = localNow.getUTCDay();          // 0=вс..6=сб
      const isoDay = jsDay === 0 ? 7 : jsDay;      // 1=пн..7=вс
      if (!post.days.includes(isoDay)) return false;
    }
    return !this.lastSent.has(`${post.id}:${todayStr}`);
  }

  async tick() {
    if (!this.running) return;
    const schedule = loadJson('schedule.json');
    const tzMs = this.timezoneOffsetMs(schedule.timezone);
    const now = Date.now();
    const todayStr = new Date(now + tzMs).toISOString().slice(0, 10);

    for (const post of schedule.posts) {
      try {
        if (!this.isPostDue(post, now, tzMs)) continue;
        const ids = [post.channels].flat();
        for (const chan of ids) {
          try {
            const chatId = this.resolveChatId(chan);
            await this.sendPost(post, chatId);
            this.lastSent.add(`${post.id}:${todayStr}`);
            this.log(`✅ [${post.id}] → ${chan} (${chatId})`);
          } catch (e) {
            this.log(`❌ [${post.id}] → ${chan}: ${e.message}`);
          }
        }
      } catch (e) {
        this.log(`❌ Планировщик [${post?.id}]: ${e.message}`);
      }
    }
  }
}