class PeerSkype {
    constructor() {
        this.myKey = null;
        this.friends = new Map(); // key → { pc, dc, online, lastPing }
        this.localStream = null;
        this.currentCall = null;

        this.init();
    }

    async init() {
        this.setupElements();
        this.setupMedia();
        this.loadData();
        this.setupPasteHandler();
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
            qrCode: document.getElementById('qr-code'),
            friendsSection: document.getElementById('friends-section'),
            friendsList: document.getElementById('friends-list'),
            friendsCount: document.getElementById('friends-count'),
            callSection: document.getElementById('call-section'),
            callPartner: document.getElementById('call-partner'),
            endCall: document.getElementById('end-call'),
            localVideo: document.getElementById('local-video'),
            remoteVideo: document.getElementById('remote-video'),
            pasteSignal: document.getElementById('paste-signal')
        };

        this.el.generateKey.onclick = () => this.generateKey();
        this.el.copyKey.onclick = () => this.copyKey();
        this.el.addFriend.onclick = () => this.addFriend();
        this.el.pasteSignal.onclick = () => this.pasteSignal();
        this.el.endCall.onclick = () => this.hangUp();
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
        this.generateQR();
        this.copyKey();
        this.saveData();
        this.toast('Ключ готов! QR и копия в буфере');
    }

    generateQR() {
        this.el.qrCode.innerHTML = '';
        new QRCode(this.el.qrCode, {
            text: this.myKey,
            width: 180,
            height: 180,
            colorDark: "#ffffff",
            colorLight: "#00000000"
        });
    }

    copyKey() {
        navigator.clipboard.writeText(this.myKey).then(() => this.toast('Ключ скопирован!'));
    }

    addFriend() {
        const key = this.el.friendKey.value.trim();
        if (!key || key === this.myKey) return this.toast('Неверный ключ');
        if (this.friends.has(key)) return this.toast('Уже добавлен');

        this.friends.set(key, { pc: null, dc: null, online: false, lastPing: 0 });
        this.el.friendKey.value = '';
        this.renderFriends();
        this.saveData();
        this.toast('Друг добавлен. Жди OFFER.');
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
        const friend = this.friends.get(friendKey);
        if (friend.pc) return this.toast('Уже в звонке');

        const pc = this.createPC(friendKey, true);
        friend.pc = pc;

        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
                const msg = btoa(JSON.stringify({ type: 'offer', sdp: pc.localDescription.sdp }));
                const text = `OFFER:${msg}`;
                navigator.clipboard.writeText(text).then(() => {
                    this.toast('OFFER скопирован! Отправь другу');
                });
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
        const dc = pc.createDataChannel('p2p');
        this.setupDataChannel(dc, friendKey);

        pc.ontrack = (e) => {
            this.el.remoteVideo.srcObject = e.streams[0];
            this.showCallUI(friendKey);
        };

        pc.ondatachannel = (e) => {
            this.setupDataChannel(e.channel, friendKey);
        };

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                const msg = btoa(JSON.stringify({ type: 'candidate', candidate: e.candidate }));
                navigator.clipboard.writeText(`ICE:${msg}`);
            }
        };

        return pc;
    }

    setupDataChannel(dc, friendKey) {
        const friend = this.friends.get(friendKey);
        friend.dc = dc;

        dc.onopen = () => {
            friend.online = true;
            friend.lastPing = Date.now();
            this.renderFriends();
            this.startPing(friendKey);
        };

        dc.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === 'ping') {
                friend.lastPing = Date.now();
                dc.send(JSON.stringify({ type: 'pong' }));
            }
        };

        dc.onclose = () => {
            friend.online = false;
            this.renderFriends();
        };
    }

    startPing(friendKey) {
        const interval = setInterval(() => {
            const friend = this.friends.get(friendKey);
            if (!friend.dc || friend.dc.readyState !== 'open') {
                clearInterval(interval);
                return;
            }
            if (Date.now() - friend.lastPing > 10000) {
                friend.online = false;
                this.renderFriends();
            } else {
                friend.dc.send(JSON.stringify({ type: 'ping' }));
            }
        }, 3000);
    }

    async pasteSignal() {
        try {
            const text = await navigator.clipboard.readText();
            this.handleSignal(text);
        } catch (err) {
            this.toast('Не удалось прочитать буфер');
        }
    }

    setupPasteHandler() {
        document.addEventListener('paste', (e) => {
            const text = (e.clipboardData || window.clipboardData).getData('text');
            if (text.startsWith('OFFER:') || text.startsWith('ICE:')) {
                e.preventDefault();
                this.handleSignal(text);
            }
        });
    }

    handleSignal(text) {
        if (!text.startsWith('OFFER:') && !text.startsWith('ICE:')) return;

        const [type, payload] = text.split(':');
        const data = JSON.parse(atob(payload));
        const friendKey = data.from || Object.keys(this.friends).find(k => this.friends.get(k).pc);

        if (!this.friends.has(friendKey)) return;

        const friend = this.friends.get(friendKey);
        if (!friend.pc) {
            friend.pc = this.createPC(friendKey, false);
        }

        if (type === 'OFFER') {
            friend.pc.setRemoteDescription(new RTCSessionDescription(data))
                .then(() => friend.pc.createAnswer())
                .then(answer => friend.pc.setLocalDescription(answer))
                .then(() => {
                    const msg = btoa(JSON.stringify({ type: 'answer', sdp: friend.pc.localDescription.sdp }));
                    navigator.clipboard.writeText(`ANSWER:${msg}`);
                    this.toast('ANSWER отправлен');
                });
        } else if (type === 'ANSWER' && friend.pc) {
            friend.pc.setRemoteDescription(new RTCSessionDescription(data));
        } else if (type === 'ICE' && friend.pc) {
            friend.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    }

    showCallUI(key) {
        this.el.callPartner.textContent = key;
        this.el.callSection.classList.remove('hidden');
    }

    hangUp() {
        if (this.currentCall) {
            const friend = this.friends.get(this.currentCall);
            if (friend.pc) friend.pc.close();
            friend.pc = null; friend.dc = null; friend.online = false;
            this.currentCall = null;
        }
        this.el.remoteVideo.srcObject = null;
        this.el.callSection.classList.add('hidden');
    }

    saveData() {
        const data = { myKey: this.myKey, friends: Array.from(this.friends.keys()) };
        localStorage.setItem('peerskype_p2p', JSON.stringify(data));
    }

    loadData() {
        const raw = localStorage.getItem('peerskype_p2p');
        if (raw) {
            const data = JSON.parse(raw);
            this.myKey = data.myKey;
            if (this.myKey) {
                this.el.publicKey.value = this.myKey;
                this.el.noKey.classList.add('hidden');
                this.el.hasKey.classList.remove('hidden');
                this.generateQR();
            }
            data.friends.forEach(key => {
                this.friends.set(key, { pc: null, dc: null, online: false, lastPing: 0 });
            });
            this.renderFriends();
        }
    }

    toast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.remove('hidden');
        setTimeout(() => t.classList.add('hidden'), 3000);
    }
}

const app = new PeerSkype();
window.app = app;