// Генерация ID
function generateId() {
  return 'user-' + Math.random().toString(36).substr(2, 9);
}

// Хранилище
const storage = {
  get() {
    const data = localStorage.getItem('p2p-chat');
    return data ? JSON.parse(data) : { myId: null, friends: {} };
  },
  save(data) {
    localStorage.setItem('p2p-chat', JSON.stringify(data));
  }
};

let state = storage.get();
if (!state.myId) {
  state.myId = generateId();
  storage.save(state);
}

const myId = state.myId;
document.getElementById('myId').textContent = myId;

// Элементы
const friendsList = document.getElementById('friendsList');
const friendIdInput = document.getElementById('friendIdInput');
const addFriendBtn = document.getElementById('addFriend');
const generateIdBtn = document.getElementById('generateId');

const chatContainer = document.getElementById('chatContainer');
const chatWith = document.getElementById('chatWith');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessage');
const typingIndicator = document.getElementById('typingIndicator');

const offerText = document.getElementById('offerText');
const copyOffer = document.getElementById('copyOffer');
const friendOffer = document.getElementById('friendOffer');
const createAnswer = document.getElementById('createAnswer');
const answerText = document.getElementById('answerText');
const copyAnswer = document.getElementById('copyAnswer');
const answerBlock = document.getElementById('answerBlock');
const friendAnswer = document.getElementById('friendAnswer');
const connectPeer = document.getElementById('connectPeer');
const offerSection = document.getElementById('offerSection');
const inputArea = document.getElementById('inputArea');

// P2P соединения
const peers = {};

// Инициализация
renderFriends();
document.getElementById('generateId').onclick = () => {
  state.myId = generateId();
  storage.save(state);
  document.getElementById('myId').textContent = state.myId;
  myId = state.myId;
};

// Добавление друга
addFriendBtn.onclick = () => {
  const id = friendIdInput.value.trim();
  if (id && id !== myId && !state.friends[id]) {
    state.friends[id] = { name: id.substr(0, 12), connected: false };
    storage.save(state);
    renderFriends();
    friendIdInput.value = '';
  }
};

generateIdBtn.onclick = () => {
  state.myId = generateId();
  document.getElementById('myId').textContent = state.myId;
  storage.save(state);
};

