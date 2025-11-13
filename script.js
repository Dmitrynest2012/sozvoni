// script.js
class PeerSkype {
    constructor() {
        this.localStream = null;
        this.peerConnections = new Map();
        this.currentCall = null;
        this.myPublicKey = null;
        this.friends = new Set();

        this.initElements();
        this.initMedia();
        this.loadData();
        this.setupPasteHandler();
    }

    initElements() {
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
            pasteSignal: document.getElementById('paste-signal')
        };

        // События
        this.el.generateKey.onclick = () => this.generateKey();
        this.el.copyKey.onclick = () => this.copyMyKey();
        this.el.addFriend.onclick = () => this.addFriend();
        this.el.pasteSignal.onclick = () => this.pasteFromClipboard();
        this.el.endCall.onclick = () => this.hangUp();
    }

    async initMedia() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this.el.localVideo.srcObject = this.localStream;
        } catch (err) {
            this.toast('Ошибка камеры/микрофона: ' + err.message);
        }
    }

    generateKey() {
        this.myPublicKey = 'psk_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36).substr(2, 4);
        this.el.publicKey.value = this.myPublicKey;
        this.el.noKey.classList.add('hidden');
        this.el.hasKey.classList.remove('hidden');
        this.copyMyKey();
        this.saveData();
        this.toast('Ключ сгенерирован и скопирован!');
    }

    copyMyKey() {
        navigator.clipboard.writeText(this.myPublicKey).then(() => {
            this.toast('Ключ скопирован в буфер!');
        });
    }

    addFriend() {
        const key = this.el.friendKey.value.trim();
        if (!key || key === this.myPublicKey) {
            this.toast('Неверный ключ');
            return;
        }
        if (this.friends.has(key)) {
            this.toast('Друг уже добавлен');
            return;
        }

        this.friends.add(key);
        this.el.friendKey.value = '';
        this.renderFriends();
        this.saveData();
        this.toast('Друг добавлен!');
    }

    renderFriends() {
        this.el.friendsList.innerHTML = '';
        this.el.friendsCount.textContent = this.friends.size;

        if (this.friends.size === 0) {
            this.el.friendsSection.classList.add('hidden');
            return;
        }

        this.el.friendsSection.classList.remove('hidden');

        [...this.friends].forEach(key => {
            const li = document.createElement('li');
            li.className = 'friend-item';
            li.innerHTML = `
                <div class="friend-key">${key}</div>
                <button class="btn-success" onclick="app.callFriend('${key}')">
                    <i class="fas fa-phone"></i> Позвонить
                </button>
            `;
            this.el.friendsList.appendChild(li);
        });
    }

    async callFriend(friendKey) {
        if (this.peerConnections.has(friendKey)) {
            this.toast('Звонок уже идёт');
            return;
        }

        const pc = this.createPeerConnection(friendKey);
        this.peerConnections.set(friendKey, pc);
        this.currentCall = friendKey;

        this.el.callPartner.textContent = friendKey;
        this.el.callSection.classList.remove('hidden');

        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const payload = btoa(JSON.stringify({ type: 'offer', sdp: offer.sdp, from: this.myPublicKey }));
            const message = `CALL_OFFER:${payload}`;
            await navigator.clipboard.writeText(message);
            this.toast('OFFER скопирован! Отправьте другу.');
        } catch (err) {
            this.toast('Ошибка звонка');
            console.error(err);
        }
    }

    createPeerConnection(friendKey) {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));

        pc.ontrack = (e) => {
            this.el.remoteVideo.srcObject = e.streams[0];
        };

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                const payload = btoa(JSON.stringify({ type: 'candidate', candidate: e.candidate, from: this.myPublicKey }));
                navigator.clipboard.writeText(`SIGNAL:${payload}`);
                this.toast('ICE-кандидат скопирован');
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

    async pasteFromClipboard() {
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
            if (text.startsWith('CALL_OFFER:') || text.startsWith('SIGNAL:')) {
                e.preventDefault();
                this.handleSignal(text);
            }
        });
    }

    async handleSignal(text) {
        if (!text.startsWith('CALL_OFFER:') && !text.startsWith('SIGNAL:')) return;

        try {
            const payload = text.split(':')[1];
            const signal = JSON.parse(atob(payload));
            const friendKey = signal.from;

            if (!this.friends.has(friendKey)) {
                this.friends.add(friendKey);
                this.renderFriends();
                this.saveData();
                this.toast(`Автодобавлен: ${friendKey}`);
            }

            let pc = this.peerConnections.get(friendKey);
            if (!pc) {
                pc = this.createPeerConnection(friendKey);
                this.peerConnections.set(friendKey, pc);
                this.currentCall = friendKey;
                this.el.callPartner.textContent = friendKey;
                this.el.callSection.classList.remove('hidden');
            }

            if (signal.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(signal));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                const payload = btoa(JSON.stringify({ type: 'answer', sdp: answer.sdp, from: this.myPublicKey }));
                await navigator.clipboard.writeText(`SIGNAL:${payload}`);
                this.toast('ANSWER отправлен');
            } else if (signal.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(signal));
            } else if (signal.type === 'candidate') {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
        } catch (err) {
            console.error(err);
            this.toast('Неверный сигнал');
        }
    }

    hangUp() {
        if (this.currentCall) {
            const pc = this.peerConnections.get(this.currentCall);
            if (pc) pc.close();
            this.peerConnections.delete(this.currentCall);
            this.currentCall = null;
        }
        this.el.remoteVideo.srcObject = null;
        this.el.callSection.classList.add('hidden');
        this.toast('Звонок завершён');
    }

    saveData() {
        const data = {
            myPublicKey: this.myPublicKey,
            friends: [...this.friends]
        };
        localStorage.setItem('peerskype_v2', JSON.stringify(data));
    }

    loadData() {
        const raw = localStorage.getItem('peerskype_v2');
        if (!raw) return;

        try {
            const data = JSON.parse(raw);
            this.myPublicKey = data.myPublicKey;
            this.friends = new Set(data.friends || []);

            if (this.myPublicKey) {
                this.el.publicKey.value = this.myPublicKey;
                this.el.noKey.classList.add('hidden');
                this.el.hasKey.classList.remove('hidden');
            }
            this.renderFriends();
        } catch (err) {
            console.error('Ошибка загрузки данных');
        }
    }



    toast(message) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }
}

// Запуск
const app = new PeerSkype();
window.app = app; // для кнопок