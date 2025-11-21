const socket = io();

/* -------------------------
   PAGE ELEMENTS
------------------------- */
const loginPage = document.getElementById("loginPage");
const auctionPage = document.getElementById("auctionPage");

const createName = document.getElementById("createName");
const joinName = document.getElementById("joinName");
const joinRoomId = document.getElementById("joinRoomId");

document.getElementById("createRoomBtn").onclick = () => {
  if (!createName.value) return alert("Enter name");
  socket.emit("createRoom", createName.value);
};

document.getElementById("joinRoomBtn").onclick = () => {
  if (!joinName.value || !joinRoomId.value) return alert("Enter all fields");
  socket.emit("joinRoom", { roomId: joinRoomId.value.trim(), name: joinName.value });
};

const roomIdDisplay = document.getElementById("roomIdDisplay");
const startSpinBtn = document.getElementById("startSpinBtn");

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

/* -------------------------
   LOCAL DATA
------------------------- */
let currentRoom = null;
let myId = null;

/* -------------------------
   SOCKET RESPONSES
------------------------- */
socket.on("roomJoined", (roomId) => {
  currentRoom = roomId;
  joinAuctionPage(roomId);
});

socket.on("error", (msg) => alert(msg));

socket.on("roomState", (state) => {
  renderRoomState(state);
});

socket.on("wheelResult", ({ index, position }) => {
  spinWheelAnimation(index);
});

/* -------------------------
   PAGE SWITCH
------------------------- */
function joinAuctionPage(roomId) {
  loginPage.classList.add("hidden");
  auctionPage.classList.remove("hidden");
  roomIdDisplay.innerText = "Room ID — " + roomId;
}

/* -------------------------
   RENDER EVERYTHING
------------------------- */
function renderRoomState(state) {
  if (!myId) myId = socket.id;

  startSpinBtn.style.display = myId === state.hostId ? "inline-block" : "none";

  if (state.currentPlayer) {
    playerNameBox.innerText = state.currentPlayer.name;
    playerPosBox.innerText = "(" + state.currentPosition + ")";
    playerBaseBox.innerText = "Base Price: " + state.currentPlayer.basePrice + "M";
  } else {
    playerNameBox.innerText = "Player Name";
    playerPosBox.innerText = "Position";
    playerBaseBox.innerText = "Base Price";
  }

  initialTimerBox.innerText = state.initialTimeLeft;
  bidTimerBox.innerText = state.bidTimeLeft;

  // Timer blinking
  initialTimerBox.classList.toggle("blink", state.initialTimeLeft <= 5);
  bidTimerBox.classList.toggle("blink", state.bidTimeLeft <= 5);

  // Bid button
  if (!state.auctionActive || !state.currentPlayer) {
    bidBtn.disabled = true;
  } else {
    const me = state.players[myId];
    let nextBid =
      state.currentBid === 0
        ? state.currentPlayer.basePrice
        : state.currentBid < 200
          ? state.currentBid + 5
          : state.currentBid + 10;

    bidBtn.innerText = "Bid " + nextBid + "M";
    bidBtn.disabled = !me || me.balance < nextBid || state.currentBidder === myId;
  }

  skipBtn.disabled = !(state.auctionActive && state.currentPlayer);

  renderLog(state.log);
  renderSummary(state.players);
  renderRemaining(state.remainingPlayersByPosition);
  renderUnsold(state.unsoldPlayers);
}

/* -------------------------
   LOG RENDERING
------------------------- */
function renderLog(logs) {
  logBox.innerHTML = logs.map(l => {
    if (l.type === "win") return `<div class="logWin">${l.text}</div>`;
    if (l.type === "skip") return `<div class="logSkip">${l.text}</div>`;
    if (l.type === "spin") return `<div class="logSpin">${l.text}</div>`;
    if (l.type === "unsold") return `<div class="logUnsold">${l.text}</div>`;
    return `<div class="logInfo">${l.text}</div>`;
  }).join("");
}

/* -------------------------
   SUMMARY
------------------------- */
function renderSummary(players) {
  summaryList.innerHTML = "";
  for (let id in players) {
    let p = players[id];
    let div = document.createElement("div");
    div.className = "summary-player";

    div.innerHTML = `
      <div><b>${p.name}</b> — Balance: ${p.balance}M — Players: ${p.team.length}/11</div>
      <div class="teamList">${p.team.map(t => `${t.name} — ${t.price}M`).join("<br>")}</div>
    `;

    div.onclick = () => {
      div.querySelector(".teamList").classList.toggle("show");
    };

    summaryList.appendChild(div);
  }
}

/* -------------------------
   REMAINING PLAYERS
------------------------- */
function renderRemaining(groups) {
  remainingBox.innerHTML = "";

  for (let pos in groups) {
    const players = groups[pos];

    const wrap = document.createElement("div");
    wrap.className = "collapseSection";

    const header = document.createElement("div");
    header.className = "collapseHeader";
    header.innerText = `${pos} (${players.length})`;
    header.onclick = () =>
      body.classList.toggle("show");

    const body = document.createElement("div");
    body.className = "collapseBody";
    body.innerHTML = players
      .map(p => `<div>${p.name} — ${p.basePrice}M</div>`)
      .join("");

    wrap.appendChild(header);
    wrap.appendChild(body);
    remainingBox.appendChild(wrap);
  }
}

/* -------------------------
   UNSOLD PLAYERS
------------------------- */
function renderUnsold(list) {
  if (list.length === 0) {
    unsoldBox.innerHTML = "<i>No unsold players</i>";
    return;
  }

  unsoldBox.innerHTML = list
    .map(u => `<div>${u.position} — ${u.name} (${u.basePrice}M)</div>`)
    .join("");
}

/* -------------------------
   BUTTONS
------------------------- */
startSpinBtn.onclick = () => socket.emit("startSpin", currentRoom);
bidBtn.onclick = () => socket.emit("bid", currentRoom);
skipBtn.onclick = () => socket.emit("skip", currentRoom);

/* -------------------------
   WHEEL ANIMATION
------------------------- */
function spinWheelAnimation(index) {
  // simple wheel rotation
  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");

  const slices = 10;
  let angle = 0;
  let finalAngle = (index * (2 * Math.PI / slices)) + Math.PI * 8;

  let speed = 0.25;
  let spinning = setInterval(() => {
    ctx.clearRect(0, 0, 320, 320);

    angle += speed;
    if (angle >= finalAngle) {
      angle = finalAngle;
      clearInterval(spinning);
    }

    drawWheel(ctx, angle);
  }, 20);
}

function drawWheel(ctx, angle) {
  const positions = ["GK","CB","RB","LB","RW","CF","AM","LW","CM","DM"];
  const slices = 10;

  for (let i = 0; i < slices; i++) {
    ctx.beginPath();
    ctx.moveTo(160, 160);
    ctx.arc(160, 160, 150, angle + i * 2 * Math.PI / slices, angle + (i + 1) * 2 * Math.PI / slices);
    ctx.fillStyle = i % 2 === 0 ? "#ddd" : "#bbb";
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.translate(160, 160);
    ctx.rotate(angle + (i + 0.5) * 2 * Math.PI / slices);
    ctx.fillStyle = "#000";
    ctx.font = "16px Arial";
    ctx.fillText(positions[i], 60, 5);
    ctx.restore();
  }
}
