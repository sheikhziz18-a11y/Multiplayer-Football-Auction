// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

let MASTER_PLAYERS = JSON.parse(fs.readFileSync("shuffled_players.json", "utf8"));

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static("public"));

let rooms = {};

/* ================= HELPERS ================= */
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function resetTimers(room) {
  if (room.initialTimer) clearInterval(room.initialTimer);
  if (room.bidTimer) clearInterval(room.bidTimer);
  room.initialTimer = null;
  room.bidTimer = null;
  room.initialTimeLeft = 100;
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
    spinInProgress: room.spinInProgress,
    auctionActive: room.auctionActive,
    log: room.log,
    remainingPlayersByPosition: room.remainingPlayersByPosition,
    unsoldPlayers: room.unsoldPlayers
  });
}

function activePlayers(room) {
  return Object.values(room.players).filter(p => p.active);
}

/* ================= TIMERS ================= */
function startInitialTimer(roomId) {
  const room = rooms[roomId];
  room.initialTimeLeft = 100;

  room.initialTimer = setInterval(() => {
    room.initialTimeLeft--;
    if (room.initialTimeLeft <= 0) {
      clearInterval(room.initialTimer);
      room.initialTimer = null;
      endPlayer(roomId);
    }
    broadcastRoomState(roomId);
  }, 1000);
}

function startBidTimer(roomId) {
  const room = rooms[roomId];
  room.bidTimeLeft = 30;

  room.bidTimer = setInterval(() => {
    room.bidTimeLeft--;
    if (room.bidTimeLeft <= 0) {
      clearInterval(room.bidTimer);
      room.bidTimer = null;
      endPlayer(roomId);
    }
    broadcastRoomState(roomId);
  }, 1000);
}

/* ================= END PLAYER ================= */
function endPlayer(roomId) {
  const room = rooms[roomId];
  const player = room.currentPlayer;

  if (!player) return;

  if (room.currentBidder) {
    const winner = room.players[room.currentBidder];
    winner.team.push({ name: player.name, price: room.currentBid });
    winner.balance -= room.currentBid;
    pushLog(room, "win", `${winner.name} won ${player.name} for ${room.currentBid}M`);
  } else {
    room.unsoldPlayers.unshift(player);
    pushLog(room, "unsold", `${player.name} went UNSOLD`);
  }

  room.currentPlayer = null;
  room.currentBid = 0;
  room.currentBidder = null;
  room.currentPosition = null;
  room.auctionActive = false;

  resetTimers(room);
  broadcastRoomState(roomId);
}

/* ================= SPIN ================= */
function spinWheel(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const positions = ["GK","CB","RB","LB","RW","CF","AM","LW","CM","DM"];
  const pos = positions[Math.floor(Math.random() * positions.length)];

  room.currentPosition = pos;
  room.currentPlayer = room.availablePlayers.find(p => p.position === pos) || null;

  if (!room.currentPlayer) {
    pushLog(room, "info", `No players left for ${pos}`);
    broadcastRoomState(roomId);
    return;
  }

  room.availablePlayers = room.availablePlayers.filter(p => p !== room.currentPlayer);
  room.auctionActive = true;
  pushLog(room, "spin", `${pos} → ${room.currentPlayer.name} (${room.currentPlayer.basePrice}M)`);

  resetTimers(room);
  startInitialTimer(roomId);
  broadcastRoomState(roomId);
}

/* ================= SOCKET ================= */
io.on("connection", socket => {

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

  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return;

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

  socket.on("startSpin", roomId => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.auctionActive) return;

    spinWheel(roomId);
  });

  socket.on("bid", roomId => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive) return;

    // 🚫 minimum 2 players
    if (activePlayers(room).length < 2) return;

    // 🚫 highest bidder cannot bid again
    if (socket.id === room.currentBidder) return;

    // 🚫 skipped players cannot bid
    if (room.skippedPlayers.includes(socket.id)) return;

    const me = room.players[socket.id];
    if (!me) return;

    const nextBid =
      room.currentBid === 0
        ? room.currentPlayer.basePrice
        : room.currentBid < 200
          ? room.currentBid + 5
          : room.currentBid + 10;

    if (me.balance < nextBid) return;

    if (room.currentBid === 0) {
      if (room.initialTimer) clearInterval(room.initialTimer);
      startBidTimer(roomId);
    } else {
      room.bidTimeLeft = 30;
    }

    room.currentBid = nextBid;
    room.currentBidder = socket.id;
    pushLog(room, "info", `${me.name} bid ${nextBid}M`);
    broadcastRoomState(roomId);
  });

  socket.on("skip", roomId => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive) return;

    // 🚫 highest bidder cannot skip
    if (socket.id === room.currentBidder) return;

    if (!room.skippedPlayers.includes(socket.id)) {
      room.skippedPlayers.push(socket.id);
      pushLog(room, "skip", `${room.players[socket.id].name} skipped`);
    }

    const active = activePlayers(room).map(p => p.name);
    const skipped = room.skippedPlayers.length;

    // everyone except highest bidder skipped
    if (room.currentBidder && skipped === active.length - 1) {
      endPlayer(roomId);
      return;
    }

    // no bids + everyone skipped
    if (!room.currentBidder && skipped === active.length) {
      endPlayer(roomId);
      return;
    }

    broadcastRoomState(roomId);
  });

  socket.on("disconnect", () => {
    for (let roomId in rooms) {
      const room = rooms[roomId];
      if (room.players[socket.id]) {
        room.players[socket.id].active = false;
      }
      broadcastRoomState(roomId);
    }
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port " + PORT));
