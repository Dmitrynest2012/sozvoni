// === script.js (ИСПРАВЛЕННЫЙ) ===

function generateId() {
  return 'u' + Math.random().toString(36).substr(2, 8);
}

const myId = localStorage.getItem('myId') || generateId();
localStorage.setItem('myId', myId);
document.getElementById('myId').textContent = myId;

const friends = JSON.parse(localStorage.getItem('friends') || '{}');
const peers = {};
let currentFriend = null;
let typingTimer;

// UI
const friendsList = document.getElementById('friendsList');
const friendIdInput = document.getElementById('friendIdInput');
const addFriendBtn = document.getElementById('addFriend');
const generateIdBtn = document.getElementById('generateId');
const chatContainer = document.getElementById('chatContainer');
const chatWith = document.getElementById('chatWith');
const statusEl = document.getElementById('status');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessage');
const typingIndicator = document.getElementById('typingIndicator');
const qrSection = document.getElementById('qrSection');
const inputArea = document.getElementById('inputArea');
const qrcodeDiv = document.getElementById('qrcode');
const scanQrBtn = document.getElementById('scanQr');
const qrInput = document.getElementById('qrInput');

// === QRCode (правильная инициализация) ===
let qrCodeInstance = null;

// Генерация QR-кода
function generateQR(sdp) {
  const data = JSON.stringify({ from: myId, sdp: sdp });
  qrcodeDiv.innerHTML = ''; // Очистить
  qrCodeInstance = new QRCode(qrcodeDiv, {
    text: data,
    width: 200,
    height: 200,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
  updateStatus('QR готов. Попросите друга отсканировать.');
}

// === Сканирование QR ===
scanQrBtn.onclick = () => qrInput.click();

qrInput.onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    // Используем jsQR (встроен в qrcode.js)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (code) {
      handleScannedQR(code.data);
    } else {
      alert('QR-код не распознан. Попробуйте ещё раз.');
    }
  };
  img.src = URL.createObjectURL(file);
};

async function handleScannedQR(dataStr) {
  try {
    const data = JSON.parse(dataStr);
    if (data.from !== currentFriend) {
      alert('Это QR-код не от вашего друга!');
      return;
    }

    const pc = peers[currentFriend] || createPeer(currentFriend, false);
    await pc.setRemoteDescription(data.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // После ответа — генерируем QR с answer (для друга)
    generateQR(pc.localDescription);
    updateStatus('Ответ отправлен. Ждём подключения...');
  } catch (err) {
    console.error(err);
    alert('Ошибка обработки QR');
  }
}

// === P2P ===
function createPeer(friendId, isCaller = true) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peers[friendId] = pc;

  const dc = pc.createDataChannel('chat');
  dc.onopen = () => {
    qrSection.style.display = 'none';
    inputArea.style.display = 'flex';
    updateStatus('Подключено');
  };
  dc.onmessage = e => handleMessage(friendId, e.data);

  pc.ondatachannel = e => {
    pc.dc = e.channel;
    e.channel.onopen = () => {
      qrSection.style.display = 'none';
      inputArea.style.display = 'flex';
      updateStatus('Подключено');
    };
    e.channel.onmessage = ev => handleMessage(friendId, ev.data);
  };

  pc.onicecandidate = e => {
    if (!e.candidate && pc.localDescription) {
      if (isCaller) {
        generateQR(pc.localDescription);
      }
    }
  };

  if (isCaller) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer));
  }

  return pc;
}

// === Сообщения ===
function handleMessage(friendId, data) {
  const msg = JSON.parse(data);
  if (msg.type === 'text') {
    appendMessage(msg, false);
    sendSeen(friendId, msg.id);
  } else if (msg.type === 'typing') {
    clearTimeout(typingTimer);
    typingIndicator.textContent = 'Печатает...';
    typingTimer = setTimeout(() => typingIndicator.textContent = '', 1000);
  } else if (msg.type === 'seen') {
    const el = document.querySelector(`[data-id="${msg.id}"] .seen`);
    if (el) el.textContent = '✓';
  }
}

function sendSeen(friendId, id) {
  const dc = peers[friendId]?.dc;
  if (dc?.readyState === 'open') {
    dc.send(JSON.stringify({ type: 'seen', id }));
  }
}

function appendMessage(msg, isOut) {
  const div = document.createElement('div');
  div.className = `message ${isOut ? 'outgoing' : 'incoming'}`;
  div.dataset.id = msg.id;

  let html = msg.text
    .replace(/https?:\/\/[^\s]+/g, u => `<a href="${u}" target="_blank">${u}</a>`)
    .replace(/(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/g, 
      (_, __, ___, ____, id) => `<iframe class="youtube-embed" src="https://www.youtube.com/embed/${id}" allowfullscreen></iframe>`
    );

  div.innerHTML = `${html}<span class="time">${msg.time} ${isOut ? '<span class="seen"></span>' : ''}</span>`;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// === UI ===
generateIdBtn.onclick = () => {
  localStorage.setItem('myId', generateId());
  location.reload();
};

addFriendBtn.onclick = () => {
  const id = friendIdInput.value.trim();
  if (id && id !== myId && !friends[id]) {
    friends[id] = { name: id.slice(0, 10) };
    saveFriends();
    renderFriends();
    friendIdInput.value = '';
  }
};

function renderFriends() {
  friendsList.innerHTML = '';
  Object.keys(friends).forEach(id => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${friends[id].name}</span><button onclick="removeFriend('${id}')">×</button>`;
    li.onclick = e => e.target.tagName !== 'BUTTON' && openChat(id);
    friendsList.appendChild(li);
  });
}

window.removeFriend = id => {
  delete friends[id];
  if (peers[id]) peers[id].close();
  delete peers[id];
  saveFriends();
  renderFriends();
  if (currentFriend === id) chatContainer.style.display = 'none';
};

function openChat(id) {
  currentFriend = id;
  chatWith.textContent = friends[id].name;
  messagesDiv.innerHTML = '';
  chatContainer.style.display = 'flex';
  qrSection.style.display = 'block';
  inputArea.style.display = 'none';
  updateStatus('Генерация QR...');

  if (!peers[id]) {
    createPeer(id, true);
  }
}

function updateStatus(text) {
  statusEl.textContent = text;
}

sendMessageBtn.onclick = sendMsg;
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMsg();
  } else {
    const dc = peers[currentFriend]?.dc;
    if (dc?.readyState === 'open') {
      dc.send(JSON.stringify({ type: 'typing' }));
    }
  }
});

function sendMsg() {
  const text = messageInput.value.trim();
  if (!text || !currentFriend) return;

  const msg = {
    id: Date.now() + Math.random(),
    text,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: 'text'
  };

  const dc = peers[currentFriend]?.dc;
  if (dc?.readyState === 'open') {
    dc.send(JSON.stringify(msg));
    appendMessage(msg, true);
    messageInput.value = '';
  }
}

function saveFriends() {
  localStorage.setItem('friends', JSON.stringify(friends));
}

// === jsQR (встроен в qrcode.js) ===
const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
script.onload = () => {
  console.log('jsQR загружен');
  renderFriends();
};
document.head.appendChild(script);