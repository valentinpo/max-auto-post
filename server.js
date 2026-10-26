import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { Scheduler, loadJson, saveJson, loadEnv } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENTS_DIR = path.join(__dirname, 'contents');
if (!existsSync(CONTENTS_DIR)) mkdirSync(CONTENTS_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/contents', express.static(CONTENTS_DIR));

// Загрузка картинок
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CONTENTS_DIR),
  filename: (_req, file, cb) => {
    // Сохраняем оригинальное имя, но очищаем от небезопасных символов (кириллица — ок)
    let name = file.originalname || 'image';
    name = name.replace(/[^\w.\-\u0400-\u04FF]+/g, '_').toLowerCase();
    // Уникализация при совпадении
    const full = path.join(CONTENTS_DIR, name);
    if (existsSync(full) && (Date.now() - statSync(full).mtimeMs) < 100) {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      name = `${base}_${Date.now()}${ext}`;
    }
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

// Обработчик ошибок multer (не используется напрямую — объявлен ниже как middleware)

const scheduler = new Scheduler();

// Автозапуск фонового поиска каналов при старте панели (если токен есть)
if (loadEnv()) {
  scheduler.startDiscoverLoop().catch(() => {});
}

// SSE-канал для лога (клиент подписывается и получает события)
scheduler.on((type, data) => {
  for (const res of sseClients) {
    if (type === 'log') res.write(`data: ${JSON.stringify({ type: 'log', ...data })}\n\n`);
    if (type === 'state') res.write(`data: ${JSON.stringify({ type: 'state', ...data })}\n\n`);
  }
});
const sseClients = new Set();

// ===== API =====
app.get('/api/state', (_req, res) => {
  const hasToken = !!loadEnv();
  res.json({ ...scheduler.state, hasToken });
});

app.post('/api/start', (_req, res) => {
  const ok = scheduler.start();
  res.json({ ok, running: scheduler.running });
});

app.post('/api/stop', (_req, res) => {
  const ok = scheduler.stop();
  res.json({ ok, running: scheduler.running });
});

// Посты
app.put('/api/schedule', (req, res) => {
  try {
    saveJson('schedule.json', req.body);
    scheduler.resetDayCache();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/test-post', async (req, res) => {
  const { chatId, text, media, buttons } = req.body;
  if (!chatId) return res.status(400).json({ ok: false, error: 'Нужен chatId' });
  try {
    scheduler.start(); // гарантируем, что api есть (idempotent-ish: start делает api)
    // но не хочется запускать планировщик из-за теста — создадим временный? Упрощённо: используем текущий
    const msg = await scheduler.sendPost({ text, media, buttons }, Number(chatId));
    res.json({ ok: true, id: msg?.id });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Каналы
app.put('/api/channels', (req, res) => {
  try {
    saveJson('channels.json', req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Поиск каналов, где бот состоит (через getUpdates)
app.post('/api/discover-channels', async (_req, res) => {
  try {
    const found = await scheduler.discoverChannels();
    res.json({ ok: true, channels: found });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Немедленная публикация поста
app.post('/api/send-now', async (req, res) => {
  const { post, chatId } = req.body || {};
  if (!post || !chatId) return res.status(400).json({ ok: false, error: 'Нужны post и chatId' });
  try {
    const msg = await scheduler.sendNow(post, Number(chatId));
    res.json({ ok: true, id: msg?.id });
  } catch (e) {
    // Пробрасываем детали ошибки API
    const errStatus = e?.status || 400;
    const errCode = e?.code || null;
    const errMsg = e?.description || e?.message || String(e);
    res.status(errStatus).json({ ok: false, status: errStatus, code: errCode, error: errMsg });
  }
});

// Картинки
app.get('/api/images', (_req, res) => {
  const list = readdirSync(CONTENTS_DIR);
  res.json(list);
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Нет файла' });
  res.json({ ok: true, name: req.file.filename });
});

// Ошибки multer (неправильный файл, большой размер и т.д.)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, error: `Ошибка загрузки: ${err.message}` });
  }
  if (err) return res.status(400).json({ ok: false, error: err.message || String(err) });
  next();
});

app.delete('/api/images/:name', (req, res) => {
  const safe = path.basename(req.params.name);
  const p = path.join(CONTENTS_DIR, safe);
  try { unlinkSync(p); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// SSE endpoint
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.listen(PORT, () => {
  console.log(`🖥 MAX auto-post панель: http://localhost:${PORT}`);
  console.log(`  Токен: ${loadEnv() ? '✓ есть' : '✗ нет (файл .env)'}`);
});