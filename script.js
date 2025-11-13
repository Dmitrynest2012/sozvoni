// === script.js (ИСПРАВЛЕНО: автоподключение + отправка сообщений) ===

function generateId() {
  return 'u' + Math.random().toString(36).substr(2, 8);
}

const myId = localStorage.getItem('myId') || generateId();
localStorage.setItem('myId', myId);
document.getElementById('myId').textContent = myId;

let friends = JSON.parse(localStorage.getItem('friends') || '{}');
const peers = {};
let currentFriend = null;
let typingTimer;

// Хранилище офферов: { friendId: { myOffer: "...", friendOffer: "..." } }
let offers = JSON.parse(localStorage.getItem('offers') || '{}');

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

// === Сжатие ===
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

// === Сохранение офферов ===
function saveOfferData(friendId, key, value) {
  if (!offers[friendId]) offers[friendId] = {};
  offers[friendId][key] = value;
  localStorage.setItem('offers', JSON.stringify(offers));
}
function getOfferData(friendId, key) {
  return offers[friendId]?.[key] || '';
}

// === P2P: Создание пира (только если нет) ===
function createPeer(friendId, isCaller = true) {
  if (peers[friendId]) return peers[friendId];

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peers[friendId] = pc;

  let dc;
  if (isCaller) {
    dc = pc.createDataChannel('chat');
  }

  pc.ondatachannel = e => {
    dc = e.channel;
    setupDataChannel(dc);
  };

  if (isCaller) {
    setupDataChannel(dc);
  }

  function setupDataChannel(channel) {
    channel.onopen = () => {
      offerSection.style.display = 'none';
      inputArea.style.display = 'flex';
      updateStatus('Подключено');
      renderFriends();
    };
    channel.onmessage = e => handleMessage(friendId, e.data);
  }

  pc.onicecandidate = e => {
    if (!e.candidate && pc.localDescription) {
      const compressed = compressSDP(pc.localDescription);
      myOffer.value = compressed;
      saveOfferData(friendId, 'myOffer', compressed);
    }
  };

  if (isCaller) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer));
  }

  return pc;
}

// === Автоподключение ===
async function tryAutoConnect(friendId) {
  const mySdpStr = getOfferData(friendId, 'myOffer');
  const friendSdpStr = getOfferData(friendId, 'friendOffer');

  if (!mySdpStr || !friendSdpStr) return false;

  const mySdp = decompressSDP(mySdpStr);
  const friendSdp = decompressSDP(friendSdpStr);
  if (!mySdp || !friendSdp) return false;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peers[friendId] = pc;

  pc.ondatachannel = e => {
    const dc = e.channel;
    dc.onopen = () => {
      offerSection.style.display = 'none';
      inputArea.style.display = 'flex';
      updateStatus('Восстановлено');
      renderFriends();
    };
    dc.onmessage = ev => handleMessage(friendId, ev.data);
  };

  try {
    await pc.setLocalDescription(mySdp);
    await pc.setRemoteDescription(friendSdp);
    return true;
  } catch (err) {
    console.error('Автоподключение не удалось:', err);
    delete peers[friendId];
    return false;
  }
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
  const dc = peers[friendId]?.dc || peers[friendId]?.datachannel;
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
    const isConnected = peers[id]?.dc?.readyState === 'open' || peers[id]?.datachannel?.readyState === 'open';
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${friends[id].name} ${isConnected ? '<span style="color:#0f0">●</span>' : ''}</span>
      <button onclick="removeFriend('${id}')">×</button>
    `;
    li.onclick = e => e.target.tagName !== 'BUTTON' && openChat(id);
    friendsList.appendChild(li);
  });
}

window.removeFriend = id => {
  delete friends[id];
  if (peers[id]) peers[id].close();
  delete peers[id];
  delete offers[id];
  localStorage.setItem('offers', JSON.stringify(offers));
  saveFriends();
  renderFriends();
  if (currentFriend === id) chatContainer.style.display = 'none';
};

async function openChat(id) {
  currentFriend = id;
  chatWith.textContent = friends[id].name;
  messagesDiv.innerHTML = '';
  chatContainer.style.display = 'flex';

  // Восстанавливаем офферы
  myOffer.value = getOfferData(id, 'myOffer');
  friendOffer.value = getOfferData(id, 'friendOffer');

  // Пробуем автоподключение
  if (await tryAutoConnect(id)) {
    renderFriends();
    return;
  }

  // Если нет пира — создаём
  if (!peers[id]) {
    updateStatus('Генерация оффера...');
    createPeer(id, true);
  }

  offerSection.style.display = 'grid';
  inputArea.style.display = 'none';
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

    // Сохраняем ответ
    saveOfferData(currentFriend, 'friendOffer', friendSdpStr);
    saveOfferData(currentFriend, 'myOffer', compressSDP(pc.localDescription));

    updateStatus('Подключено! Можно писать.');
    offerSection.style.display = 'none';
    inputArea.style.display = 'flex';
    renderFriends();
  } catch (err) {
    console.error(err);
    alert('Ошибка подключения: ' + err.message);
  }
};

// === Отправка ===
sendMessageBtn.onclick = sendMsg;
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMsg();
  } else {
    const dc = peers[currentFriend]?.dc || peers[currentFriend]?.datachannel;
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

  const dc = peers[currentFriend]?.dc || peers[currentFriend]?.datachannel;
  if (dc?.readyState === 'open') {
    dc.send(JSON.stringify(msg));
    appendMessage(msg, true);
    messageInput.value = '';
  } else {
    alert('Нет соединения');
  }
}

function saveFriends() {
  localStorage.setItem('friends', JSON.stringify(friends));
}

// === Сохранение при закрытии ===
window.addEventListener('beforeunload', () => {
  if (currentFriend && myOffer.value) {
    saveOfferData(currentFriend, 'myOffer', myOffer.value);
  }
});

// Старт
renderFriends();