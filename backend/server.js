const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Store waiting users with their interests
let waitingUsers = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle user joining with interests
    socket.on('join', (interests) => {
        // Find a matching partner based on interests
        let foundMatch = false;
        for (let [waitingSocket, waitingInterests] of waitingUsers.entries()) {
            // If interests match or either user has no interests
            if (!interests || !waitingInterests || 
                interests.some(interest => waitingInterests.includes(interest))) {
                waitingUsers.delete(waitingSocket);
                socket.join(waitingSocket.id);
                waitingSocket.join(socket.id);
                
                // Notify both users they are connected
                io.to(socket.id).emit('partner-found', waitingSocket.id);
                io.to(waitingSocket.id).emit('partner-found', socket.id);
                foundMatch = true;
                break;
            }
        }

        if (!foundMatch) {
            // If no match found, add to waiting list
            waitingUsers.set(socket, interests || []);
        }
    });

    // Handle text messages
    socket.on('text-message', (data) => {
        io.to(data.target).emit('text-message', {
            message: data.message,
            sender: socket.id
        });
    });

    // Handle WebRTC signaling
    socket.on('offer', (data) => {
        io.to(data.target).emit('offer', {
            sdp: data.sdp,
            target: socket.id
        });
    });

    socket.on('answer', (data) => {
        io.to(data.target).emit('answer', {
            sdp: data.sdp,
            target: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.target).emit('ice-candidate', {
            candidate: data.candidate,
            target: socket.id
        });
    });

    // Handle next request
    socket.on('next', () => {
        // Find current partner
        const rooms = Array.from(socket.rooms);
        const currentPartner = rooms.find(room => room !== socket.id);
        
        if (currentPartner) {
            // Notify current partner
            io.to(currentPartner).emit('partner-left');
            // Leave current room
            socket.leave(currentPartner);
        }

        // Add to waiting list with previous interests
        const interests = waitingUsers.get(socket) || [];
        waitingUsers.set(socket, interests);
        
        // Try to find new match
        socket.emit('join', interests);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Remove from waiting list if present
        waitingUsers.delete(socket);
        
        // Notify partner if in a chat
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