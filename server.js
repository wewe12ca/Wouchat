const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // Cuando el usuario entra y envía su nombre
    socket.on('join', (username) => {
        socket.username = username;
        // Broadcast para avisar a los demás que se ha unido
        io.emit('notification', `${username} se ha unido al chat`);
    });

    // Escuchar y reenviar mensajes
    socket.on('chat_message', (data) => {
        io.emit('chat_message', data);
    });

    // Cuando se desconecta
    socket.on('disconnect', () => {
        if (socket.username) {
            io.emit('notification', `${socket.username} ha abandonado el chat`);
        }
        console.log(`Usuario desconectado: ${socket.id}`);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor activo en http://localhost:${PORT}`);
});