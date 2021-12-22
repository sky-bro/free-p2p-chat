const path = require("path");
const http = require("http");
const express = require("express");

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "../public");

app.use(express.static(publicDir));

let count = 0;

io.on("connection", (socket) => {
    socket.emit("countUpdated", ++count);

    socket.on("disconnecting", () => {
        socket.rooms.forEach(room => {
            socket.to(room).emit("message", `A peer left room "${room}".`);
        });
    })

    socket.on("disconnect", () => --count);

    // server just relays the msg
    socket.on("message", (room, msg) => {
        if (!socket.rooms.has(room)) return;
        socket.to(room).emit("message", msg);
    });

    socket.on("create or join", (roomName, userName, callback) => {
        var clientsInRoom = io.sockets.adapter.rooms.get(roomName);
        var numClients = clientsInRoom ? clientsInRoom.size : 0;
        if (numClients < 2) socket.join(roomName);
        if (numClients === 0) {
            callback(true, "created");
        } else if (numClients === 1) {
            callback(true, "joined");
            io.sockets.in(roomName).emit('ready');
        } else { // at most two clients for each room
            callback(false, "room is full");
        }
    });
})

server.listen(port, () => {
    console.log(`Server is up on port ${port}!`);
})
