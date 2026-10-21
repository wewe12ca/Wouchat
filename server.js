const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Objeto para almacenar usuarios, sus notas y sus sockets
let connectedUsers = {}; // { socketId: { username, note } }

// Función auxiliar para obtener la hora formateada HH:MM
function getFormattedTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // Registro de usuario al unirse
    socket.on('join', (username) => {
        socket.username = username;
        connectedUsers[socket.id] = { username: username, note: '' };

        // Enviar la lista de usuarios estructurada
        io.emit('update_users', Object.values(connectedUsers));
        io.emit('notification', `${username} se ha unido al chat`);
    });

    // Reenviar mensajes del Chat General (Grupo)
    socket.on('chat_message', (data) => {
        io.emit('chat_message', {
            user: data.user,
            text: data.text,
            time: getFormattedTime()
        });
    });

    // Mensajes Privados (1 a 1)
    socket.on('private_message', (data) => {
        const recipientSocketId = Object.keys(connectedUsers).find(
            id => connectedUsers[id].username === data.targetUser
        );

        const payload = {
            sender: socket.username,
            target: data.targetUser,
            text: data.text,
            time: getFormattedTime()
        };

        // Enviar al destinatario
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('private_message', payload);
        }
        // Enviar al propio emisor
        socket.emit('private_message', payload);
    });

    // Estado / Nota estilo Instagram
    socket.on('set_note', (noteText) => {
        if (connectedUsers[socket.id]) {
            connectedUsers[socket.id].note = noteText.slice(0, 60);
            io.emit('update_users', Object.values(connectedUsers));
        }
    });

    // Eventos de "está escribiendo..."
    socket.on('typing', (data) => {
        socket.broadcast.emit('user_typing', {
            username: socket.username,
            target: data.target
        });
    });

    socket.on('stop_typing', (data) => {
        socket.broadcast.emit('user_stop_typing', {
            username: socket.username,
            target: data.target
        });
    });

    // Desconexión
    socket.on('disconnect', () => {
        if (socket.username) {
            delete connectedUsers[socket.id];
            io.emit('update_users', Object.values(connectedUsers));
            io.emit('notification', `${socket.username} ha abandonado el chat`);
        }
        console.log(`Usuario desconectado: ${socket.id}`);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor Wouchat activo en http://localhost:${PORT}`);
});