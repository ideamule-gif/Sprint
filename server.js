const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const webpush = require('web-push');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://ideamule_db_user:BUFRqKh9raaJ8vyA@sprint.nygqpkm.mongodb.net/?appName=Sprint';
const client = new MongoClient(MONGO_URI, { serverApi: ServerApiVersion.v1 });

let db;
async function connectDB() {
  try {
    await client.connect();
    db = client.db('sprint');
    console.log('✅ MongoDB connected');
  } catch (e) {
    console.error('❌ MongoDB error:', e.message);
  }
}
connectDB();

// Middleware: обновление lastSeen + проверка DB
app.use(async (req, res, next) => {
  if (!db) {
    try { await client.connect(); db = client.db('sprint'); } catch (e) {
      return res.status(500).json({ error: 'Database unavailable' });
    }
  }
  if (req.headers['x-user-id'] && ObjectId.isValid(req.headers['x-user-id'])) {
    try {
      await db.collection('users').updateOne(
        { _id: new ObjectId(req.headers['x-user-id']) },
        { $set: { lastSeen: new Date() } }
      );
    } catch (e) {}
  }
  next();
});

app.use(express.static(__dirname));
app.use(express.json({ limit: '50mb' }));
app.use(cors());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const BOT_TOKEN = '8727458645:AAEp0YLowPJYs9FirMYDFM9votOm9vOZieU';
const ADMIN_CHAT_ID = '7656839845';
const statusNames = { 'new': 'Новый', 'processing': 'В обработке', 'printing': 'В печати', 'ready': 'Готов', 'shipped': 'Отправлен', 'done': 'Доставлен' };

webpush.setVapidDetails('mailto:ideamule@gmail.com', 'BO4rOIC4gMmMlgze-laJFcHh71oauLdhZji_Knqag6Z2MIosXOdueOofIbvlnH-EHIdr170jTLrFWhAOL-NcVds', 'C_Vy3LyU0wSHsZYy_S6yoSK7iFkmPoOPDFVJcOozRa8');

async function sendTelegram(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (e) {}
}

// Главная
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ========== РЕГИСТРАЦИЯ ==========
app.post('/api/register', async (req, res) => {
  const { email, password, name, phone } = req.body;
  if (!email || !password) return res.json({ success: false, error: 'Email и пароль обязательны' });
  const users = db.collection('users');
  if (await users.findOne({ email })) return res.json({ success: false, error: 'Email уже зарегистрирован' });
  const user = {
    email,
    password: crypto.createHash('sha256').update(password).digest('hex'),
    name: name || '',
    phone: phone || '',
    createdAt: new Date()
  };
  const result = await users.insertOne(user);
  sendTelegram(ADMIN_CHAT_ID, `👤 Новый клиент: ${email}\nИмя: ${name || '—'}\nТелефон: ${phone || '—'}`);
  res.json({ success: true, user: { id: result.insertedId.toString(), email, name: user.name, phone: user.phone } });
});

// ========== ВХОД ==========
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ success: false, error: 'Email и пароль обязательны' });
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  const user = await db.collection('users').findOne({ email, password: hash });
  if (!user) return res.json({ success: false, error: 'Неверный email или пароль' });
  res.json({ success: true, user: { id: user._id.toString(), email: user.email, name: user.name, phone: user.phone } });
});

// ========== ВОССТАНОВЛЕНИЕ ПАРОЛЯ ==========
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, error: 'Введите email' });
  const user = await db.collection('users').findOne({ email });
  if (!user) return res.json({ success: false, error: 'Email не найден' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await db.collection('users').updateOne({ _id: user._id }, { $set: { resetCode: code, resetExpires: Date.now() + 3600000 } });
  try {
    await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: 'service_6g06b1d',
        template_id: 'template_td443v9',
        user_id: '1uNqFkbGPhecG4EaK',
        template_params: { name: user.name || 'Клиент', code: code, email: email }
      })
    });
  } catch (e) {}
  res.json({ success: true });
});

