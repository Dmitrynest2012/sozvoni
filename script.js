class PeerSkype {
    constructor() {
        this.ws = null;
        this.myKey = null;
        this.friends = new Map(); // key → { online, ringing, pc }
        this.localStream = null;
        this.currentCall = null;

        this.init();
    }

    async init() {
        this.setupElements();
        this.setupWebSocket();
        this.setupMedia();
        this.loadData();
    }

    setupElements() {
        this.el = {
            generateKey: document.getElementById('generate-key'),
            noKey: document.getElementById('no-key'),
            hasKey: document.getElementById('has-key'),
            publicKey: document.getElementById('public-key'),
            copyKey: document.getElementById('copy-key'),
            friendKey: document.getElementById('friend-key'),
            addFriend: document.getElementById('add-friend'),
            friendsSection: document.getElementById('friends-section'),
            friendsList: document.getElementById('friends-list'),
            friendsCount: document.getElementById('friends-count'),
            callSection: document.getElementById('call-section'),
            callPartner: document.getElementById('call-partner'),
            endCall: document.getElementById('end-call'),
            localVideo: document.getElementById('local-video'),
            remoteVideo: document.getElementById('remote-video'),
            statusIcon: document.getElementById('status-icon'),
            statusText: document.getElementById('status-text')
        };

        this.el.generateKey.onclick = () => this.generateKey();
        this.el.copyKey.onclick = () => this.copyKeyToClipboard();
        this.el.addFriend.onclick = () => this.addFriend();
        this.el.endCall.onclick = () => this.hangUp();
    }

    setupWebSocket() {
        // Бесплатный публичный сигнальный сервер
        this.ws = new WebSocket('wss://signaling.peerskype.live');

        this.ws.onopen = () => {
            this.updateStatus('online', 'Подключено');
            if (this.myKey) this.send({ type: 'register', key: this.myKey });
        };

        this.ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            this.handleSignal(msg);
        };

        this.ws.onclose = () => {
            this.updateStatus('offline', 'Нет связи');
            setTimeout(() => this.setupWebSocket(), 3000);
        };
    }

    async setupMedia() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this.el.localVideo.srcObject = this.localStream;
        } catch (err) {
            this.toast('Нет доступа к камере/микрофону');
        }
    }

    generateKey() {
        this.myKey = 'psk_' + Math.random().toString(36).substr(2, 12);
        this.el.publicKey.value = this.myKey;
        this.el.noKey.classList.add('hidden');
        this.el.hasKey.classList.remove('hidden');
        this.copyKeyToClipboard();
        this.saveData();
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.send({ type: 'register', key: this.myKey });
        }
    }

    copyKeyToClipboard() {
        navigator.clipboard.writeText(this.myKey).then(() => this.toast('Ключ скопирован!'));
    }

    addFriend() {
        const key = this.el.friendKey.value.trim();
        if (!key || key === this.myKey) return this.toast('Неверный ключ');
        if (this.friends.has(key)) return this.toast('Уже добавлен');

        this.friends.set(key, { online: false, ringing: false, pc: null });
        this.el.friendKey.value = '';
        this.renderFriends();
        this.saveData();
        this.toast('Друг добавлен');
    }

    renderFriends() {
        this.el.friendsList.innerHTML = '';
        this.el.friendsCount.textContent = this.friends.size;

        if (this.friends.size === 0) {
            this.el.friendsSection.classList.add('hidden');
            return;
        }
        this.el.friendsSection.classList.remove('hidden');

        this.friends.forEach((data, key) => {
            const li = document.createElement('li');
            li.className = 'friend-item';
            li.innerHTML = `
                <div class="status-dot ${data.online ? 'online' : ''} ${data.ringing ? 'ringing' : ''}"></div>
                <div class="friend-info">
                    <div class="friend-key">${key}</div>
                </div>
                <button class="btn-success" onclick="app.call('${key}')">
                    <i class="fas fa-phone"></i> Позвонить
                </button>
            `;
            this.el.friendsList.appendChild(li);
        });
    }

    call(friendKey) {
        if (!this.friends.get(friendKey)?.online) return this.toast('Друг оффлайн');

        const pc = this.createPC(friendKey, true);
        this.friends.get(friendKey).pc = pc;
        this.currentCall = friendKey;
        this.showCallUI(friendKey);

        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
                this.send({ type: 'offer', to: friendKey, sdp: pc.localDescription });
            });
    }

    createPC(friendKey, isCaller) {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));

        pc.ontrack = (e) => {
            this.el.remoteVideo.srcObject = e.streams[0];
        };

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.send({ type: 'candidate', to: friendKey, candidate: e.candidate });
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed') {
                this.toast('Соединение разорвано');
                this.hangUp();
            }
        };

        return pc;
    }

    handleSignal(msg) {
        const friendKey = msg.from;
        if (!this.friends.has(friendKey)) {
            this.friends.set(friendKey, { online: true, ringing: false, pc: null });
            this.renderFriends();
            this.saveData();
        }

        const friend = this.friends.get(friendKey);
        friend.online = true;

        if (msg.type === 'offer') {
            this.incomingCall(friendKey, msg.sdp);
        } else if (msg.type === 'answer' && friend.pc) {
            friend.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        } else if (msg.type === 'candidate' && friend.pc) {
            friend.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } else if (msg.type === 'online') {
            friend.online = true;
            this.renderFriends();
        } else if (msg.type === 'offline') {
            friend.online = false;
            this.renderFriends();
        }
    }

    incomingCall(friendKey, sdp) {
        const friend = this.friends.get(friendKey);
        friend.ringing = true;
        this.renderFriends();

        // Вибрация + мигание
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        this.toast(`Входящий звонок от ${friendKey}`);

        // Автоответ при нажатии "Позвонить"
        setTimeout(() => {
            if (friend.ringing) {
                const pc = this.createPC(friendKey, false);
                friend.pc = pc;
                this.currentCall = friendKey;
                this.showCallUI(friendKey);

                pc.setRemoteDescription(new RTCSessionDescription(sdp))
                    .then(() => pc.createAnswer())
                    .then(answer => pc.setLocalDescription(answer))
                    .then(() => {
                        this.send({ type: 'answer', to: friendKey, sdp: pc.localDescription });
                        friend.ringing = false;
                        this.renderFriends();
                    });
            }
        }, 500);
    }

    showCallUI(key) {
        this.el.callPartner.textContent = key;
        this.el.callSection.classList.remove('hidden');
    }

    hangUp() {
        if (this.currentCall && this.friends.get(this.currentCall)?.pc) {
            this.friends.get(this.currentCall).pc.close();
            this.friends.get(this.currentCall).pc = null;
        }
        this.currentCall = null;
        this.el.remoteVideo.srcObject = null;
        this.el.callSection.classList.add('hidden');
    }

    send(msg) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ ...msg, from: this.myKey }));
        }
    }

    updateStatus(status, text) {
        this.el.statusIcon.className = `fas fa-circle ${status === 'online' ? 'text-success' : 'text-danger'}`;
        this.el.statusText.textContent = text;
    }

    toast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.remove('hidden');
        setTimeout(() => t.classList.add('hidden'), 3000);
    }

    saveData() {
        const data = {
            myKey: this.myKey,
            friends: Array.from(this.friends.keys())
        };
        localStorage.setItem('peerskype_v3', JSON.stringify(data));
    }

    loadData() {
        const raw = localStorage.getItem('peerskype_v3');
        if (raw) {
            const data = JSON.parse(raw);
            this.myKey = data.myKey;
            if (this.myKey) {
                this.el.publicKey.value = this.myKey;
                this.el.noKey.classList.add('hidden');
                this.el.hasKey.classList.remove('hidden');
            }
            data.friends.forEach(key => {
                this.friends.set(key, { online: false, ringing: false, pc: null });
            });
            this.renderFriends();
        }
    }
}

// Запуск
const app = new PeerSkype();
window.app = app;

// Пинг каждые 10 сек
setInterval(() => {
    if (app.ws?.readyState === WebSocket.OPEN && app.myKey) {
        app.send({ type: 'ping' });
    }
}, 10000);