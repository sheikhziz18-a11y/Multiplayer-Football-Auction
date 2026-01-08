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

function getRemainingPlayersByPosition(room) {
  const posGroups = {
    GK: [], LB: [], RB: [], CB: [],
    DM: [], CM: [], AM: [],
    LW: [], RW: [], CF: []
  };
  for (let p of room.availablePlayers) {
    if (posGroups[p.position]) posGroups[p.position].push(p);
  }
  return posGroups;
}

function broadcastRoomState(roomId) {
  let room = rooms[roomId];
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
    remainingPlayersByPosition: getRemainingPlayersByPosition(room),
    unsoldPlayers: room.unsoldPlayers
  });
}

function pickRandomPlayer(room, position) {
  const candidates = room.availablePlayers.filter(p => p.position === position);
  if (candidates.length === 0) return null;
  const idx = Math.floor(Math.random() * candidates.length);
  const chosen = candidates[idx];
  room.availablePlayers = room.availablePlayers.filter(p => p !== chosen);
  return chosen;
}

/* ====================================
   TIMERS
==================================== */
function startInitialTimer(roomId) {
  const room = rooms[roomId];
  room.initialTimeLeft = 60;

  room.initialTimer = setInterval(() => {
    room.initialTimeLeft--;
    if (room.initialTimeLeft <= 0) {
      clearInterval(room.initialTimer);
      room.initialTimer = null;
      room.auctionActive = false;
      endPlayer(roomId, false);
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
      room.auctionActive = false;
      endPlayer(roomId, true);
    }
    broadcastRoomState(roomId);
  }, 1000);
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
   SPIN
==================================== */
function spinWheel(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const positions = ["GK","CB","RB","LB","RW","CF","AM","LW","CM","DM"];
  const chosenIndex = Math.floor(Math.random() * positions.length);
  const pos = positions[chosenIndex];

  io.to(roomId).emit("wheelResult", { index: chosenIndex, position: pos });

  room.spinInProgress = true;
  room.auctionActive = false;
  room.currentPlayer = null;
  room.currentBid = 0;
  room.currentBidder = null;
  resetTimers(room);
  broadcastRoomState(roomId);

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
    pushLog(room, "spin", `${pos} → ${picked.name} (${picked.basePrice}M)`);

    room.spinInProgress = false;
    broadcastRoomState(roomId);
    startInitialTimer(roomId);
  }, 2500);
}

/* ====================================
   SOCKET LOGIC
==================================== */
io.on("connection", (socket) => {

  socket.on("createRoom", (name) => {
    let roomId = generateRoomId();

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
      active: true,
      disconnected: false
    };

    socket.join(roomId);
    socket.emit("roomJoined", roomId);
    broadcastRoomState(roomId);
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    let room = rooms[roomId];
    if (!room) return socket.emit("error", "Room not found");

    let oldId = null;
    for (let p in room.players) {
      if (room.players[p].name === name) oldId = p;
    }

    if (oldId) {
      room.players[socket.id] = room.players[oldId];
      delete room.players[oldId];
    } else {
      room.players[socket.id] = {
        name,
        balance: 1000,
        team: [],
        active: true,
        disconnected: false
      };
    }

    socket.join(roomId);
    socket.emit("roomJoined", roomId);
    broadcastRoomState(roomId);
  });

  socket.on("startSpin", (roomId) => {
    let room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.spinInProgress || room.auctionActive) return;
    spinWheel(roomId);
  });

  socket.on("bid", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive) return;

    if (room.skippedPlayers.includes(socket.id)) {
      return socket.emit("error", "You skipped this round.");
    }

    const me = room.players[socket.id];
    let nextBid =
      room.currentBid === 0 ? room.currentPlayer.basePrice :
      room.currentBid < 200 ? room.currentBid + 5 :
      room.currentBid + 10;

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

  /* ===== FIXED SKIP LOGIC ===== */
  socket.on("skip", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive) return;

    if (!room.skippedPlayers.includes(socket.id)) {
      room.skippedPlayers.push(socket.id);
      pushLog(room, "skip", `${room.players[socket.id].name} skipped`);
    }

    const totalPlayers = Object.keys(room.players).length;
    const activeRemaining = totalPlayers - room.skippedPlayers.length;

    if (activeRemaining <= 1) {
      if (room.initialTimer) clearInterval(room.initialTimer);
      if (room.bidTimer) clearInterval(room.bidTimer);

      if (room.currentBidder) endPlayer(roomId, true);
      else endPlayer(roomId, false);
    }

    broadcastRoomState(roomId);
  });

  socket.on("disconnect", () => {
    for (let roomId in rooms) {
      let room = rooms[roomId];
      if (room.players[socket.id]) {
        room.players[socket.id].active = false;
        room.players[socket.id].disconnected = true;

        if (room.hostId === socket.id) {
          let others = Object.keys(room.players).filter(p => p !== socket.id);
          if (others.length > 0) room.hostId = others[0];
        }
      }
      broadcastRoomState(roomId);
    }
  });

});

/* ====================================
   START SERVER
==================================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port " + PORT));
