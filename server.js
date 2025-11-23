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
  // keep last 500 logs
  room.log.push({ type: type || "info", text });
  if (room.log.length > 500) room.log.shift();
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

function countActivePlayers(room) {
  return Object.keys(room.players).filter(id => room.players[id].active).length;
}

/* ====================================
   TIMERS
==================================== */
function startInitialTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.initialTimeLeft = 60;
  if (room.initialTimer) clearInterval(room.initialTimer);

  room.initialTimer = setInterval(() => {
    room.initialTimeLeft--;
    if (room.initialTimeLeft <= 0) {
      clearInterval(room.initialTimer);
      room.initialTimer = null;
      room.auctionActive = false;
      // no bids -> unsold
      endPlayer(roomId, false);
    }
    broadcastRoomState(roomId);
  }, 1000);
}

function startBidTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.bidTimer) clearInterval(room.bidTimer);
  room.bidTimeLeft = 30;

  room.bidTimer = setInterval(() => {
    room.bidTimeLeft--;
    if (room.bidTimeLeft <= 0) {
      clearInterval(room.bidTimer);
      room.bidTimer = null;
      room.auctionActive = false;
      // finalize sale to current bidder if any
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
  if (!room) return;
  const player = room.currentPlayer;

  if (sold && room.currentBidder && player) {
    const winner = room.players[room.currentBidder];
    if (winner && winner.balance >= room.currentBid) {
      winner.balance -= room.currentBid;
      winner.team.push({ name: player.name, price: room.currentBid });
      pushLog(room, "win", `${winner.name} won ${player.name} for ${room.currentBid}M`);
    } else {
      // insufficient balance -> mark unsold
      room.unsoldPlayers.unshift(player);
      pushLog(room, "unsold", `${player.name} was unsold`);
    }
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

  // small delay before next spin (2s)
  setTimeout(() => {
    // do not auto-spin if no players left
    if (room.availablePlayers.length > 0) {
      // leave spin to host: do not auto-spin automatically per your rules
      // If you want auto-spin uncomment next line:
      // spinWheel(roomId);
    }
  }, 2000);
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

    // If only one active player in room -> auto-assign at base price
    const activeIds = Object.keys(room.players).filter(id => room.players[id].active);
    if (activeIds.length === 1) {
      const soleId = activeIds[0];
      const sole = room.players[soleId];
      const price = picked.basePrice ?? 0;
      if (sole.balance >= price) {
        sole.balance -= price;
        sole.team.push({ name: picked.name, price });
        pushLog(room, "win", `${sole.name} won ${picked.name} for ${price}M (auto)` );
      } else {
        room.unsoldPlayers.unshift(picked);
        pushLog(room, "unsold", `${picked.name} was unsold (auto, insufficient balance)` );
      }
      room.currentPlayer = null;
      room.currentPosition = null;
      room.auctionActive = false;
      room.currentBid = 0;
      room.currentBidder = null;
      resetTimers(room);
      room.spinInProgress = false;
      broadcastRoomState(roomId);
      return;
    }

    room.spinInProgress = false;
    broadcastRoomState(roomId);
    startInitialTimer(roomId);
  }, 2500);
}

/* ====================================
   SOCKET LOGIC
==================================== */
io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  /* CREATE ROOM */
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
    pushLog(rooms[roomId], "info", `${name} joined the room`);
    socket.emit("roomJoined", roomId);
    broadcastRoomState(roomId);
  });

  /* JOIN ROOM + RECONNECT BY NAME */
  socket.on("joinRoom", ({ roomId, name }) => {
    let room = rooms[roomId];
    if (!room) return socket.emit("error", "Room not found");

    // try to find matching name
    let old = null, oldId = null;

    for (let p in room.players) {
      if (room.players[p].name === name) {
        old = room.players[p];
        oldId = p;
      }
    }

    if (old) {
      // reconnect: move state to new socket id
      room.players[socket.id] = {
        name: old.name,
        balance: old.balance,
        team: old.team,
        active: true,
        disconnected: false
      };
      // remove old socket id entry
      if (oldId !== socket.id) delete room.players[oldId];

      socket.join(roomId);
      pushLog(room, "info", `${name} rejoined the room`);
      socket.emit("roomJoined", roomId);
      broadcastRoomState(roomId);
      return;
    }

    // new player
    room.players[socket.id] = {
      name,
      balance: 1000,
      team: [],
      active: true,
      disconnected: false
    };

    socket.join(roomId);
    pushLog(room, "info", `${name} joined the room`);
    socket.emit("roomJoined", roomId);
    broadcastRoomState(roomId);
  });

  /* SPIN */
  socket.on("startSpin", (roomId) => {
    let room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.spinInProgress || room.auctionActive) return;

    spinWheel(roomId);
  });

  /* BID */
  socket.on("bid", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive) return;

    // if user had already skipped, they cannot bid
    if (room.skippedPlayers.includes(socket.id)) {
      return socket.emit("error", "You skipped this round, cannot bid now.");
    }

    const me = room.players[socket.id];
    if (!me) return;

    // determine next bid
    let nextBid =
      room.currentBid === 0 ? (room.currentPlayer.basePrice ?? 0) :
      room.currentBid < 200 ? room.currentBid + 5 :
      room.currentBid + 10;

    if (me.balance < nextBid) return socket.emit("error", "Not enough balance.");

    // when first bid happens: stop initial timer and start bid timer
    if (room.currentBid === 0) {
      if (room.initialTimer) clearInterval(room.initialTimer);
      startBidTimer(roomId);
    } else {
      // reset per-bid timer to 30s
      room.bidTimeLeft = 30;
    }

    room.currentBid = nextBid;
    room.currentBidder = socket.id;
    pushLog(room, "info", `${me.name} bid ${nextBid}M`);
    broadcastRoomState(roomId);
  });

  /* SKIP */
  socket.on("skip", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.auctionActive || !room.currentPlayer) return;

    // highest bidder cannot skip
    if (socket.id === room.currentBidder) {
      return socket.emit("error", "Highest bidder cannot skip.");
    }

    if (!room.skippedPlayers.includes(socket.id)) {
      room.skippedPlayers.push(socket.id);
      pushLog(room, "info", `${room.players[socket.id].name} skipped`);
    }

    // consider only active players when checking if everyone skipped
    const activeIds = Object.keys(room.players).filter(id => room.players[id].active);
    if (room.skippedPlayers.length >= activeIds.length) {
      // everyone (active) skipped
      if (room.initialTimer) { clearInterval(room.initialTimer); room.initialTimer = null; }
      if (room.bidTimer) { clearInterval(room.bidTimer); room.bidTimer = null; }

      if (room.currentBidder) {
        // highest bidder wins immediately (we prevented highest bidder skipping)
        endPlayer(roomId, true);
      } else {
        // no bids, unsold immediately
        endPlayer(roomId, false);
      }
      return;
    }

    broadcastRoomState(roomId);
  });
