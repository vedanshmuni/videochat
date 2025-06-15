const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true
}));

const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Store waiting users with their interests
let waitingUsers = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle user joining with interests
    socket.on('join', (interests) => {
        let foundMatch = false;
        for (let [waitingSocket, waitingInterests] of waitingUsers.entries()) {
            if (
                waitingSocket.id !== socket.id && // Prevent self-matching
                (!interests || !waitingInterests || 
                interests.some(interest => waitingInterests.includes(interest)))
            ) {
                waitingUsers.delete(waitingSocket);
                socket.join(waitingSocket.id);
                waitingSocket.join(socket.id);
                io.to(socket.id).emit('partner-found', { partnerId: waitingSocket.id, role: 'offerer' });
                io.to(waitingSocket.id).emit('partner-found', { partnerId: socket.id, role: 'answerer' });
                console.log('Matched', socket.id, '(offerer) with', waitingSocket.id, '(answerer)');
                foundMatch = true;
                break;
            }
        }
        if (!foundMatch) {
            waitingUsers.set(socket, interests || []);
            console.log('User waiting:', socket.id, 'Current waiting:', Array.from(waitingUsers.keys()).map(s => s.id));
        }
    });

    // Handle text messages
    socket.on('text-message', (data) => {
        io.to(data.target).emit('text-message', {
            message: data.message,
            sender: socket.id
        });
    });

    // Handle offer
    socket.on('offer', (data) => {
        console.log('Relaying offer from', socket.id, 'to', data.target);
        io.to(data.target).emit('offer', {
            sdp: data.sdp,
            target: socket.id
        });
    });

    // Handle answer
    socket.on('answer', (data) => {
        console.log('Relaying answer from', socket.id, 'to', data.target);
        io.to(data.target).emit('answer', {
            sdp: data.sdp,
            target: socket.id
        });
    });

    // Handle ICE candidate
    socket.on('ice-candidate', (data) => {
        console.log('Relaying ICE candidate from', socket.id, 'to', data.target);
        io.to(data.target).emit('ice-candidate', {
            candidate: data.candidate,
            target: socket.id
        });
    });

    // Handle next request
    socket.on('next', () => {
        const rooms = Array.from(socket.rooms);
        const currentPartner = rooms.find(room => room !== socket.id);
        if (currentPartner) {
            io.to(currentPartner).emit('partner-left');
            socket.leave(currentPartner);
        }
        const interests = waitingUsers.get(socket) || [];
        waitingUsers.set(socket, interests);
        socket.emit('join', interests);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        waitingUsers.delete(socket);
        const rooms = Array.from(socket.rooms);
        const partner = rooms.find(room => room !== socket.id);
        if (partner) {
            io.to(partner).emit('partner-left');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 