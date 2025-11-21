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

const wheel = document.getElementById("wheel");
const wheelLabels = document.getElementById("wheelLabels");

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

socket.on("roomState", (state) => {
  renderRoomState(state);
});

socket.on("wheelResult", ({ index }) => {
  animateWheelToIndex(index);
});

/* UI switch */
function joinAuctionPage(roomId){
  loginPage.classList.add("hidden");
  auctionPage.classList.remove("hidden");
  roomIdDisplay.innerText = "Room ID — " + roomId;
}

/* Render everything */
function renderRoomState(state){
  if (!myId) myId = socket.id;

  startSpinBtn.style.display = (myId === state.hostId) ? "inline-block" : "none";

  if (state.currentPlayer) {
    playerNameBox.innerText = state.currentPlayer.name;
    playerPosBox.innerText = "(" + state.currentPosition + ")";
    playerBaseBox.innerText = "Base Price: " + state.currentPlayer.basePrice + "M";
  } else {
    playerNameBox.innerText = "Player Name";
    playerPosBox.innerText = "(Position)";
    playerBaseBox.innerText = "Base Price";
  }

  // timers + blink
  const initLeft = state.initialTimeLeft ?? 60;
  const bidLeft = state.bidTimeLeft ?? 30;

  initialTimerBox.innerText = initLeft;
  bidTimerBox.innerText = bidLeft;

  toggleBlink(initialTimerBox, initLeft < 5 && state.currentBid === 0 && state.auctionActive);
  toggleBlink(bidTimerBox, bidLeft < 5 && state.currentBid !== 0 && state.auctionActive);

  // Bid button logic
  if (state.auctionActive && state.currentPlayer) {
    const me = state.players[myId];
    let nextBid =
      state.currentBid === 0 ? state.currentPlayer.basePrice :
      state.currentBid < 200 ? state.currentBid + 5 :
      state.currentBid + 10;

    bidBtn.innerText = "Bid " + nextBid + "M";
    bidBtn.disabled = (!me || me.balance < nextBid || me.team.length >= 11 || state.currentBidder === myId);
  } else {
    bidBtn.disabled = true;
  }

  skipBtn.disabled = !(state.auctionActive && state.currentPlayer);

  renderLogs(state.log);
  renderSummary(state.players);

  renderRemaining(state.remainingPlayersByPosition);
  renderUnsold(state.unsoldPlayers);
}

/* Blink */
function toggleBlink(el, should){
  if (should) el.classList.add("blink");
  else el.classList.remove("blink");
}

/* Logs */
function renderLogs(logArr){
  logBox.innerHTML = "";
  if (!Array.isArray(logArr)) return;

  logArr.forEach(entry => {
    const div = document.createElement("div");
    div.className = "log-entry " + entry.type;
    div.textContent = entry.text;
    logBox.appendChild(div);
  });

  logBox.scrollTop = logBox.scrollHeight;
}

/* Summary */
function renderSummary(players){
  summaryList.innerHTML = "";
  for (let id in players){
    const p = players[id];
    const box = document.createElement("div");
    box.className = "summary-player";

    box.innerHTML = `
      <div><b>${p.name}</b> — Balance: ${p.balance}M — Players: ${p.team.length}/11</div>
      <div class="player-team" id="team-${id}">
        ${p.team.map(t => `${t.name} — ${t.price}M`).join("<br>")}
      </div>
    `;

    box.addEventListener("click", () => {
      const el = document.getElementById("team-" + id);
      el.classList.toggle("show");
    });

    summaryList.appendChild(box);
  }
}

/* Remaining players */
function renderRemaining(groups){
  remainingBox.innerHTML = "";
  for (let pos in groups){
    const wrapper = document.createElement("div");
    wrapper.className = "collapse";

    const head = document.createElement("div");
    head.className = "collapse-head";
    head.textContent = `${pos} (${groups[pos].length})`;

    const body = document.createElement("div");
    body.className = "collapse-body";
    body.innerHTML = groups[pos]
      .map(p => `${p.name} — ${p.basePrice}M`)
      .join("<br>");

    head.onclick = () => {
      body.classList.toggle("show");
    };

    wrapper.appendChild(head);
    wrapper.appendChild(body);
    remainingBox.appendChild(wrapper);
  }
}

/* Unsold */
function renderUnsold(list){
  if (list.length === 0) {
    unsoldBox.innerHTML = "<i>No unsold players yet</i>";
    return;
  }
  unsoldBox.innerHTML = list
    .map(u => `${u.position} — ${u.name} (${u.basePrice}M)`)
    .join("<br>");
}

/* Wheel build */
function buildWheelLabels(){
  wheelLabels.innerHTML = "";
  const slices = POSITIONS.length;
  const radius = (wheel.clientWidth / 2) - 10;

  for (let i = 0; i < slices; i++){
    const lbl = document.createElement("div");
    lbl.className = "slice-label";
    const angle = i * (360 / slices) + (360 / slices) / 2;
    lbl.style.transform = `rotate(${angle}deg) translate(${radius}px) rotate(90deg)`;
    lbl.textContent = POSITIONS[i];
    wheelLabels.appendChild(lbl);
  }
}

function animateWheelToIndex(i){
  const slice = 360 / POSITIONS.length;
  const target = i * slice + slice / 2;
  const final = 6 * 360 + (360 - target);
  wheel.style.transition = "transform 2.5s";
  wheel.style.transform = `rotate(${final}deg)`;

  setTimeout(() => {
    wheel.style.transition = "";
    wheelRotation = final % 360;
    wheel.style.transform = `rotate(${wheelRotation}deg)`;
  }, 2600);
}

startSpinBtn.onclick = () => socket.emit("startSpin", currentRoom);
bidBtn.onclick = () => socket.emit("bid", currentRoom);
skipBtn.onclick = () => socket.emit("skip", currentRoom);

window.addEventListener("load", buildWheelLabels);
window.addEventListener("resize", buildWheelLabels);
