const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/order', (req, res) => {
    const fs = require('fs');
    const order = req.body;
    order.id = 'Z-' + Date.now();
    order.createdAt = new Date().toISOString();

    // Сохраняем в файл
    const orders = JSON.parse(fs.readFileSync('orders.json', 'utf8') || '[]');
    orders.unshift(order);
    fs.writeFileSync('orders.json', JSON.stringify(orders, null, 2));

    // Отправляем в Telegram
    const botToken = '8727458645:AAEp0YLowPJYs9FirMYDFM9votOm9vOZieU';
    const chatId = '7656839845';
    const msg = `🔵 НОВЫЙ ЗАКАЗ\n\n📦 ${order.material}\n📐 ${order.width}×${order.height} мм\n🔢 ${order.qty} шт\n💰 ${order.total} р.\n\n👤 ${order.name}\n📞 ${order.phone}\n📱 TG: ${order.tg||'—'}\n📍 ${order.addr||'—'}`;

    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg })
    }).catch(() => {});

    res.json({ success: true, id: order.id });
});

app.listen(PORT, () => console.log('Server running on port', PORT));
