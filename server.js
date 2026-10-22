const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

const dbPath = path.join(__dirname, 'wouchat.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error al conectar con SQLite:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite (wouchat.db)');
    }
});

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            note TEXT DEFAULT ''
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT NOT NULL,
            target TEXT NOT NULL,
            text TEXT NOT NULL,
            time TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS statuses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            text TEXT NOT NULL,
            bg_color TEXT DEFAULT '#00a884',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

let connectedUsers = {};

function getFormattedTime() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username.trim(), hashedPassword], function(err) {
            if (err) return res.status(400).json({ error: 'El nombre de usuario ya existe' });
            res.json({ success: true });
        });
    } catch (e) {
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Datos requeridos' });

    db.get(`SELECT * FROM users WHERE username = ?`, [username.trim()], async (err, user) => {
        if (err || !user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
        }
        res.json({ success: true, username: user.username, note: user.note });
    });
});

io.on('connection', (socket) => {
    socket.on('join', (username) => {
        socket.username = username;
        db.get(`SELECT note FROM users WHERE username = ?`, [username], (err, row) => {
            connectedUsers[socket.id] = { username, note: row ? row.note : '' };
            io.emit('update_users', Object.values(connectedUsers));
        });
    });

    socket.on('get_history', (target) => {
        let sql = target === 'GLOBAL' 
            ? `SELECT sender, target, text, time FROM messages WHERE target = 'GLOBAL' ORDER BY id ASC LIMIT 100`
            : `SELECT sender, target, text, time FROM messages WHERE (sender = ? AND target = ?) OR (sender = ? AND target = ?) ORDER BY id ASC LIMIT 100`;
        let params = target === 'GLOBAL' ? [] : [socket.username, target, target, socket.username];

        db.all(sql, params, (err, rows) => {
            if (!err && rows) socket.emit('chat_history', { target, messages: rows });
        });
    });

    socket.on('chat_message', (data) => {
        const timeStr = getFormattedTime();
        db.run(`INSERT INTO messages (sender, target, text, time) VALUES (?, 'GLOBAL', ?, ?)`, [data.user, data.text, timeStr], function(err) {
            if (!err) io.emit('chat_message', { user: data.user, text: data.text, time: timeStr });
        });
    });

    socket.on('private_message', (data) => {
        const timeStr = getFormattedTime();
        db.run(`INSERT INTO messages (sender, target, text, time) VALUES (?, ?, ?, ?)`, [socket.username, data.targetUser, data.text, timeStr], function(err) {
            if (!err) {
                const recipientId = Object.keys(connectedUsers).find(id => connectedUsers[id].username === data.targetUser);
                const payload = { sender: socket.username, target: data.targetUser, text: data.text, time: timeStr };
                if (recipientId) io.to(recipientId).emit('private_message', payload);
                socket.emit('private_message', payload);
            }
        });
    });

    socket.on('post_status', (data) => {
        db.run(`INSERT INTO statuses (username, text, bg_color) VALUES (?, ?, ?)`, [socket.username, data.text, data.bg_color], function(err) {
            if (!err) {
                io.emit('new_status', { id: this.lastID, username: socket.username, text: data.text, bg_color: data.bg_color });
            }
        });
    });

    socket.on('get_statuses', () => {
        db.all(`SELECT * FROM statuses ORDER BY id DESC LIMIT 20`, [], (err, rows) => {
            if (!err && rows) socket.emit('statuses_list', rows);
        });
    });

    socket.on('set_note', (noteText) => {
        const cleanNote = noteText.slice(0, 60);
        db.run(`UPDATE users SET note = ? WHERE username = ?`, [cleanNote, socket.username], (err) => {
            if (!err && connectedUsers[socket.id]) {
                connectedUsers[socket.id].note = cleanNote;
                io.emit('update_users', Object.values(connectedUsers));
            }
        });
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            delete connectedUsers[socket.id];
            io.emit('update_users', Object.values(connectedUsers));
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Servidor Wouchat activo en http://localhost:${PORT}`));