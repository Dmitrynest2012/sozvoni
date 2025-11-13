class PeerSkype {
    constructor() {
        this.myKey = null;
        this.friends = new Map(); // key → { pc: null, dc: null, online: false }
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
            pasteOffer: document.getElementById('paste-offer')
        };

        this.el.generateKey.onclick = () => this.generateKey();
        this.el.copyKey.onclick = () => this.copyKey();
        this.el.addFriend.onclick = () => this.addFriend();
        this.el.pasteOffer.onclick = () => this.pasteOffer();
        this.el.endCall.onclick = () => this.hangUp();
    }

    async setupMedia() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this.el.localVideo.srcObject = this.localStream;
        } catch (err) {
            this.toast('Нет камеры/микрофона');
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
        this.toast('Ключ готов! Отправь другу');
    }

    generateQR() {
        this.el.qrCode.innerHTML = '';
        new QRCode(this.el.qrCode, {
            text: this.myKey,
            width: 160,
            height: 160,
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

        this.friends.set(key, { pc: null, dc: null, online: false });
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
                <div class="status-dot ${data.online ? 'online' : ''}"></div>
                <div class="friend-info">
                    <div class="friend-key">${key}</div>
                </div>
                <button class="btn-success" onclick="app.call('${key}')">
                    Позвонить
                </button>
            `;
            this.el.friendsList.appendChild(li);
        });
    }

    call(friendKey) {
        const friend = this.friends.get(friendKey);
        if (friend.pc) return this.toast('Звонок уже идёт');

        const pc = this.createPC(friendKey, true);
        friend.pc = pc;

        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
                const payload = btoa(JSON.stringify({ type: 'offer', sdp: pc.localDescription.sdp }));
                const text = `OFFER:${payload}`;
                navigator.clipboard.writeText(text).then(() => {
                    this.toast('OFFER скопирован! Отправь другу');
                });
            });
    }

    createPC(friendKey, isCaller) {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));

        const dc = pc.createDataChannel('chat');
        this.setupDataChannel(dc, friendKey);

        pc.ontrack = (e) => {
            this.el.remoteVideo.srcObject = e.streams[0];
            this.showCallUI(friendKey);
            this.currentCall = friendKey;
        };

        pc.ondatachannel = (e) => this.setupDataChannel(e.channel, friendKey);

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                const payload = btoa(JSON.stringify({ type: 'candidate', candidate: e.candidate }));
                navigator.clipboard.writeText(`ICE:${payload}`);
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

    setupDataChannel(dc, friendKey) {
        const friend = this.friends.get(friendKey);
        friend.dc = dc;

        dc.onopen = () => {
            friend.online = true;
            this.renderFriends();
            this.toast('P2P-соединение установлено!');
        };

        dc.onclose = () => {
            friend.online = false;
            this.renderFriends();
        };
    }

    async pasteOffer() {
        try {
            const text = await navigator.clipboard.readText();
            if (!text.startsWith('OFFER:')) return this.toast('Это не OFFER');

            const payload = text.split(':')[1];
            const data = JSON.parse(atob(payload));

            // Найдём, от кого
            let friendKey = null;
            for (const [k, v] of this.friends) {
                if (v.pc && v.pc.remoteDescription?.sdp.includes(data.sdp.slice(0, 50))) {
                    friendKey = k;
                    break;
                }
            }
            if (!friendKey) return this.toast('Друг не найден');

            const friend = this.friends.get(friendKey);
            if (friend.pc) friend.pc.close();

            const pc = this.createPC(friendKey, false);
            friend.pc = pc;

            await pc.setRemoteDescription(new RTCSessionDescription(data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            const answerPayload = btoa(JSON.stringify({ type: 'answer', sdp: answer.sdp }));
            await navigator.clipboard.writeText(`ANSWER:${answerPayload}`);
            this.toast('ANSWER скопирован! Отправь другу');
        } catch (err) {
            this.toast('Ошибка: ' + err.message);
        }
    }

    setupPasteHandler() {
        document.addEventListener('paste', (e) => {
            const text = (e.clipboardData || window.clipboardData).getData('text');
            if (text.startsWith('OFFER:') || text.startsWith('ANSWER:') || text.startsWith('ICE:')) {
                e.preventDefault();
                this.handleSignal(text);
            }
        });
    }

    handleSignal(text) {
        if (!text.startsWith('OFFER:') && !text.startsWith('ANSWER:') && !text.startsWith('ICE:')) return;

        const [type, payload] = text.split(':');
        const data = JSON.parse(atob(payload));

        let friendKey = this.currentCall;
        if (!friendKey) return;

        const friend = this.friends.get(friendKey);
        if (!friend.pc) return;

        if (type === 'ANSWER') {
            friend.pc.setRemoteDescription(new RTCSessionDescription(data));
        } else if (type === 'ICE') {
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
            if (friend.pc) {
                friend.pc.close();
                friend.pc = null;
                friend.dc = null;
                friend.online = false;
            }
            this.currentCall = null;
        }
        this.el.remoteVideo.srcObject = null;
        this.el.callSection.classList.add('hidden');
        this.renderFriends();
    }

    saveData() {
        const data = { myKey: this.myKey, friends: Array.from(this.friends.keys()) };
        localStorage.setItem('peerskype_v5', JSON.stringify(data));
    }

    loadData() {
        const raw = localStorage.getItem('peerskype_v5');
        if (raw) {
            const data = JSON.parse(raw);
            this.myKey = data.myKey;
            if (this.myKey) {
                this.el.publicKey.value = this.myKey;
                this.el.noKey.classList.add('hidden');
                this.el.hasKey.classList.remove('hidden');
                this.generateQR();
            }
            data.friends.forEach(k => this.friends.set(k, { pc: null, dc: null, online: false }));
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