// Рендер друзей
function renderFriends() {
  friendsList.innerHTML = '';
  Object.keys(state.friends).forEach(id => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${state.friends[id].name}</span>
      <button onclick="removeFriend('${id}')">×</button>
    `;
    li.onclick = (e) => {
      if (e.target.tagName !== 'BUTTON') openChat(id);
    };
    friendsList.appendChild(li);
  });
}

window.removeFriend = (id) => {
  delete state.friends[id];
  if (peers[id]) {
    peers[id].close();
    delete peers[id];
  }
  storage.save(state);
  renderFriends();
  if (document.getElementById('chatWith').dataset.id === id) {
    chatContainer.style.display = 'none';
  }
};

// Открытие чата
function openChat(friendId) {
  chatWith.textContent = state.friends[friendId].name;
  chatWith.dataset.id = friendId;
  messagesDiv.innerHTML = '';
  chatContainer.style.display = 'flex';

  offerSection.style.display = 'grid';
  inputArea.style.display = 'none';

  if (!peers[friendId]) {
    createPeer(friendId);
  } else if (peers[friendId].dataChannel?.readyState === 'open') {
    offerSection.style.display = 'none';
    inputArea.style.display = 'flex';
  }
}

// Создание пира
function createPeer(friendId) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  const dc = pc.createDataChannel('chat');
  dc.onopen = () => {
    offerSection.style.display = 'none';
    inputArea.style.display = 'flex';
    state.friends[friendId].connected = true;
    storage.save(state);
  };
  dc.onmessage = (e) => handleMessage(friendId, e.data);
  dc.onclose = () => {
    state.friends[friendId].connected = false;
    storage.save(state);
  };

  pc.ondatachannel = (e) => {
    pc.dataChannel = e.channel;
    e.channel.onmessage = (ev) => handleMessage(friendId, ev.data);
    e.channel.onopen = () => {
      offerSection.style.display = 'none';
      inputArea.style.display = 'flex';
    };
  };

  pc.onicecandidate = (e) => {
    if (e.candidate === null && pc.localDescription) {
      if (pc.localDescription.type === 'offer') {
        offerText.value = JSON.stringify(pc.localDescription);
      } else if (pc.localDescription.type === 'answer') {
        answerText.value = JSON.stringify(pc.localDescription);
      }
    }
  };

  peers[friendId] = pc;
  pc.dataChannel = dc;

  // Создание оффера
  pc.createOffer().then(offer => pc.setLocalDescription(offer));
}

// Обработка сообщений
let typingTimer;
function handleMessage(friendId, data) {
  const msg = JSON.parse(data);
  if (msg.type === 'message') {
    appendMessage(msg, false);
    markAsSeen(friendId, msg.id);
  } else if (msg.type === 'typing') {
    clearTimeout(typingTimer);
    typingIndicator.textContent = 'Печатает...';
    typingTimer = setTimeout(() => {
      typingIndicator.textContent = '';
    }, 1000);
  } else if (msg.type === 'seen') {
    const msgEl = document.querySelector(`[data-id="${msg.id}"]`);
    if (msgEl) msgEl.querySelector('.seen').textContent = '✓ Просмотрено';
  }
}

// Отправка
sendMessageBtn.onclick = () => send();
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  } else {
    sendTyping();
  }
});

function send() {
  const text = messageInput.value.trim();
  if (!text) return;

  const friendId = chatWith.dataset.id;
  const pc = peers[friendId];
  if (!pc?.dataChannel || pc.dataChannel.readyState !== 'open') return;

  const msg = {
    id: Date.now() + '-' + Math.random(),
    text,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: 'message'
  };

  pc.dataChannel.send(JSON.stringify(msg));
  appendMessage(msg, true);
  messageInput.value = '';
}

function sendTyping() {
  const friendId = chatWith.dataset.id;
  const pc = peers[friendId];
  if (pc?.dataChannel?.readyState === 'open') {
    pc.dataChannel.send(JSON.stringify({ type: 'typing' }));
  }
}

function appendMessage(msg, isOutgoing) {
  const div = document.createElement('div');
  div.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
  div.dataset.id = msg.id;

  let content = msg.text
    .replace(/https?:\/\/[^\s]+/g, url => `<a href="${url}" target="_blank">${url}</a>`)
    .replace(/https?:\/\/(www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/g, (m, _, id) => {
      return `<iframe class="youtube-embed" src="https://www.youtube.com/embed/${id}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    })
    .replace(/https?:\/\/youtu\.be\/([a-zA-Z0-9_-]+)/g, (m, id) => {
      return `<iframe class="youtube-embed" src="https://www.youtube.com/embed/${id}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    });

  div.innerHTML = `
    ${content}
    <span class="time">${msg.time} ${isOutgoing ? '<span class="seen"></span>' : ''}</span>
  `;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function markAsSeen(friendId, msgId) {
  const pc = peers[friendId];
  if (pc?.dataChannel?.readyState === 'open') {
    pc.dataChannel.send(JSON.stringify({ type: 'seen', id: msgId }));
  }
}

// Обмен сигналами
copyOffer.onclick = () => {
  offerText.select();
  document.execCommand('copy');
  alert('Оффер скопирован!');
};

createAnswer.onclick = async () => {
  const friendId = chatWith.dataset.id;
  const pc = peers[friendId];
  const offer = JSON.parse(friendOffer.value);
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  answerBlock.style.display = 'block';
};

copyAnswer.onclick = () => {
  answerText.select();
  document.execCommand('copy');
  alert('Ответ скопирован!');
};

connectPeer.onclick = async () => {
  const friendId = chatWith.dataset.id;
  const pc = peers[friendId];
  const answer = JSON.parse(friendAnswer.value);
  await pc.setRemoteDescription(answer);
};