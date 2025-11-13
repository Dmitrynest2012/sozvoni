// script.js
class PeerSkype {
    constructor() {
        this.localStream = null;
        this.peerConnection = null;
        this.currentCall = null;
        this.friends = {}; // { publicKey: { key, name, pc } }
        this.myPublicKey = null;

        this.initElements();
        this.initWebRTC();
        this.loadFromStorage();
    }

    initElements() {
        this.el = {
            generateKey: document.getElementById('generate-key'),
            keyDisplay: document.getElementById('key-display'),
            publicKey: document.getElementById('public-key'),
            copyKey: document.getElementById('copy-key'),
            friendKey: document.getElementById('friend-key'),
            addFriend: document.getElementById('add-friend'),
            authSection: document.getElementById('auth-section'),
            friendsSection: document.getElementById('friends-section'),
            friendsList: document.getElementById('friends-list'),
            callSection: document.getElementById('call-section'),
            callPartner: document.getElementById('call-partner'),
            endCall: document.getElementById('end-call'),
            localVideo: document.getElementById('local-video'),
            remoteVideo: document.getElementById('remote-video')
        };

        this.el.generateKey.addEventListener('click', () => this.generateKeyPair());
        this.el.copyKey.addEventListener('click', () => this.copyToClipboard(this.el.publicKey.value));
        this.el.addFriend.addEventListener('click', () => this.addFriendByKey());
        this.el.endCall.addEventListener('click', () => this.endCall());
    }