app.post('/api/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) return res.json({ success: false, error: 'Все поля обязательны' });
  const user = await db.collection('users').findOne({ email, resetCode: code, resetExpires: { $gt: Date.now() } });
  if (!user) return res.json({ success: false, error: 'Неверный код или срок истёк' });
  await db.collection('users').updateOne(
    { _id: user._id },
    {
      $set: { password: crypto.createHash('sha256').update(newPassword).digest('hex') },
      $unset: { resetCode: '', resetExpires: '' }
    }
  );
  res.json({ success: true });
});

// ========== УДАЛЕНИЕ ПРОФИЛЯ ==========
app.post('/api/delete-account', async (req, res) => {
  const { userId } = req.body;
  if (!userId || !ObjectId.isValid(userId)) return res.json({ success: false, error: 'Invalid userId' });
  try {
    await db.collection('users').deleteOne({ _id: new ObjectId(userId) });
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ========== TELEGRAM LOGIN ==========
app.post('/api/telegram-login', async (req, res) => {
  const { id, first_name, last_name, username, photo_url } = req.body;
  if (!id) return res.json({ success: false, error: 'Нет ID' });
  const users = db.collection('users');
  let user = await users.findOne({ telegramId: String(id) });
  if (!user) {
    user = {
      telegramId: String(id),
      name: [first_name, last_name].filter(Boolean).join(' ') || username || 'Клиент',
      username,
      photo_url,
      createdAt: new Date()
    };
    const result = await users.insertOne(user);
    user._id = result.insertedId;
  } else {
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          name: [first_name, last_name].filter(Boolean).join(' ') || user.name,
          username: username || user.username,
          photo_url: photo_url || user.photo_url
        }
      }
    );
  }
  res.json({ success: true, user: { id: user._id.toString(), telegramId: user.telegramId, name: user.name, email: user.email || '', phone: user.phone || '' } });
});

// ========== ЗАКАЗ ==========
app.post('/api/order', async (req, res) => {
  const order = req.body;
  const orders = db.collection('orders');
  const lastOrder = await orders.findOne({}, { sort: { _id: -1 } });
  const nextNum = lastOrder ? parseInt(lastOrder._id) + 1 : 1;
  order._id = nextNum.toString().padStart(6, '0');
  order.status = 'new';
  order.createdAt = new Date();
  if (order.fileBase64 && order.fileName) {
    const buffer = Buffer.from(order.fileBase64, 'base64');
    const filePath = path.join(uploadsDir, order._id + '_' + order.fileName);
    fs.writeFileSync(filePath, buffer);
    order.fileUrl = `/uploads/${order._id}_${order.fileName}`;
  }
  delete order.fileBase64;
  await orders.insertOne(order);

  const extrasText = order.extras?.length > 0 ? order.extras.map(e => `${e.name}: ${Math.round(e.cost)} р.`).join(', ') : 'Нет';

  await db.collection('chat').insertOne({
    userId: order.userId,
    from: 'admin',
    text: `✅ Заказ #${order._id} оформлен!\n\n📦 ${order.material}\n📐 ${order.width}×${order.height} мм\n🔢 ${order.qty} шт\n🔧 ${extrasText}\n💰 Итого: ${order.total} р.\n🚕 Доставка: бесплатно по Краснодару\n\nПроверьте данные. Если всё верно — ожидайте ссылку на оплату.\n\nСтатус заказа можно отслеживать в Профиле → История заказов.`,
    time: new Date()
  });

  sendTelegram(ADMIN_CHAT_ID, `🔵 НОВЫЙ ЗАКАЗ #${order._id}\n\n📦 ${order.material}\n📐 ${order.width}×${order.height} мм\n🔢 ${order.qty} шт\n🔧 ${extrasText}\n💰 Сумма: ${order.total} р.\n\n👤 ${order.name}\n📞 ${order.phone}\n📍 ${order.addr||'—'}${order.fileUrl?'\n\n📎 '+order.fileUrl:''}`);

  res.json({ success: true, id: order._id });
});

