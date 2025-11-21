// script.js
// Client expects roomState to include:
// - remainingPlayersByPosition: { GK: [...], CB: [...], ... }
// - unsoldPlayers: [ ... ]

const socket = io();

/* ELEMENTS */
const loginPage = document.getElementById("loginPage");
const auctionPage = document.getElementById("auctionPage");

const createName = document.getElementById("createName");
const joinName = document.getElementById("joinName");
const joinRoomId = document.getElementById("joinRoomId");

const roomIdDisplay = document.getElementById("roomIdDisplay");
const startSpinBtn = document.getElementById("startSpinBtn");

const wheel = document.getElementById("wheel");

const playerNameBox = document.getElementById("playerName");
const playerPosBox = document.getElementById("playerPos");
const playerBaseBox = document.getElementById("playerBase");

const initialTimerBox = document.getElementById("initialTimer");
const bidTimerBox = document.getElementById("bidTimer");

const bidBtn = document.getElementById("bidBtn");
const skipBtn = document.getElementById("skipBtn");

const logBox = document.getElementById("logBox");
const summaryList = document.getElementById("summaryList");

const remainingBox = document.getElementById("remainingPlayersBox");
const unsoldBox = document.getElementById("unsoldPlayersBox");

/* STATE */
let currentRoom = null;
let myId = null;
let wheelRotation = 0;
const POSITIONS = ["GK","CB","RB","LB","RW","CF","AM","LW","CM","DM"];

/* CREATE / JOIN */
document.getElementById("createRoomBtn").onclick = () => {
  if (!createName.value) return alert("Enter your name");
  socket.emit("createRoom", createName.value);
};

document.getElementById("joinRoomBtn").onclick = () => {
  if (!joinName.value || !joinRoomId.value) return alert("Enter all fields");
  socket.emit("joinRoom", { roomId: joinRoomId.value.trim(), name: joinName.value });
};

/* SOCKET EVENTS */
socket.on("roomJoined", (roomId) => {
  currentRoom = roomId;
  joinAuctionPage(roomId);
});

socket.on("roomCreated", (roomId) => {
  if (!currentRoom) {
    currentRoom = roomId;
    joinAuctionPage(roomId);
  }
});

socket.on("roomState", (state) => {
  renderRoomState(state);
});

socket.on("wheelResult", ({ index }) => {
  animateWheelToIndex(index);
});

/* UI switch */
function joinAuctionPage(roomId) {
  loginPage.classList.add("hidden");
  auctionPage.classList.remove("hidden");
  roomIdDisplay.innerText = "Room ID — " + roomId;
}

/* Render state */
function renderRoomState(state) {
  if (!myId) myId = socket.id;

  // host controls
  startSpinBtn.style.display = (myId === state.hostId) ? "inline-block" : "none";

  // player card
  if (state.currentPlayer) {
    playerNameBox.innerText = state.currentPlayer.name || "Player Name";
    playerPosBox.innerText = "(" + (state.currentPosition || "") + ")";
    playerBaseBox.innerText = "Base Price: " + (state.currentPlayer.basePrice ?? state.currentPlayer.price ?? "0") + "M";
  } else {
    playerNameBox.innerText = "Player Name";
    playerPosBox.innerText = "(Position)";
    playerBaseBox.innerText = "Base Price";
  }

  // timers
  const initialLeft = typeof state.initialTimeLeft === "number" ? state.initialTimeLeft : 60;
  const bidLeft = typeof state.bidTimeLeft === "number" ? state.bidTimeLeft : 30;

  initialTimerBox.innerText = initialLeft;
  bidTimerBox.innerText = bidLeft;

  // blink when <5
  toggleBlink(initialTimerBox, initialLeft < 5 && state.auctionActive && state.currentBid === 0);
  toggleBlink(bidTimerBox, bidLeft < 5 && state.auctionActive && state.currentBid !== 0);

  // bid button logic
  if (!state.auctionActive || !state.currentPlayer) {
    bidBtn.disabled = true;
  } else {
    const me = state.players[myId];
    if (!me || me.team.length >= 11) bidBtn.disabled = true;
    else {
      let nextBid =
        state.currentBid === 0
          ? (state.currentPlayer.basePrice ?? state.currentPlayer.price ?? 0)
          : (state.currentBid < 200 ? state.currentBid + 5 : state.currentBid + 10);

      bidBtn.innerText = "Bid " + nextBid + "M";
      // disable if I'm current bidder, or insufficient balance
      bidBtn.disabled = (state.currentBidder === myId || me.balance < nextBid);
      // Also if me has previously skipped, server prevents bidding; the button still can be enabled until server rejects
    }
  }

  // highest bidder cannot skip - server enforces; disable at UI to avoid user error
  if (state.currentBidder === myId) skipBtn.disabled = true;
  else skipBtn.disabled = !(state.auctionActive && state.currentPlayer);

  // Logs (join/disconnect are logged as info so color unchanged)
  renderLogs(state.log);

  // Summary
  renderSummary(state.players);

  // Remaining & unsold lists
  renderRemaining(state.remainingPlayersByPosition || {});
  renderUnsold(state.unsoldPlayers || []);
}

/* Blink toggle */
function toggleBlink(el, should) {
  if (should) el.classList.add("blink");
  else el.classList.remove("blink");
}

/* Logs rendering */
function renderLogs(logArray) {
  logBox.innerHTML = "";
  if (!Array.isArray(logArray)) return;
  logArray.slice(-350).forEach(entry => {
    const type = entry.type || "info";
    const text = entry.text || entry;
    const d = document.createElement("div");
    d.className = "log-entry " + type;
    d.textContent = text;
    logBox.appendChild(d);
  });
  logBox.scrollTop = logBox.scrollHeight;
}

