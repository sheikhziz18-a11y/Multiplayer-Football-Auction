// script.js
const socket = io();

/* ELEMENTS */
const loginPage = document.getElementById("loginPage");
const auctionPage = document.getElementById("auctionPage");

const createName = document.getElementById("createName");
const joinName = document.getElementById("joinName");
const joinRoomId = document.getElementById("joinRoomId");

const roomIdDisplay = document.getElementById("roomIdDisplay");
const startSpinBtn = document.getElementById("startSpinBtn");
const forceSellBtn = document.getElementById("forceSellBtn");

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

const remainingBox = document.getElementById("remainingBox");
const unsoldBox = document.getElementById("unsoldBox");

/* UI STATE (THIS FIXES AUTO-CLOSE BUG) */
const uiState = {
  remainingOpen: false,
  unsoldOpen: false
};

document.getElementById("remainingToggle").onclick = () => {
  uiState.remainingOpen = !uiState.remainingOpen;
  renderCollapsibles();
};

document.getElementById("unsoldToggle").onclick = () => {
  uiState.unsoldOpen = !uiState.unsoldOpen;
  renderCollapsibles();
};

let currentRoom = null;
let myId = null;
let wheelRotation = 0;

/* CREATE / JOIN */
document.getElementById("createRoomBtn").onclick = () => {
  if (!createName.value) return alert("Enter your name");
  socket.emit("createRoom", createName.value);
};

document.getElementById("joinRoomBtn").onclick = () => {
  if (!joinName.value || !joinRoomId.value) return alert("Enter all fields");
  socket.emit("joinRoom", { roomId: joinRoomId.value.trim(), name: joinName.value });
};

/* SOCKET */
socket.on("roomJoined", (roomId) => {
  currentRoom = roomId;
  loginPage.classList.add("hidden");
  auctionPage.classList.remove("hidden");
  roomIdDisplay.innerText = "Room ID — " + roomId;
});

socket.on("roomState", (state) => {
  renderRoomState(state);
});

socket.on("wheelResult", ({ index }) => animateWheel(index));

/* RENDER */
function renderRoomState(state) {
  if (!myId) myId = socket.id;

  startSpinBtn.style.display = myId === state.hostId ? "inline-block" : "none";
  forceSellBtn.classList.toggle("hidden", myId !== state.hostId || !state.currentBidder);

  if (state.currentPlayer) {
    playerNameBox.innerText = state.currentPlayer.name;
    playerPosBox.innerText = `(${state.currentPosition})`;
    playerBaseBox.innerText = `Base Price: ${state.currentPlayer.basePrice}M`;
  } else {
    playerNameBox.innerText = "Player Name";
    playerPosBox.innerText = "(Position)";
    playerBaseBox.innerText = "Base Price";
  }

  initialTimerBox.innerText = state.initialTimeLeft;
  bidTimerBox.innerText = state.bidTimeLeft;

  renderLogs(state.log);
  renderSummary(state.players);
  renderRemaining(state.remainingPlayersByPosition);
  renderUnsold(state.unsoldPlayers);
  renderCollapsibles();
}

/* COLLAPSIBLES */
function renderCollapsibles() {
  remainingBox.style.display = uiState.remainingOpen ? "block" : "none";
  unsoldBox.style.display = uiState.unsoldOpen ? "block" : "none";
}

/* REMAINING */
function renderRemaining(groups) {
  remainingBox.innerHTML = "";
  for (let pos in groups) {
    if (!groups[pos].length) continue;
    const div = document.createElement("div");
    div.innerHTML = `<b>${pos}</b><br>` + groups[pos]
      .map(p => `${p.name} — ${p.basePrice}M`)
      .join("<br>");
    remainingBox.appendChild(div);
  }
}

/* UNSOLD */
function renderUnsold(list) {
  unsoldBox.innerHTML = list
    .map(p => `${p.name} — ${p.basePrice}M`)
    .join("<br>");
}

/* SUMMARY */
function renderSummary(players) {
  summaryList.innerHTML = "";
  for (let id in players) {
    const p = players[id];
    const div = document.createElement("div");
    div.className = "summary-player";
    div.innerHTML = `
      <b>${p.name}</b> — Balance: ${p.balance}M — ${p.team.length}/11
      <div class="player-team">${p.team.map(t => `${t.name} — ${t.price}M`).join("<br>")}</div>
    `;
    div.onclick = () => div.querySelector(".player-team").classList.toggle("show");
    summaryList.appendChild(div);
  }
}

/* LOGS */
function renderLogs(logs) {
  logBox.innerHTML = "";
  logs.forEach(l => {
    const d = document.createElement("div");
    d.className = "log-entry " + l.type;
    d.textContent = l.text;
    logBox.appendChild(d);
  });
  logBox.scrollTop = logBox.scrollHeight;
}

/* BUTTONS */
startSpinBtn.onclick = () => socket.emit("startSpin", currentRoom);
forceSellBtn.onclick = () => socket.emit("forceSell", currentRoom);
bidBtn.onclick = () => socket.emit("bid", currentRoom);
skipBtn.onclick = () => socket.emit("skip", currentRoom);

/* WHEEL */
function animateWheel(index) {
  const slice = 360 / 10;
  wheelRotation += 360 * 5 + (360 - (index * slice + slice / 2));
  wheel.style.transition = "transform 2.5s ease-out";
  wheel.style.transform = `rotate(${wheelRotation}deg)`;
}
