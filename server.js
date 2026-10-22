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

// 1. Conexión e Inicialización de SQLite
const dbPath = path.join(__dirname, 'wouchat.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error al conectar con SQLite:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite (wouchat.db)');
    }
});

// Crear tablas en la base de datos
db.serialize(() => {
    // Tabla de Usuarios
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            note TEXT DEFAULT ''
        )
    `);

    // Tabla de Mensajes
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

    // Tabla de Estados (Novedades / Historias)
    db.run(`
        CREATE TABLE IF NOT EXISTS statuses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            media_url TEXT NOT NULL,
            caption TEXT DEFAULT '',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

let connectedUsers = {}; // { socketId: { username, note } }

function getFormattedTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// 2. Rutas API REST para Autenticación
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = `INSERT INTO users (username, password) VALUES (?, ?)`;
        db.run(sql, [username.trim(), hashedPassword], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'El nombre de usuario ya existe' });
                }
                return res.status(500).json({ error: 'Error al registrar el usuario' });
            }
            res.json({ success: true, message: 'Usuario registrado correctamente' });
        });
    } catch (e) {
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    const sql = `SELECT * FROM users WHERE username = ?`;
    db.get(sql, [username.trim()], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });

        res.json({ success: true, username: user.username, note: user.note });
    });
});

// 3. Conexiones Socket.io en Tiempo Real
io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    socket.on('join', (username) => {
        socket.username = username;
        db.get(`SELECT note FROM users WHERE username = ?`, [username], (err, row) => {
            const userNote = row ? row.note : '';
            connectedUsers[socket.id] = { username: username, note: userNote };
            io.emit('update_users', Object.values(connectedUsers));
            io.emit('notification', `${username} se ha unido al chat`);
        });
    });

    socket.on('get_history', (target) => {
        let sql = '';
        let params = [];
        if (target === 'GLOBAL') {
            sql = `SELECT sender, target, text, time FROM messages WHERE target = 'GLOBAL' ORDER BY id ASC LIMIT 100`;
        } else {
            sql = `SELECT sender, target, text, time FROM messages 
                   WHERE (sender = ? AND target = ?) OR (sender = ? AND target = ?) 
                   ORDER BY id ASC LIMIT 100`;
            params = [socket.username, target, target, socket.username];
        }

        db.all(sql, params, (err, rows) => {
            if (!err && rows) {
                socket.emit('chat_history', { target: target, messages: rows });
            }
        });
    });

    socket.on('chat_message', (data) => {
        const timeStr = getFormattedTime();
        const sql = `INSERT INTO messages (sender, target, text, time) VALUES (?, 'GLOBAL', ?, ?)`;
        db.run(sql, [data.user, data.text, timeStr], function(err) {
            if (!err) {
                io.emit('chat_message', { user: data.user, text: data.text, time: timeStr });
            }
        });
    });

    socket.on('private_message', (data) => {
        const timeStr = getFormattedTime();
        const sql = `INSERT INTO messages (sender, target, text, time) VALUES (?, ?, ?, ?)`;
        db.run(sql, [socket.username, data.targetUser, data.text, timeStr], function(err) {
            if (!err) {
                const recipientSocketId = Object.keys(connectedUsers).find(
                    id => connectedUsers[id].username === data.targetUser
                );
                const payload = { sender: socket.username, target: data.targetUser, text: data.text, time: timeStr };
                if (recipientSocketId) io.to(recipientSocketId).emit('private_message', payload);
                socket.emit('private_message', payload);
            }
        });
    });

    // Gestión de Estados
    socket.on('post_status', (data) => {
        const sql = `INSERT INTO statuses (username, media_url, caption) VALUES (?, ?, ?)`;
        db.run(sql, [socket.username, data.media_url, data.caption], function(err) {
            if (!err) {
                io.emit('new_status', { id: this.lastID, username: socket.username, media_url: data.media_url, caption: data.caption });
            }
        });
    });

    socket.on('get_statuses', () => {
        const sql = `SELECT * FROM statuses ORDER BY id DESC LIMIT 20`;
        db.all(sql, [], (err, rows) => {
            if (!err && rows) {
                socket.emit('statuses_list', rows);
            }
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

    socket.on('typing', (data) => {
        socket.broadcast.emit('user_typing', { username: socket.username, target: data.target });
    });

    socket.on('stop_typing', (data) => {
        socket.broadcast.emit('user_stop_typing', { username: socket.username, target: data.target });
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            delete connectedUsers[socket.id];
            io.emit('update_users', Object.values(connectedUsers));
            io.emit('notification', `${socket.username} ha abandonado el chat`);
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Servidor Wouchat activo en http://localhost:${PORT}`));