/* FORCE SELL — HOST ONLY */
socket.on("forceSell", (roomId) => {
  const room = rooms[roomId];
  if (!room) return;

  // must be host
  if (socket.id !== room.hostId) return;

  // cannot use when no bid
  if (!room.currentPlayer || room.currentBid === 0 || !room.currentBidder) return;

  // clear timers
  if (room.initialTimer) clearInterval(room.initialTimer);
  if (room.bidTimer) clearInterval(room.bidTimer);

  const player = room.currentPlayer;
  const winnerId = room.currentBidder;
  const w = room.players[winnerId];

  // log messages
  pushLog(room, "info", "Host used Force Sell");
  pushLog(room, "win", `${w.name} won ${player.name} for ${room.currentBid}M`);

  // transaction
  w.team.push({ name: player.name, price: room.currentBid });
  w.balance -= room.currentBid;

  // reset round
  room.currentPlayer = null;
  room.currentBid = 0;
  room.currentBidder = null;
  room.currentPosition = null;
  room.auctionActive = false;

  resetTimers(room);
  broadcastRoomState(roomId);
});

  /* DISCONNECT — DO NOT DELETE PLAYER */
  socket.on("disconnect", () => {
    for (let roomId in rooms) {
      let room = rooms[roomId];
      if (room.players[socket.id]) {
        const name = room.players[socket.id].name;
        room.players[socket.id].active = false;
        room.players[socket.id].disconnected = true;
        pushLog(room, "info", `${name} disconnected`);

        // Host leaves → next user becomes host
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