    async initWebRTC() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this.el.localVideo.srcObject = this.localStream;
        } catch (err) {
            alert('Не удалось получить доступ к камере/микрофону: ' + err.message);
        }
    }

    generateKeyPair() {
        // Генерируем простой идентификатор (в реальности — ECDH + подпись)
        this.myPublicKey = 'user_' + Math.random().toString(36).substr(2, 16) + '_' + Date.now();
        this.el.publicKey.value = this.myPublicKey;
        this.el.keyDisplay.classList.remove('hidden');
        this.saveToStorage();
        this.showFriendsSection();
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            alert('Ключ скопирован в буфер обмена!');
        });
    }

    addFriendByKey() {
        const key = this.el.friendKey.value.trim();
        if (!key || key === this.myPublicKey) {
            alert('Неверный или ваш собственный ключ');
            return;
        }

        if (this.friends[key]) {
            alert('Друг уже добавлен');
            return;
        }

        const friend = {
            publicKey: key,
            pc: this.createPeerConnection(key)
        };

        this.friends[key] = friend;
        this.renderFriends();
        this.el.friendKey.value = '';
        this.saveToStorage();
        alert('Друг добавлен! Теперь можно звонить.');
    }

    createPeerConnection(friendKey) {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        // Добавляем локальные потоки
        this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                // В реальной P2P-сети отправляем через сигнальный канал
                this.sendSignal(friendKey, {
                    type: 'candidate',
                    candidate: event.candidate
                });
            }
        };

        pc.ontrack = (event) => {
            this.el.remoteVideo.srcObject = event.streams[0];
        };

        pc.onconnectionstatechange = () => {
            console.log('Состояние подключения:', pc.connectionState);
            if (pc.connectionState === 'failed') {
                alert('Соединение не удалось. Попробуйте позже.');
                this.endCall();
            }
        };

        return pc;
    }

    async startCall(friendKey) {
        const friend = this.friends[friendKey];
        if (!friend) return;

        this.currentCall = friendKey;
        this.el.callPartner.textContent = friendKey.slice(0, 20) + '...';
        this.el.callSection.classList.remove('hidden');

        try {
            const offer = await friend.pc.createOffer();
            await friend.pc.setLocalDescription(offer);

            // Отправляем offer через сигнальный канал (в демо — копируем в буфер)
            this.sendSignal(friendKey, {
                type: 'offer',
                sdp: offer.sdp
            });

            alert(`Скопируйте это сообщение и отправьте другу:\n\nCALL_OFFER:${btoa(JSON.stringify(offer))}`);
        } catch (err) {
            console.error(err);
            alert('Ошибка создания звонка');
        }
    }

    async handleIncomingSignal(signal) {
        if (!signal || typeof signal !== 'object') return;

        const friendKey = signal.from;
        let friend = this.friends[friendKey];

        if (!friend && signal.type === 'offer') {
            // Автоматическое добавление при входящем звонке
            friend = { publicKey: friendKey, pc: this.createPeerConnection(friendKey) };
            this.friends[friendKey] = friend;
            this.renderFriends();
        }

        if (!friend) return;

        try {
            if (signal.type === 'offer') {
                await friend.pc.setRemoteDescription(new RTCSessionDescription(signal));
                const answer = await friend.pc.createAnswer();
                await friend.pc.setLocalDescription(answer);

                this.sendSignal(friendKey, {
                    type: 'answer',
                    sdp: answer.sdp
                });

                this.currentCall = friendKey;
                this.el.callPartner.textContent = friendKey.slice(0, 20) + '...';
                this.el.callSection.classList.remove('hidden');
            }

            if (signal.type === 'answer') {
                await friend.pc.setRemoteDescription(new RTCSessionDescription(signal));
            }

            if (signal.type === 'candidate') {
                await friend.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
        } catch (err) {
            console.error('Ошибка обработки сигнала:', err);
        }
    }

    sendSignal(friendKey, data) {
        // В РЕАЛЬНОМ P2P: отправка через WebRTC DataChannel, WebTorrent, IPFS и т.д.
        // Здесь — демо: выводим в консоль и буфер
        data.from = this.myPublicKey;
        const payload = btoa(JSON.stringify(data));
        console.log(`Сигнал для ${friendKey}:`, payload);
        alert(`Отправьте другу это сообщение:\n\nSIGNAL:${payload}`);
    }

    endCall() {
        if (this.currentCall && this.friends[this.currentCall]) {
            this.friends[this.currentCall].pc.close();
            this.friends[this.currentCall].pc = this.createPeerConnection(this.currentCall);
        }

        this.currentCall = null;
        this.el.remoteVideo.srcObject = null;
        this.el.callSection.classList.add('hidden');
    }

    renderFriends() {
        this.el.friendsList.innerHTML = '';
        Object.keys(this.friends).forEach(key => {
            const li = document.createElement('li');
            li.className = 'friend-item';
            li.innerHTML = `
                <div>
                    <div class="friend-key">${key}</div>
                </div>
                <button class="btn-call" onclick="app.startCall('${key}')">Позвонить</button>
            `;
            this.el.friendsList.appendChild(li);
        });
    }

    showFriendsSection() {
        this.el.authSection.classList.add('hidden');
        this.el.friendsSection.classList.remove('hidden');
    }

    saveToStorage() {
        const data = {
            myPublicKey: this.myPublicKey,
            friends: Object.keys(this.friends)
        };
        localStorage.setItem('peerskype_data', JSON.stringify(data));
    }

    loadFromStorage() {
        const data = localStorage.getItem('peerskype_data');
        if (data) {
            const parsed = JSON.parse(data);
            this.myPublicKey = parsed.myPublicKey;
            if (this.myPublicKey) {
                this.el.publicKey.value = this.myPublicKey;
                this.el.keyDisplay.classList.remove('hidden');
                this.showFriendsSection();
            }
            // Восстановление друзей (без PC — пересоздаём при звонке)
            parsed.friends.forEach(key => {
                this.friends[key] = { publicKey: key, pc: null };
            });
            this.renderFriends();
        }
    }
}

// Глобальная обработка входящих сигналов (вставка из буфера)
window.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (text.startsWith('SIGNAL:') || text.startsWith('CALL_OFFER:')) {
        e.preventDefault();
        try {
            const payload = text.split(':')[1];
            const signal = JSON.parse(atob(payload));
            if (text.startsWith('CALL_OFFER:')) {
                signal.type = 'offer';
            }
            app.handleIncomingSignal(signal);
        } catch (err) {
            console.error('Неверный сигнал', err);
        }
    }
});

// Запуск
const app = new PeerSkype();

// Подсказка
setTimeout(() => {
    if (!localStorage.getItem('peerskype_data')) {
        alert(`
        ИНСТРУКЦИЯ:
        1. Нажмите "Сгенерировать ключ"
        2. Скопируйте ключ и отправьте другу
        3. Вставьте ключ друга и добавьте
        4. Нажмите "Позвонить"
        5. Скопируйте CALL_OFFER и отправьте другу
        6. Друг вставит ваш ответ (вставка из буфера — Ctrl+V)
        `.trim());
    }
}, 1000);