/* Summary */
function renderSummary(players) {
  summaryList.innerHTML = "";
  for (let id in players) {
    const p = players[id];
    const div = document.createElement("div");
    div.className = "summary-player";
    div.innerHTML = `
      <div><b>${p.name}</b> — Balance: ${p.balance}M — Players: ${p.team.length}/11</div>
      <div class="player-team" id="team-${id}">${p.team.map(t => `${t.name} — ${t.price}M`).join("<br>")}</div>
    `;
    div.onclick = () => {
      const el = document.getElementById("team-" + id);
      if (el) el.classList.toggle("show");
    };
    summaryList.appendChild(div);
  }
}

/* REMAINING PLAYERS - alphabetical inside each position */
function renderRemaining(groups) {
  remainingBox.innerHTML = "";
  const order = POSITIONS.slice();
  for (let pos of order) {
    const list = Array.isArray(groups[pos]) ? groups[pos].slice() : [];
    list.sort((a,b) => {
      const an = (a.name || "").toLowerCase();
      const bn = (b.name || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });

    const wrapper = document.createElement("div");
    wrapper.className = "collapseSection";

    const header = document.createElement("div");
    header.className = "collapseHeader";
    header.innerText = `${pos} (${list.length})`;
    header.tabIndex = 0;

    const body = document.createElement("div");
    body.className = "collapseBody";
    if (list.length === 0) body.innerHTML = `<div class="empty-note">No players left</div>`;
    else body.innerHTML = list.map(p => `<div class="player-row">${escapeHtml(p.name)} — ${p.basePrice ?? p.price ?? ""}M</div>`).join("");

    header.addEventListener("click", () => body.classList.toggle("show"));
    header.addEventListener("keypress", e => { if (e.key === "Enter" || e.key === " ") body.classList.toggle("show"); });

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    remainingBox.appendChild(wrapper);
  }
}

/* UNSOLD - latest first (server pushes newest at front) */
function renderUnsold(list) {
  unsoldBox.innerHTML = "";
  if (!Array.isArray(list) || list.length === 0) {
    unsoldBox.innerHTML = "<div class='empty-note'>No unsold players yet</div>";
    return;
  }
  list.forEach(p => {
    const row = document.createElement("div");
    row.className = "unsold-row";
    row.innerText = `${p.position} — ${p.name} — ${p.basePrice ?? p.price ?? ""}M`;
    unsoldBox.appendChild(row);
  });
}

/* BUTTONS */
startSpinBtn.onclick = () => {
  if (!currentRoom) return alert("Room not set");
  socket.emit("startSpin", currentRoom);
};

bidBtn.onclick = () => {
  if (!currentRoom) return alert("Not in a room");
  socket.emit("bid", currentRoom);
};

skipBtn.onclick = () => {
  if (!currentRoom) return alert("Not in a room");
  socket.emit("skip", currentRoom);
};

/* WHEEL ANIMATION - always clockwise */
function animateWheelToIndex(index) {
  const slices = POSITIONS.length;
  const sliceAngle = 360 / slices;
  const targetAngle = index * sliceAngle + sliceAngle / 2;
  const rotations = 6;
  // always add positive rotation (clockwise)
  const finalAngle = (rotations * 360) + (360 - targetAngle);

  // rotate by adding to stored rotation so wheel continues correctly
  wheelRotation = (wheelRotation || 0) + finalAngle;

  wheel.style.transition = "transform 2.5s cubic-bezier(.25,.8,.25,1)";
  wheel.style.transform = `rotate(${wheelRotation}deg)`;

  setTimeout(() => {
    wheel.style.transition = "";
    wheelRotation = wheelRotation % 360;
    wheel.style.transform = `rotate(${wheelRotation}deg)`;
  }, 2600);
}

/* escape html */
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
}

/* center layout adjustments for mobile */
function adjustMobileCentering() {
  // on small screens, center the right-panel contents horizontally
  if (window.innerWidth <= 720) {
    // center wheel and player card already in CSS; ensure log and buttons are centered
    document.querySelectorAll('.right-panel, .log-box, .buttons-box, .timers-box').forEach(el => {
      el.style.display = "flex";
      el.style.flexDirection = "column";
      el.style.alignItems = "center";
    });
    // timers-box children (timer elements) center and full width
    document.querySelectorAll('.timer').forEach(t => {
      t.style.width = "90%";
      t.style.marginBottom = "8px";
    });
    document.querySelectorAll('.buttons-box button').forEach(b => {
      b.style.width = "80%";
      b.style.marginBottom = "8px";
    });
    // log-box full width and centered
    document.getElementById('logBox').style.width = "95%";
  } else {
    // restore desktop defaults
    document.querySelectorAll('.right-panel, .log-box, .buttons-box, .timers-box').forEach(el => {
      el.style.display = "";
      el.style.flexDirection = "";
      el.style.alignItems = "";
      el.style.width = "";
    });
    document.querySelectorAll('.timer').forEach(t => {
      t.style.width = "";
      t.style.marginBottom = "";
    });
    document.querySelectorAll('.buttons-box button').forEach(b => {
      b.style.width = "";
      b.style.marginBottom = "";
    });
    document.getElementById('logBox').style.width = "";
  }
}
window.addEventListener('resize', adjustMobileCentering);
window.addEventListener('load', adjustMobileCentering);
