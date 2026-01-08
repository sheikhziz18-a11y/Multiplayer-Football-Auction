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

/* ============================
   ROOM STATE
============================ */
let rooms = {};

/* ============================
   HELPERS
============================ */
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

function pickRandomPlayer(room, position) {
  const list = room.availablePlayers.filter(p => p.position === position);
  if (!list.length) return null;
  const p = list[Math.floor(Math.random() * list.length)];
  room.availablePlayers = room.availablePlayers.filter(x => x !== p);
  return p;
}

/* ============================
   TIMERS
============================ */
function startInitialTimer(roomId) {
  const room = rooms[roomId];
  room.initialTimer = setInterval(() => {
    room.initialTimeLeft--;
    if (room.initialTimeLeft <= 0) {
      clearInterval(room.initialTimer);
      room.initialTimer = null;
      endPlayer(roomId, false);
    }
    broadcastRoomState(roomId);
  }, 1000);
}

function startBidTimer(roomId) {
  const room = rooms[roomId];
  room.bidTimer = setInterval(() => {
    room.bidTimeLeft--;
    if (room.bidTimeLeft <= 0) {
      clearInterval(room.bidTimer);
      room.bidTimer = null;
      endPlayer(roomId, true);
    }
    broadcastRoomState(roomId);
  }, 1000);
}

/* ============================
   END PLAYER
============================ */
function endPlayer(roomId, sold) {
  const room = rooms[roomId];
  const player = room.currentPlayer;

  if (sold && room.currentBidder) {
    const w = room.players[room.currentBidder];
    w.team.push({ name: player.name, price: room.currentBid });
    w.balance -= room.currentBid;
    pushLog(room, "win", `${w.name} won ${player.name} for ${room.currentBid}M`);
  } else if (player) {
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

/* ============================
   SPIN
============================ */
function spinWheel(roomId) {
  const room = rooms[roomId];
  const positions = ["GK","CB","RB","LB","RW","CF","AM","LW","CM","DM"];
  const index = Math.floor(Math.random() * positions.length);
  const pos = positions[index];

  io.to(roomId).emit("wheelResult", { index });

  room.spinInProgress = true;
  broadcastRoomState(roomId);

  setTimeout(() => {
    const picked = pickRandomPlayer(room, pos);
    if (!picked) {
      room.spinInProgress = false;
      broadcastRoomState(roomId);
      return;
    }

    room.currentPlayer = picked;
    room.currentPosition = pos;
    room.auctionActive = true;
    room.spinInProgress = false;
    pushLog(room, "spin", `${pos} → ${picked.name} (${picked.basePrice}M)`);

    broadcastRoomState(roomId);
    startInitialTimer(roomId);
  }, 2500);
}

/* ============================
   SOCKETS
============================ */
io.on("connection", (socket) => {

  socket.on("createRoom", (name) => {
    const roomId = generateRoomId();

    rooms[roomId] = {
      hostId: socket.id,
      players: {},
      availablePlayers: JSON.parse(JSON.stringify(MASTER_PLAYERS)),
      currentPlayer: null,
      currentPosition: null,
      currentBid: 0,
      currentBidder: null,
      auctionActive: false,
      spinInProgress: false,
      initialTimer: null,
      bidTimer: null,
      initialTimeLeft: 60,
      bidTimeLeft: 30,
      skippedPlayers: [],
      log: []
    };

    rooms[roomId].players[socket.id] = {
      name,
      balance: 1000,
      team: []
    };

    socket.join(roomId);
    socket.emit("roomJoined", roomId);
    broadcastRoomState(roomId);
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return;

    for (let id in room.players) {
      if (room.players[id].name === name) {
        room.players[socket.id] = room.players[id];
        delete room.players[id];
        socket.join(roomId);
        socket.emit("roomJoined", roomId);
        broadcastRoomState(roomId);
        return;
      }
    }

    room.players[socket.id] = { name, balance: 1000, team: [] };
    socket.join(roomId);
    socket.emit("roomJoined", roomId);
    broadcastRoomState(roomId);
  });

  socket.on("startSpin", (roomId) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostId) return;
    if (room.spinInProgress || room.auctionActive) return;
    spinWheel(roomId);
  });

  socket.on("bid", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive) return;
    if (room.skippedPlayers.includes(socket.id)) return;

    const me = room.players[socket.id];
    let next =
      room.currentBid === 0 ? room.currentPlayer.basePrice :
      room.currentBid < 200 ? room.currentBid + 5 :
      room.currentBid + 10;

    if (me.balance < next) return;

    if (room.currentBid === 0) {
      clearInterval(room.initialTimer);
      startBidTimer(roomId);
    } else {
      room.bidTimeLeft = 30;
    }

    room.currentBid = next;
    room.currentBidder = socket.id;
    pushLog(room, "info", `${me.name} bid ${next}M`);
    broadcastRoomState(roomId);
  });

  socket.on("skip", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive) return;

    if (socket.id === room.currentBidder) return;

    if (!room.skippedPlayers.includes(socket.id)) {
      room.skippedPlayers.push(socket.id);
      pushLog(room, "skip", `${room.players[socket.id].name} skipped`);
    }

    const active = Object.keys(room.players).filter(p => p !== room.currentBidder);
    if (room.currentBidder && room.skippedPlayers.length === active.length) {
      clearInterval(room.initialTimer);
      clearInterval(room.bidTimer);
      endPlayer(roomId, true);
    }

    broadcastRoomState(roomId);
  });

  socket.on("forceSell", (roomId) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostId) return;
    if (!room.currentBid || !room.currentBidder) return;

    clearInterval(room.initialTimer);
    clearInterval(room.bidTimer);

    pushLog(room, "info", "Host used Force Sell");
    endPlayer(roomId, true);
  });
});

/* ============================
   START
============================ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on", PORT));
