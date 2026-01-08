// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

// Load players
let MASTER_PLAYERS = JSON.parse(fs.readFileSync("shuffled_players.json", "utf8"));

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static("public"));

/* ====================================
   ROOM STATE
==================================== */
let rooms = {};

/* ====================================
   HELPERS
==================================== */
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function resetTimers(room) {
  if (room.initialTimer) clearInterval(room.initialTimer);
  if (room.bidTimer) clearInterval(room.bidTimer);
  room.initialTimer = null;
  room.bidTimer = null;
  room.initialTimeLeft = 60;
  room.bidTimeLeft = 30;
  room.skippedPlayers = [];
}

function pushLog(room, type, text) {
  room.log.push({ type, text });
}

function broadcastRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("roomState", {
    players: room.players,
    hostId: room.hostId,
    currentPlayer: room.currentPlayer,
    currentPosition: room.currentPosition,
    currentBid: room.currentBid,
    currentBidder: room.currentBidder,
    initialTimeLeft: room.initialTimeLeft,
    bidTimeLeft: room.bidTimeLeft,
    auctionActive: room.auctionActive,
    spinInProgress: room.spinInProgress,
    log: room.log
  });
}

/* ====================================
   END PLAYER
==================================== */
function endPlayer(roomId, sold) {
  const room = rooms[roomId];
  const player = room.currentPlayer;

  if (sold && room.currentBidder && player) {
    const w = room.players[room.currentBidder];
    w.team.push({ name: player.name, price: room.currentBid });
    w.balance -= room.currentBid;
    pushLog(room, "win", `${w.name} won ${player.name} for ${room.currentBid}M`);
  } else if (player) {
    room.unsoldPlayers.unshift(player);
    pushLog(room, "unsold", `${player.name} was unsold`);
  }

  room.currentPlayer = null;
  room.currentBid = 0;
  room.currentBidder = null;
  room.currentPosition = null;
  room.auctionActive = false;
  resetTimers(room);
  broadcastRoomState(roomId);
}

/* ====================================
   SOCKET LOGIC
==================================== */
io.on("connection", (socket) => {

  /* CREATE ROOM */
  socket.on("createRoom", (name) => {
    const roomId = generateRoomId();

    rooms[roomId] = {
      hostId: socket.id,
      players: {},
      availablePlayers: JSON.parse(JSON.stringify(MASTER_PLAYERS)),
      unsoldPlayers: [],
      skippedPlayers: [],
      currentPlayer: null,
      currentPosition: null,
      currentBid: 0,
      currentBidder: null,
      initialTimer: null,
      bidTimer: null,
      initialTimeLeft: 60,
      bidTimeLeft: 30,
      auctionActive: false,
      spinInProgress: false,
      log: []
    };

    rooms[roomId].players[socket.id] = {
      name,
      balance: 1000,
      team: [],
      active: true
    };

    socket.join(roomId);
    socket.emit("roomJoined", roomId);
    broadcastRoomState(roomId);
  });

  /* JOIN ROOM */
  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("error", "Room not found");

    room.players[socket.id] = {
      name,
      balance: 1000,
      team: [],
      active: true
    };

    socket.join(roomId);
    socket.emit("roomJoined", roomId);
    broadcastRoomState(roomId);
  });

  /* BID */
  socket.on("bid", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive) return;

    if (room.skippedPlayers.includes(socket.id)) {
      return socket.emit("error", "You skipped this round.");
    }

    const me = room.players[socket.id];
    if (!me) return;

    let nextBid =
      room.currentBid === 0
        ? room.currentPlayer.basePrice
        : room.currentBid < 200
        ? room.currentBid + 5
        : room.currentBid + 10;

    if (me.balance < nextBid) return;

    if (room.currentBid === 0 && room.initialTimer) {
      clearInterval(room.initialTimer);
    }

    room.currentBid = nextBid;
    room.currentBidder = socket.id;
    pushLog(room, "info", `${me.name} bid ${nextBid}M`);
    broadcastRoomState(roomId);
  });

  /* ================================
     SKIP — FIXED & FINAL
  ================================= */
  socket.on("skip", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive) return;

    // ❌ CURRENT BIDDER CANNOT SKIP
    if (socket.id === room.currentBidder) {
      return socket.emit("error", "Highest bidder cannot skip.");
    }

    if (!room.skippedPlayers.includes(socket.id)) {
      room.skippedPlayers.push(socket.id);
      pushLog(room, "skip", `${room.players[socket.id].name} skipped`);
    }

    const totalPlayers = Object.keys(room.players).length;
    const skippedCount = room.skippedPlayers.length;

    // 🔹 CASE 1: NO BIDS + EVERYONE SKIPPED → UNSOLD
    if (room.currentBid === 0 && skippedCount === totalPlayers) {
      endPlayer(roomId, false);
      return;
    }

    // 🔹 CASE 2: BIDS EXIST + ONLY HIGHEST BIDDER LEFT → WIN
    if (
      room.currentBid > 0 &&
      skippedCount === totalPlayers - 1 &&
      room.currentBidder
    ) {
      endPlayer(roomId, true);
      return;
    }

    broadcastRoomState(roomId);
  });

  /* DISCONNECT */
  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players[socket.id]) {
        room.players[socket.id].active = false;
      }
      broadcastRoomState(roomId);
    }
  });

});

/* ====================================
   START SERVER
==================================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log("Server running on port " + PORT)
);
