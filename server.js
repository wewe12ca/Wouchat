const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir la carpeta 'public' como archivos estáticos
app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // Escuchar el evento de mensaje del chat
    socket.on('chat_message', (data) => {
        io.emit('chat_message', data); // Reenviar el mensaje a todos los conectados
    });

    socket.on('disconnect', () => {
        console.log(`Usuario desconectado: ${socket.id}`);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor activo en http://localhost:${PORT}`);
});