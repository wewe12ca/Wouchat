const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Array para almacenar los nombres de los usuarios conectados
let connectedUsers = [];

io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // Cuando un usuario envía su nombre al entrar
    socket.on('join', (username) => {
        socket.username = username;
        connectedUsers.push(username);

        // Notificar a todos la lista actualizada de usuarios y el aviso de entrada
        io.emit('update_users', connectedUsers);
        io.emit('notification', `${username} se ha unido al chat`);
    });

    // Reenviar mensajes de chat
    socket.on('chat_message', (data) => {
        io.emit('chat_message', data);
    });

    // Cuando se desconecta
    socket.on('disconnect', () => {
        if (socket.username) {
            // Eliminar al usuario del array
            const index = connectedUsers.indexOf(socket.username);
            if (index !== -1) {
                connectedUsers.splice(index, 1);
            }

            // Actualizar la lista y notificar salida
            io.emit('update_users', connectedUsers);
            io.emit('notification', `${socket.username} ha abandonado el chat`);
        }
        console.log(`Usuario desconectado: ${socket.id}`);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor activo en http://localhost:${PORT}`);
});