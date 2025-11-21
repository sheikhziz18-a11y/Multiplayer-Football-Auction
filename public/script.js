// script.js
// Note: server reads players from /mnt/data/shuffled_players.json on the backend.
// This client expects roomState to include:
// - remainingPlayersByPosition: { GK: [...], CB: [...], ... }  (arrays of player objects)
// - unsoldPlayers: [ ... ] (array of player objects)
// Each player object should have at least { name, position, basePrice } or matching keys used by your server.

// Socket init
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
  // render all UI from server state
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

/* RENDER */
function renderRoomState(state) {
  if (!myId) myId = socket.id;

  // show host controls
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
      bidBtn.disabled = (state.currentBidder === myId || me.balance < nextBid);
    }
  }

  skipBtn.disabled = !(state.auctionActive && state.currentPlayer);

  // Logs
  renderLogs(state.log);

  // Summary
  renderSummary(state.players);

  // Remaining players (grouped) and unsold
  // State fields expected: remainingPlayersByPosition (object), unsoldPlayers (array)
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

/* Summary rendering */
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

/* REMAINING PLAYERS - alphabetical inside each position
   groups is expected as { GK: [{name, basePrice, position}, ...], ... }
*/
function renderRemaining(groups) {
  // ensure positions order as POSITIONS array
  remainingBox.innerHTML = ""; // clear
  for (let pos of POSITIONS) {
    const list = Array.isArray(groups[pos]) ? groups[pos].slice() : [];

    // alphabetical sort by name (case-insensitive)
    list.sort((a,b) => {
      const an = (a.name || "").toLowerCase();
      const bn = (b.name || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });

    // create collapsible section
    const wrapper = document.createElement("div");
    wrapper.className = "collapseSection";

    const header = document.createElement("div");
    header.className = "collapseHeader";
    header.innerText = `${pos} (${list.length})`;
    header.tabIndex = 0; // focusable

    const body = document.createElement("div");
    body.className = "collapseBody";

    if (list.length === 0) {
      body.innerHTML = `<div class="empty-note">No players left</div>`;
    } else {
      body.innerHTML = list.map(p => `<div class="player-row">${escapeHtml(p.name)} — ${p.basePrice ?? p.price ?? ""}M</div>`).join("");
    }

    // toggle stays until user clicks again
    header.addEventListener("click", () => body.classList.toggle("show"));
    header.addEventListener("keypress", (e) => { if (e.key === "Enter" || e.key === " ") body.classList.toggle("show"); });

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    remainingBox.appendChild(wrapper);
  }
}

/* UNSOLD LIST - latest first, show base price */
function renderUnsold(list) {
  unsoldBox.innerHTML = "";
  if (!Array.isArray(list) || list.length === 0) {
    unsoldBox.innerHTML = "<div class='empty-note'>No unsold players yet</div>";
    return;
  }
  // latest unsold first = assume server pushes new unsold at front; if not, reverse:
  const arr = list.slice(); // copy
  // If your server sends newest first, keep as is. If not, reverse here:
  // arr.reverse();

  arr.forEach(p => {
    const row = document.createElement("div");
    row.className = "unsold-row";
    row.innerText = `${p.position} — ${p.name} — ${p.basePrice ?? p.price ?? ""}M`;
    unsoldBox.appendChild(row);
  });
}

/* WHEEL ANIMATION: no labels, just rotate the wheel element */
function animateWheelToIndex(index) {
  const slices = POSITIONS.length;
  const sliceAngle = 360 / slices;
  const targetAngle = index * sliceAngle + sliceAngle / 2;
  const rotations = 6;
  const finalAngle = rotations * 360 + (360 - targetAngle);

  wheel.style.transition = "transform 2.5s cubic-bezier(.25,.8,.25,1)";
  wheelRotation = finalAngle;
  wheel.style.transform = `rotate(${wheelRotation}deg)`;

  setTimeout(() => {
    wheel.style.transition = "";
    wheelRotation = wheelRotation % 360;
    wheel.style.transform = `rotate(${wheelRotation}deg)`;
  }, 2600);
}

/* BUTTON ACTIONS */
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

/* small utility to escape HTML in names */
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
}

/* initialize minimal wheel size alignment on load + resize */
function alignWheel() {
  // We keep wheel as a circular element with fixed size CSS; no labels to reposition.
  // This ensures the wheel stays centered above player card.
  // If you want dynamic sizing, add logic here.
}
window.addEventListener("load", alignWheel);
window.addEventListener("resize", alignWheel);
