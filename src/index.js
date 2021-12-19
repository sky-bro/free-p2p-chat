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

    socket.on("disconnect", () => {
        --count;
    });

    // server simply relay the msg to every one (except the sender) in the room
    socket.on("message", (room, msg) => {
        if (!socket.rooms.has(room)) return;
        socket.broadcast.in(room).emit("message", msg);
    });

    socket.on("create or join", (roomName, userName) => {
        console.log(roomName);
        var clientsInRoom = io.sockets.adapter.rooms.get(roomName);
        var numClients = clientsInRoom ? clientsInRoom.size : 0;

        if (numClients === 0) { // create room
            socket.join(roomName);
            console.log(io.sockets.adapter.rooms)
            socket.emit("created", roomName, userName);
        } else if (numClients === 1) { // join room
            socket.join(roomName);
            socket.emit('joined', roomName, userName);
            // after being ready, every one in the room can start the call
            io.sockets.in(roomName).emit('ready');
        } else { // max two clients
            socket.emit('full', roomName);
        }
    });
})


server.listen(port, () => {
    console.log(`Server is up on port ${port}!`);
})