// ========== ЗАКАЗЫ ПОЛЬЗОВАТЕЛЯ ==========
app.get('/api/orders/:userId', async (req, res) => {
  if (!ObjectId.isValid(req.params.userId)) return res.json([]);
  const orders = await db.collection('orders').find({ userId: req.params.userId }).sort({ createdAt: -1 }).toArray();
  res.json(orders.map(o => ({ ...o, id: o._id.toString() })));
});

// 🔐 АДМИН АВТОРИЗАЦИЯ (ОБЪЯВЛЯЕМ ТОЛЬКО ОДИН РАЗ)
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Admin2026!';

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASS) return res.status(401).json({ success: false, error: 'Неверный пароль' });
  res.json({ success: true, token: 'ok' });
});

const requireAdmin = (req, res, next) => {
  if (req.headers.authorization !== 'Bearer ok') return res.status(401).json({ error: 'Требуется авторизация' });
  next();
};

// ========== ВСЕ ЗАКАЗЫ (АДМИН) 🔐 ==========
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  const orders = await db.collection('orders').find().sort({ createdAt: -1 }).toArray();
  res.json(orders.map(o => ({ ...o, id: o._id.toString() })));
});

// ========== СМЕНА СТАТУСА 🔐 ==========
app.post('/api/admin/status', requireAdmin, async (req, res) => {
  const { orderId, status } = req.body;
  const order = await db.collection('orders').findOne({ _id: orderId });
  if (!order) return res.json({ success: false, error: 'Заказ не найден' });
  await db.collection('orders').updateOne({ _id: orderId }, { $set: { status } });
  sendTelegram(ADMIN_CHAT_ID, `📋 Статус заказа #${orderId}: ${statusNames[status] || status}`);
  if (order.userId && ObjectId.isValid(order.userId)) {
    try {
      const user = await db.collection('users').findOne({ _id: new ObjectId(order.userId) });
      if (user?.telegramId) {
        sendTelegram(user.telegramId, `📋 Ваш заказ #${orderId}\nСтатус: ${statusNames[status] || status}\nМатериал: ${order.material}`);
      }
      if (user?.pushSubs?.length > 0) {
        user.pushSubs.forEach(sub => {
          webpush.sendNotification(sub, JSON.stringify({ title: 'Статус заказа', body: `Заказ #${orderId}: ${statusNames[status] || status}`, url: '/' })).catch(() => {});
        });
      }
    } catch (e) {}
  }
  res.json({ success: true });
});

// ========== PUSH-ПОДПИСКА ==========
app.post('/api/push-subscribe', async (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription || !ObjectId.isValid(userId)) return res.json({ success: false });
  try {
    await db.collection('users').updateOne({ _id: new ObjectId(userId) }, { $addToSet: { pushSubs: subscription } });
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false });
  }
});

// ========== ВСЕ ПОЛЬЗОВАТЕЛИ ==========
app.get('/api/users', async (req, res) => {
  const users = await db.collection('users').find().toArray();
  res.json(users.map(u => ({
    id: u._id.toString(),
    email: u.email,
    name: u.name,
    phone: u.phone,
    telegramId: u.telegramId,
    blocked: u.blocked,
    createdAt: u.createdAt
  })));
});

// ========== ЧАТ ==========
app.get('/api/chat/:userId', async (req, res) => {
  if (!ObjectId.isValid(req.params.userId)) return res.json([]);
  const msgs = await db.collection('chat').find({ userId: req.params.userId }).sort({ time: 1 }).toArray();
  res.json(msgs);
});
app.post('/api/chat', async (req, res) => {
  const msg = { ...req.body, time: new Date() };
  await db.collection('chat').insertOne(msg);
  if (msg.from !== 'admin') {
    sendTelegram(ADMIN_CHAT_ID, `💬 Новое сообщение от клиента:\n${msg.text}`);
  }
  if (msg.from === 'admin' && msg.userId && ObjectId.isValid(msg.userId)) {
    try {
      const user = await db.collection('users').findOne({ _id: new ObjectId(msg.userId) });
      if (user?.telegramId) sendTelegram(user.telegramId, `💬 Поддержка:\n${msg.text}`);
      if (user?.pushSubs?.length > 0) {
        user.pushSubs.forEach(sub => {
          webpush.sendNotification(sub, JSON.stringify({ title: 'Новое сообщение', body: msg.text, url: '/' })).catch(() => {});
        });
      }
    } catch (e) {}
  }
  res.json({ success: true });
});

