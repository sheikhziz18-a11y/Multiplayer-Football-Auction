// connect
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

/* STATE */
let currentRoom = null;
let myId = null;
let wheelRotation = 0;

// SAME ORDER AS SERVER
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

  // card
  if (state.currentPlayer) {
    playerNameBox.innerText = state.currentPlayer.name;
    playerPosBox.innerText = `(${state.currentPosition})`;
    playerBaseBox.innerText = `Base Price: ${state.currentPlayer.basePrice}M`;
  } else {
    playerNameBox.innerText = "Player Name";
    playerPosBox.innerText = "(Position)";
    playerBaseBox.innerText = "Base Price";
  }

  // timers
  const initialLeft = state.initialTimeLeft ?? 60;
  const bidLeft = state.bidTimeLeft ?? 30;

  initialTimerBox.innerText = initialLeft;
  bidTimerBox.innerText = bidLeft;

  // blink <5 seconds
  toggleBlink(initialTimerBox, initialLeft < 5 && state.currentBid === 0 && state.auctionActive);
  toggleBlink(bidTimerBox, bidLeft < 5 && state.currentBid !== 0 && state.auctionActive);

  // bid button logic
  if (!state.auctionActive || !state.currentPlayer) {
    bidBtn.disabled = true;
  } else {
    const me = state.players[myId];
    if (!me || me.team.length >= 11) bidBtn.disabled = true;
    else {
      let nextBid =
        state.currentBid === 0
          ? state.currentPlayer.basePrice
          : state.currentBid < 200
          ? state.currentBid + 5
          : state.currentBid + 10;

      bidBtn.innerText = "Bid " + nextBid + "M";
      bidBtn.disabled = (state.currentBidder === myId || me.balance < nextBid);
    }
  }

  skipBtn.disabled = !(state.auctionActive && state.currentPlayer);

  renderLogs(state.log);
  renderSummary(state.players);
}

/* blink helper */
function toggleBlink(el, on) {
  if (on) el.classList.add("blink");
  else el.classList.remove("blink");
}

/* Logs */
function renderLogs(list) {
  logBox.innerHTML = "";
  if (!Array.isArray(list)) return;

  list.slice(-250).forEach(entry => {
    let type = entry.type || "info";
    let text = entry.text || entry;

    const div = document.createElement("div");
    div.className = "log-entry " + type;
    div.textContent = text;
    logBox.appendChild(div);
  });

  logBox.scrollTop = logBox.scrollHeight;
}

/* Summary */
function renderSummary(players) {
  summaryList.innerHTML = "";

  for (let id in players) {
    let p = players[id];
    const div = document.createElement("div");
    div.className = "summary-player";

    div.innerHTML = `
      <div><b>${p.name}</b> — Balance: ${p.balance}M — Players: ${p.team.length}/11</div>
      <div class="player-team" id="team-${id}">${p.team.map(t => `${t.name} — ${t.price}M`).join("<br>")}</div>
    `;

    div.onclick = () => {
      document.getElementById("team-" + id).classList.toggle("show");
    };

    summaryList.appendChild(div);
  }
}

/* BUTTONS */
startSpinBtn.onclick = () => socket.emit("startSpin", currentRoom);
bidBtn.onclick = () => socket.emit("bid", currentRoom);
skipBtn.onclick = () => socket.emit("skip", currentRoom);

/* WHEEL SPIN */
function animateWheelToIndex(index) {
  const slices = POSITIONS.length;
  const sliceDeg = 360 / slices;

  const target = index * sliceDeg + sliceDeg / 2;
  const spins = 6;
  const finalAngle = spins * 360 + (360 - target);

  wheel.style.transition = "transform 2.5s cubic-bezier(.25,.8,.25,1)";
  wheelRotation = finalAngle;
  wheel.style.transform = `rotate(${wheelRotation}deg)`;

  setTimeout(() => {
    wheel.style.transition = "";
    wheelRotation %= 360;
    wheel.style.transform = `rotate(${wheelRotation}deg)`;
  }, 2600);
}
