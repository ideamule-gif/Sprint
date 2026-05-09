const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.use(express.json({ limit: '50mb' }));

// Папка для файлов
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Файлы-базы
const usersFile = path.join(__dirname, 'users.json');
const ordersFile = path.join(__dirname, 'orders.json');
const chatFile = path.join(__dirname, 'chat.json');

if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, '[]');
if (!fs.existsSync(ordersFile)) fs.writeFileSync(ordersFile, '[]');
if (!fs.existsSync(chatFile)) fs.writeFileSync(chatFile, '[]');

function readJSON(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Главная
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Админка
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ========== РЕГИСТРАЦИЯ ==========
app.post('/api/register', (req, res) => {
    const { email, password, name, phone } = req.body;
    if (!email || !password) return res.json({ success: false, error: 'Email и пароль обязательны' });

    const users = readJSON(usersFile);
    if (users.find(u => u.email === email)) return res.json({ success: false, error: 'Email уже зарегистрирован' });

    const user = {
        id: 'U-' + Date.now(),
        email,
        password: crypto.createHash('sha256').update(password).digest('hex'),
        name: name || '',
        phone: phone || '',
        createdAt: new Date().toISOString()
    };
    users.push(user);
    writeJSON(usersFile, users);
    res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, phone: user.phone } });
});

// ========== ВХОД ==========
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.json({ success: false, error: 'Email и пароль обязательны' });

    const users = readJSON(usersFile);
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const user = users.find(u => u.email === email && u.password === hash);
    if (!user) return res.json({ success: false, error: 'Неверный email или пароль' });

    res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, phone: user.phone } });
});

// ========== ЗАКАЗ ==========
app.post('/api/order', (req, res) => {
    const order = req.body;
    const orders = readJSON(ordersFile);
    const lastId = orders.length > 0 ? parseInt(orders[0].id) || 0 : 0;
    order.id = String(lastId + 1).padStart(6, '0');
    order.status = 'new';
    order.createdAt = new Date().toISOString();

    // Сохраняем файл если есть
    if (order.fileBase64 && order.fileName) {
        const buffer = Buffer.from(order.fileBase64, 'base64');
        const filePath = path.join(uploadsDir, order.id + '_' + order.fileName);
        fs.writeFileSync(filePath, buffer);
        order.filePath = filePath;
        order.fileUrl = `/uploads/${order.id}_${order.fileName}`;
    }
    delete order.fileBase64;

    orders.unshift(order);
    writeJSON(ordersFile, orders);

    // Telegram
    const botToken = '8727458645:AAEp0YLowPJYs9FirMYDFM9votOm9vOZieU';
    const chatId = '7656839845';
    const extrasText = order.extras && order.extras.length > 0 ? order.extras.map(e => `${e.name}: ${Math.round(e.cost)} р.`).join(', ') : 'Нет';
    const msg = `🔵 НОВЫЙ ЗАКАЗ #${order.id}\n\n📦 ${order.material}\n📐 ${order.width}×${order.height} мм\n🔢 ${order.qty} шт (${(order.totalArea||0).toFixed(2)} м²)\n🔧 ${extrasText}\n🚕 Доставка: 300 р.\n💰 Сумма: ${order.total} р.\n\n👤 ${order.name}\n📞 ${order.phone}\n📱 TG: ${order.tg||'—'}\n📧 ${order.email||'—'}\n📍 ${order.addr||'—'}${order.fileUrl?'\n\n📎 '+order.fileUrl:''}\n\n⚠️ Выставьте счёт в «Мой налог»`;
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg })
    }).catch(() => {});

    res.json({ success: true, id: order.id });
});

// ========== ЗАКАЗЫ ПОЛЬЗОВАТЕЛЯ ==========
app.get('/api/orders/:userId', (req, res) => {
    const orders = readJSON(ordersFile);
    const userOrders = orders.filter(o => o.userId === req.params.userId);
    res.json(userOrders);
});

// ========== ВСЕ ЗАКАЗЫ (АДМИН) ==========
app.get('/api/admin/orders', (req, res) => {
    res.json(readJSON(ordersFile));
});

// ========== СМЕНА СТАТУСА ==========
app.post('/api/admin/status', (req, res) => {
    const { orderId, status } = req.body;
    const orders = readJSON(ordersFile);
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.json({ success: false, error: 'Заказ не найден' });
    order.status = status;
    writeJSON(ordersFile, orders);
    res.json({ success: true });
});

// ========== ВСЕ ПОЛЬЗОВАТЕЛИ (АДМИН) ==========
app.get('/api/users', (req, res) => {
    const users = readJSON(usersFile);
    const safeUsers = users.map(u => ({ id: u.id, email: u.email, name: u.name, phone: u.phone, createdAt: u.createdAt }));
    res.json(safeUsers);
});

// ========== ЧАТ ==========
app.get('/api/chat', (req, res) => {
    res.json(readJSON(chatFile));
});

app.post('/api/chat', (req, res) => {
    const msg = { ...req.body, time: new Date().toISOString() };
    const msgs = readJSON(chatFile);
    msgs.push(msg);
    writeJSON(chatFile, msgs);
    res.json({ success: true });
});

// Статические файлы (uploads)
app.use('/uploads', express.static(uploadsDir));

app.listen(PORT, () => console.log('Server running on port', PORT));