// ========== АДМИН: ЧАТЫ 🔐 ==========
app.get('/api/admin/chats', requireAdmin, async (req, res) => {
  const chat = db.collection('chat');
  const users = db.collection('users');
  const userIds = await chat.distinct('userId');
  const result = [];
  for (const uid of userIds) {
    if (!uid || !ObjectId.isValid(uid)) continue;
    let user = null;
    try { user = await users.findOne({ _id: new ObjectId(uid) }); } catch (e) { continue; }
    const lastMsg = await chat.findOne({ userId: uid }, { sort: { time: -1 } });
    result.push({
      userId: uid,
      name: user?.name || uid,
      email: user?.email || '',
      lastMessage: lastMsg?.text || '',
      lastTime: lastMsg?.time || null
    });
  }
  res.json(result);
});

// ========== УДАЛЕНИЕ ЗАКАЗА 🔐 ==========
app.delete('/api/admin/orders/:orderId', requireAdmin, async (req, res) => {
  await db.collection('orders').deleteOne({ _id: req.params.orderId });
  res.json({ success: true });
});

// ========== ОЧИСТКА ЧАТА 🔐 ==========
app.delete('/api/admin/chat/:userId', requireAdmin, async (req, res) => {
  if (ObjectId.isValid(req.params.userId)) {
    await db.collection('chat').deleteMany({ userId: req.params.userId });
  }
  res.json({ success: true });
});

// ========== ЦЕХА (СЕРВЕР) ==========
const workshopsFile = path.join(__dirname, 'workshops.json');
if (!fs.existsSync(workshopsFile)) {
  fs.writeFileSync(workshopsFile, JSON.stringify([{
    id: 'admiral',
    name: 'Типография Адмирал',
    email: 'aprint23@mail.ru',
    phone: '+79286609776',
    address: 'ул. Стасова, 178/1'
  }]));
}
app.get('/api/workshops', (req, res) => res.json(JSON.parse(fs.readFileSync(workshopsFile, 'utf8'))));
app.post('/api/workshops', (req, res) => {
  fs.writeFileSync(workshopsFile, JSON.stringify(req.body));
  res.json({ success: true });
});

// ========== ПРОЧИТАННЫЕ СООБЩЕНИЯ ==========
app.post('/api/chat/read', async (req, res) => {
  const { userId, count } = req.body;
  if (!userId || !ObjectId.isValid(userId)) return res.json({ success: false });
  await db.collection('users').updateOne({ _id: new ObjectId(userId) }, { $set: { chatRead: count } });
  res.json({ success: true });
});

// ========== РЕДАКТИРОВАНИЕ ПРОФИЛЯ ==========
app.put('/api/profile', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId || !ObjectId.isValid(userId)) return res.status(400).json({ success: false, error: 'Неверный ID' });
  const { name, phone } = req.body;
  const updateData = {};
  if (name && name.trim()) updateData.name = name.trim();
  if (phone && phone.trim()) updateData.phone = phone.trim();
  if (Object.keys(updateData).length === 0) return res.json({ success: false, error: 'Нет данных для обновления' });
  await db.collection('users').updateOne({ _id: new ObjectId(userId) }, { $set: updateData });
  res.json({ success: true, ...updateData });
});

// ========== СТАТИКА ДЛЯ ЗАГРУЗОК ==========
app.use('/uploads', express.static(uploadsDir));

// ========== ЗАПРЕТ ИНДЕКСАЦИИ АДМИНКИ ==========
app.get('/admin', (req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store, private');
  next();
});
app.get('/admin.html', (req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store, private');
  next();
});

// 🚀 ЗАПУСК СЕРВЕРА
app.listen(PORT, () => console.log('🚀 Server running on port', PORT));
