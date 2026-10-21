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

    socket.on('join', (username) => {
        socket.username = username;
        connectedUsers.push(username);
        
        // Enviar la lista actualizada de usuarios a todos
        io.emit('update_users', connectedUsers);
        io.emit('notification', `${username} se ha unido al chat`);
    });

    socket.on('chat_message', (data) => {
        io.emit('chat_message', data);
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            // Eliminar al usuario de la lista
            connectedUsers = connectedUsers.filter(user => user !== socket.username);
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