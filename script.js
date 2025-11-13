// === script.js ===

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
const offerSection = document.getElementById('offerSection');
const inputArea = document.getElementById('inputArea');
const myOffer = document.getElementById('myOffer');
const friendOffer = document.getElementById('friendOffer');
const copyOffer = document.getElementById('copyOffer');
const saveOffer = document.getElementById('saveOffer');

// === Сжатие/распаковка ===
function compressSDP(sdp) {
  return LZString.compressToBase64(JSON.stringify(sdp));
}

function decompressSDP(str) {
  try {
    return JSON.parse(LZString.decompressFromBase64(str));
  } catch (e) {
    return null;
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
    offerSection.style.display = 'none';
    inputArea.style.display = 'flex';
    updateStatus('Подключено');
  };
  dc.onmessage = e => handleMessage(friendId, e.data);

  pc.ondatachannel = e => {
    pc.dc = e.channel;
    e.channel.onopen = () => {
      offerSection.style.display = 'none';
      inputArea.style.display = 'flex';
      updateStatus('Подключено');
    };
    e.channel.onmessage = ev => handleMessage(friendId, ev.data);
  };

  pc.onicecandidate = e => {
    if (!e.candidate && pc.localDescription) {
      const compressed = compressSDP(pc.localDescription);
      myOffer.value = compressed;
    }
  };

  if (isCaller) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer));
  }

  return pc;
}

// === Обработка сообщений ===
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
  offerSection.style.display = 'grid';
  inputArea.style.display = 'none';
  updateStatus('Генерация оффера...');

  if (!peers[id]) {
    createPeer(id, true);
  }
}

function updateStatus(text) {
  statusEl.textContent = text;
}

// === Копирование и сохранение ===
copyOffer.onclick = () => {
  myOffer.select();
  document.execCommand('copy');
  alert('Оффер скопирован!');
};

saveOffer.onclick = async () => {
  const friendSdpStr = friendOffer.value.trim();
  if (!friendSdpStr) {
    alert('Вставьте оффер друга');
    return;
  }

  const friendSdp = decompressSDP(friendSdpStr);
  if (!friendSdp) {
    alert('Неверный оффер друга');
    return;
  }

  const pc = peers[currentFriend];
  if (!pc) return;

  try {
    await pc.setRemoteDescription(friendSdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    updateStatus('Подключено! Можно писать.');
    offerSection.style.display = 'none';
    inputArea.style.display = 'flex';
  } catch (err) {
    console.error(err);
    alert('Ошибка подключения');
  }
};

// === Отправка ===
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

// Старт
renderFriends();