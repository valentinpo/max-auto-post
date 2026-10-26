import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot } from '@maxhub/max-bot-api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===== Конфиг =====
const CONFIG_DIR = path.join(__dirname, 'config');
const ENV_PATH = path.join(__dirname, '.env');

function loadEnv() {
  if (!existsSync(ENV_PATH)) {
    console.error('❌ Нет файла .env! Скопируйте .env.example в .env и впишите токен бота.');
    process.exit(1);
  }
  const text = readFileSync(ENV_PATH, 'utf8');
  const m = text.match(/^MAX_BOT_TOKEN\s*=\s*(.+)$/m);
  if (!m || !m[1].trim() || m[1].trim() === 'ЗАМЕНИТЕ_НА_ВАШ_ТОКЕН') {
    console.error('❌ В .env не заполнен MAX_BOT_TOKEN.');
    process.exit(1);
  }
  return m[1].trim();
}

function loadJson(rel) {
  const p = path.join(CONFIG_DIR, rel);
  if (!existsSync(p)) { console.error(`❌ Нет файла конфига: ${p}`); process.exit(1); }
  return JSON.parse(readFileSync(p, 'utf8'));
}

const TOKEN = loadEnv();
const channelsCfg = loadJson('channels.json');
const scheduleCfg = loadJson('schedule.json');

// ===== API =====
// Bot сам создаёт Api внутри (new Api(createClient(token))), поэтому берём bot.api
const bot = new Bot(TOKEN);
const api = bot.api;

// Индекс каналов по имени
const channelByName = {};
for (const ch of channelsCfg.channels) channelByName[ch.name] = ch.chat_id;

function resolveChatId(chan) {
  if (typeof chan === 'number') return chan;
  const id = channelByName[chan];
  if (!id) throw new Error(`Канал не найден в channels.json: ${chan}`);
  return id;
}

// ===== Утилиты =====
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildKeyboard(buttons) {
  return {
    type: 'inline_keyboard',
    payload: {
      buttons: buttons.map(b =>
        b.url
          ? { type: 'link', text: b.text, url: b.url }
          : { type: 'callback', text: b.text, payload: b.payload || b.text }
      ),
    },
  };
}

async function uploadImage(fileRel) {
  const p = path.join(__dirname, fileRel);
  if (!existsSync(p)) throw new Error(`Файл не найден: ${p}`);
  const res = await api.uploadImage({ source: p });
  return res;
}

async function sendPost(post, chatId) {
  const attachments = [];
  if (post.media) {
    try {
      const img = await uploadImage(post.media);
      attachments.push(img);
      console.log(`  📷 загружено: ${post.media}`);
    } catch (e) {
      console.error(`  ⚠️ Не удалось загрузить картинку ${post.media}: ${e.message}`);
    }
  }
  if (post.buttons && post.buttons.length) {
    attachments.push(buildKeyboard(post.buttons));
  }

  // Файл может быть ещё "в обработке" — ждём перед отправкой
  if (post.media) await sleep(3000);

  const extra = attachments.length ? { attachments } : {};
  const msg = await api.sendMessageToChat(chatId, post.text || '', extra);
  return msg;
}

// ===== Планировщик =====
function parseTimeHHMM(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function timezoneOffsetMs(tz) {
  const m = tz && tz.match(/([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (Number(m[2]) * 60 + Number(m[3])) * 60000;
}

function isPostDue(post, nowMs, tzMs, lastSent) {
  const todayStr = new Date(nowMs + tzMs).toISOString().slice(0, 10);
  const localNow = new Date(nowMs + tzMs);
  const curMin = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  if (curMin !== parseTimeHHMM(post.time)) return false;
  const lastKey = `${post.id}:${todayStr}`;
  if (lastSent.has(lastKey)) return false;
  return true;
}

async function runOnce() {
  const tzMs = timezoneOffsetMs(scheduleCfg.timezone);
  const lastSent = new Set();

  setInterval(async () => {
    const now = Date.now();
    for (const post of scheduleCfg.posts) {
      try {
        if (!isPostDue(post, now, tzMs, lastSent)) continue;
        const ids = [post.channels].flat();
        for (const chan of ids) {
          const chatId = resolveChatId(chan);
          try {
            await sendPost(post, chatId);
            const key = `${post.id}:${new Date(now + tzMs).toISOString().slice(0, 10)}`;
            lastSent.add(key);
            console.log(`✅ [${post.id}] -> ${chan} (${chatId})`);
          } catch (e) {
            console.error(`❌ [${post.id}] -> ${chan}: ${e.message}`);
          }
        }
      } catch (e) {
        console.error(`❌ Ошибка планировщика [${post?.id}]: ${e.message}`);
      }
    }
  }, 30000);
}

// ===== Печать расписания при старте =====
console.log('🚀 MAX авто-постинг запущен');
console.log(`Время по расписанию: UTC${scheduleCfg.timezone || '±00:00'}`);
console.log(`Каналов в конфиге: ${channelsCfg.channels.length}`);
console.log('Публикации:');
for (const post of scheduleCfg.posts) {
  console.log(`  ⏰ ${post.time} — ${post.id} → ${[post.channels].flat().join(', ')}${post.media ? ' + 📷' : ''}${post.buttons?.length ? ' + 🔘' : ''}`);
}

runOnce();