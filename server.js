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
    await client.connect();
    db = client.db('sprint');
    console.log('MongoDB connected');
}
connectDB();

app.use(express.static(__dirname));
app.use(express.json({ limit: '50mb' }));

// Папка для файлов
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

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

    // Telegram
    const botToken = '8727458645:AAEp0YLowPJYs9FirMYDFM9votOm9vOZieU';
    const chatId = '7656839845';
    const extrasText = order.extras?.length > 0 ? order.extras.map(e => `${e.name}: ${Math.round(e.cost)} р.`).join(', ') : 'Нет';
    const msg = `🔵 НОВЫЙ ЗАКАЗ #${order._id}\n\n📦 ${order.material}\n📐 ${order.width}×${order.height} мм\n🔢 ${order.qty} шт\n🔧 ${extrasText}\n🚕 Доставка: 300 р.\n💰 Сумма: ${order.total} р.\n\n👤 ${order.name}\n📞 ${order.phone}\n📍 ${order.addr||'—'}${order.fileUrl?'\n\n📎 '+order.fileUrl:''}`;
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg })
    }).catch(() => {});

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
    await db.collection('orders').updateOne({ _id: orderId }, { $set: { status } });
    res.json({ success: true });
});

// ========== ВСЕ ПОЛЬЗОВАТЕЛИ ==========
app.get('/api/users', async (req, res) => {
    const users = await db.collection('users').find().toArray();
    res.json(users.map(u => ({ id: u._id.toString(), email: u.email, name: u.name, phone: u.phone, createdAt: u.createdAt })));
});

// ========== ЧАТ ==========
app.get('/api/chat', async (req, res) => {
    res.json(await db.collection('chat').find().sort({ time: 1 }).toArray());
});

app.post('/api/chat', async (req, res) => {
    const msg = { ...req.body, time: new Date() };
    await db.collection('chat').insertOne(msg);
    res.json({ success: true });
});

app.use('/uploads', express.static(uploadsDir));
app.listen(PORT, () => console.log('Server running on port', PORT));
