const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient, ServerApiVersion } = require('mongodb');
const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB
const MONGO_URI = 'mongodb+srv://ideamule_db_user:BUFRqKh9raaJ8vyA@sprint.nygqpkm.mongodb.net/?appName=Sprint';
const client = new MongoClient(MONGO_URI, { serverApi: ServerApiVersion.v1 });

let db;
async function connectDB() {
    try {
        await client.connect();
        db = client.db('sprint');
        console.log('MongoDB connected');
    } catch (e) {
        console.error('MongoDB connection error:', e.message);
    }
}
connectDB();

app.use(async (req, res, next) => {
    if (!db) {
        try { await client.connect(); db = client.db('sprint'); } catch (e) { return res.status(500).json({ error: 'База данных недоступна' }); }
    }
    next();
});

app.use(express.static(__dirname));
app.use(express.json({ limit: '50mb' }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// EmailJS конфиг
const EMAILJS = {
    service_id: 'service_6g06b1d',
    template_id: 'template_hb05foo',
    user_id: '1uNqFkbGPhecG4EaK'
};

async function sendEmail(toEmail, params) {
    try {
        await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: EMAILJS.service_id,
                template_id: EMAILJS.template_id,
                user_id: EMAILJS.user_id,
                template_params: { ...params, email: toEmail }
            })
        });
    } catch (e) {
        console.error('EmailJS error:', e.message);
    }
}

const statusNames = { 'new': 'Новый', 'processing': 'В обработке', 'printing': 'В печати', 'ready': 'Готов', 'shipped': 'Отправлен', 'done': 'Доставлен' };

// Главная
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ========== РЕГИСТРАЦИЯ ==========
app.post('/api/register', async (req, res) => {
    const { email, password, name, phone } = req.body;
    if (!email || !password) return res.json({ success: false, error: 'Email и пароль обязательны' });
    const users = db.collection('users');
    if (await users.findOne({ email })) return res.json({ success: false, error: 'Email уже зарегистрирован' });
    const user = { email, password: crypto.createHash('sha256').update(password).digest('hex'), name: name || '', phone: phone || '', createdAt: new Date() };
    const result = await users.insertOne(user);
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

// ========== ЗАКАЗ ==========
app.post('/api/order', async (req, res) => {
    const order = req.body;
    const orders = db.collection('orders');
    const count = await orders.countDocuments();
    order._id = String(count + 1).padStart(6, '0');
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

    const botToken = '8727458645:AAEp0YLowPJYs9FirMYDFM9votOm9vOZieU';
    const extrasText = order.extras?.length > 0 ? order.extras.map(e => `${e.name}: ${Math.round(e.cost)} р.`).join(', ') : 'Нет';
    const msg = `🔵 НОВЫЙ ЗАКАЗ #${order._id}\n\n📦 ${order.material}\n📐 ${order.width}×${order.height} мм\n🔢 ${order.qty} шт\n🔧 ${extrasText}\n🚕 Доставка: 300 р.\n💰 Сумма: ${order.total} р.\n\n👤 ${order.name}\n📞 ${order.phone}\n📍 ${order.addr||'—'}${order.fileUrl?'\n\n📎 '+order.fileUrl:''}`;
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: '7656839845', text: msg }) }).catch(() => {});

    res.json({ success: true, id: order._id });
});

// ========== ЗАКАЗЫ ПОЛЬЗОВАТЕЛЯ ==========
app.get('/api/orders/:userId', async (req, res) => {
    const orders = await db.collection('orders').find({ userId: req.params.userId }).sort({ createdAt: -1 }).toArray();
    res.json(orders.map(o => ({ ...o, id: o._id })));
});

// ========== ВСЕ ЗАКАЗЫ (АДМИН) ==========
app.get('/api/admin/orders', async (req, res) => {
    const orders = await db.collection('orders').find().sort({ createdAt: -1 }).toArray();
    res.json(orders.map(o => ({ ...o, id: o._id })));
});

// ========== СМЕНА СТАТУСА ==========
app.post('/api/admin/status', async (req, res) => {
    const { orderId, status } = req.body;
    const orders = db.collection('orders');
    const order = await orders.findOne({ _id: orderId });
    if (!order) return res.json({ success: false, error: 'Заказ не найден' });
    await orders.updateOne({ _id: orderId }, { $set: { status } });

    const params = { order_id: order._id, status: statusNames[status] || status, material: order.material, size: `${order.width}×${order.height} мм`, total: order.total, name: order.name };
    if (order.email) sendEmail(order.email, params);
    sendEmail('ideamule@gmail.com', { ...params, name: 'Админ' });

    res.json({ success: true });
});

// ========== ВСЕ ПОЛЬЗОВАТЕЛИ ==========
app.get('/api/users', async (req, res) => {
    const users = await db.collection('users').find().toArray();
    res.json(users.map(u => ({ id: u._id.toString(), email: u.email, name: u.name, phone: u.phone, createdAt: u.createdAt })));
});

// ========== ЧАТ (по userId) ==========
app.get('/api/chat/:userId', async (req, res) => {
    const msgs = await db.collection('chat').find({ userId: req.params.userId }).sort({ time: 1 }).toArray();
    res.json(msgs);
});

app.post('/api/chat', async (req, res) => {
    const msg = { ...req.body, time: new Date() };
    await db.collection('chat').insertOne(msg);

    // Уведомление на почту
    if (msg.from !== 'admin') {
        sendEmail('ideamule@gmail.com', { order_id: 'Чат', name: 'Новое сообщение', status: msg.text, material: msg.from, size: '', total: '' });
    } else if (msg.userId) {
        const user = await db.collection('users').findOne({ _id: require('mongodb').ObjectId.createFromHexString(msg.userId) }).catch(() => null);
        if (user?.email) sendEmail(user.email, { order_id: 'Чат', name: user.name || 'Клиент', status: 'Новое сообщение от поддержки', material: msg.text, size: '', total: '' });
    }
    res.json({ success: true });
});

// ========== ВСЕ ЧАТЫ (АДМИН - список пользователей с сообщениями) ==========
app.get('/api/admin/chats', async (req, res) => {
    const chat = db.collection('chat');
    const users = db.collection('users');
    const userIds = await chat.distinct('userId');
    const result = [];
    for (const uid of userIds) {
        if (!uid) continue;
        const user = await users.findOne({ _id: require('mongodb').ObjectId.createFromHexString(uid) }).catch(() => null);
        const lastMsg = await chat.findOne({ userId: uid }, { sort: { time: -1 } });
        result.push({ userId: uid, name: user?.name || user?.email || uid, email: user?.email || '', lastMessage: lastMsg?.text || '', lastTime: lastMsg?.time || null });
    }
    res.json(result);
});

app.use('/uploads', express.static(uploadsDir));
app.listen(PORT, () => console.log('Server running on port', PORT));
