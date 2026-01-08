// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

/* =========================
   LOAD PLAYERS
========================= */
let MASTER_PLAYERS = JSON.parse(
  fs.readFileSync("shuffled_players.json", "utf8")
);

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static("public"));

/* =========================
   ROOM STATE
========================= */
let rooms = {};

/* =========================
   HELPERS
========================= */
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function pushLog(room, type, text) {
  room.log.push({ type, text });
}

function resetTimers(room) {
  if (room.initialTimer) clearInterval(room.initialTimer);
  if (room.bidTimer) clearInterval(room.bidTimer);

  room.initialTimer = null;
  room.bidTimer = null;

  room.initialTimeLeft = 100; // ✅ UPDATED
  room.bidTimeLeft = 60;
  room.skippedPlayers = [];
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
    log: room.log,
    unsoldPlayers: room.unsoldPlayers
  });
}

function pickRandomPlayer(room, position) {
  const pool = room.availablePlayers.filter(p => p.position === position);
  if (pool.length === 0) return null;

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  room.availablePlayers = room.availablePlayers.filter(p => p !== chosen);
  return chosen;
}

/* =========================
   TIMERS
========================= */
function startInitialTimer(roomId) {
  const room = rooms[roomId];
  room.initialTimeLeft = 100;

  room.initialTimer = setInterval(() => {
    room.initialTimeLeft--;

    if (room.initialTimeLeft <= 0) {
      clearInterval(room.initialTimer);
      room.initialTimer = null;
      room.auctionActive = false;
      endPlayer(roomId);
    }

    broadcastRoomState(roomId);
  }, 1000);
}

function startBidTimer(roomId) {
  const room = rooms[roomId];
  room.bidTimeLeft = 60;

  room.bidTimer = setInterval(() => {
    room.bidTimeLeft--;

    if (room.bidTimeLeft <= 0) {
      clearInterval(room.bidTimer);
      room.bidTimer = null;
      room.auctionActive = false;
      endPlayer(roomId);
    }

    broadcastRoomState(roomId);
  }, 1000);
}

/* =========================
   END PLAYER (FINAL DECISION)
========================= */
function endPlayer(roomId) {
  const room = rooms[roomId];
  const player = room.currentPlayer;

  if (!player) return;

  if (room.currentBidder) {
    const winner = room.players[room.currentBidder];
    winner.team.push({ name: player.name, price: room.currentBid });
    winner.balance -= room.currentBid;

    pushLog(
      room,
      "win",
      `${winner.name} won ${player.name} for ${room.currentBid}M`
    );
  } else {
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

/* =========================
   SPIN
========================= */
function spinWheel(roomId) {
  const room = rooms[roomId];
  if (!room || room.spinInProgress || room.auctionActive) return;

  const positions = ["GK","CB","RB","LB","RW","CF","AM","LW","CM","DM"];
  const index = Math.floor(Math.random() * positions.length);
  const pos = positions[index];

  room.spinInProgress = true;
  resetTimers(room);
  broadcastRoomState(roomId);

  io.to(roomId).emit("wheelResult", { index });

  setTimeout(() => {
    const picked = pickRandomPlayer(room, pos);

    if (!picked) {
      pushLog(room, "info", `No players left for ${pos}`);
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

/* =========================
   SOCKET LOGIC
========================= */
io.on("connection", socket => {

  /* CREATE ROOM */
  socket.on("createRoom", name => {
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
      initialTimeLeft: 100,
      bidTimeLeft: 60,
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

  /* JOIN ROOM (RECONNECT BY NAME) */
  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return;

    let oldId = Object.keys(room.players).find(
      id => room.players[id].name === name
    );

    if (oldId) {
      room.players[socket.id] = room.players[oldId];
      delete room.players[oldId];
    } else {
      room.players[socket.id] = {
        name,
        balance: 1000,
        team: [],
        active: true
      };
    }

    socket.join(roomId);
    socket.emit("roomJoined", roomId);
    broadcastRoomState(roomId);
  });

  /* START SPIN */
  socket.on("startSpin", roomId => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    spinWheel(roomId);
  });

  /* BID */
  socket.on("bid", roomId => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive) return;

    if (room.skippedPlayers.includes(socket.id)) return;

    const me = room.players[socket.id];
    if (!me) return;

    let nextBid =
      room.currentBid === 0
        ? room.currentPlayer.basePrice
        : room.currentBid < 200
        ? room.currentBid + 5
        : room.currentBid + 10;

    if (me.balance < nextBid) return;

    if (room.currentBid === 0) {
      clearInterval(room.initialTimer);
      startBidTimer(roomId);
    } else {
      room.bidTimeLeft = 60;
    }

    room.currentBid = nextBid;
    room.currentBidder = socket.id;

    pushLog(room, "info", `${me.name} bid ${nextBid}M`);
    broadcastRoomState(roomId);
  });

  /* SKIP */
  socket.on("skip", roomId => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive) return;

    // ❌ current bidder CANNOT skip
    if (socket.id === room.currentBidder) return;

    if (!room.skippedPlayers.includes(socket.id)) {
      room.skippedPlayers.push(socket.id);
      pushLog(room, "skip", `${room.players[socket.id].name} skipped`);
    }

    const activePlayers = Object.keys(room.players);
    const others = activePlayers.filter(
      id => id !== room.currentBidder
    );

    if (
      room.currentBidder &&
      others.every(id => room.skippedPlayers.includes(id))
    ) {
      clearInterval(room.initialTimer);
      clearInterval(room.bidTimer);
      room.auctionActive = false;
      endPlayer(roomId);
    }

    broadcastRoomState(roomId);
  });

  /* FORCE SELL (HOST ONLY) */
  socket.on("forceSell", roomId => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (!room.currentBidder) return;

    pushLog(room, "info", "Host used Force Sell");

    clearInterval(room.initialTimer);
    clearInterval(room.bidTimer);
    room.auctionActive = false;

    endPlayer(roomId);
  });

});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log("Server running on port " + PORT)
);
