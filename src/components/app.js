/**
 * BitChat Web - Главный компонент приложения
 * Децентрализованный P2P чат с передачей файлов
 */

import { BitChatMesh } from '../lib/mesh.js';
import { storage } from '../lib/storage.js';

export class BitChatApp {
  constructor() {
    this.mesh = null;
    this.messages = [];
    this.peers = [];
    this.fileTransfers = new Map();
    this.currentChannel = 'mesh';

    this.init();
  }

  async init() {
    try {
      this.render();
      this.bindEvents();

      // Загружаем кэш с таймаутом (не блокируем если IndexedDB недоступен)
      const cacheTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Cache timeout')), 3000)
      );

      try {
        await Promise.race([this.loadCachedMessages(), cacheTimeout]);
      } catch (cacheError) {
        console.warn('[App] Кэш недоступен, продолжаем без истории:', cacheError.message);
      }

      await this.connectToMesh();
    } catch (error) {
      console.error('[App] Критическая ошибка инициализации:', error);
      this.showErrorState(error.message);
    }
  }

  showErrorState(message) {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100dvh; flex-direction: column; gap: 20px; background: #0a0a0f; padding: 20px;">
        <div style="font-size: 48px;">⚠️</div>
        <div style="color: #ff6b6b; font-size: 18px; font-family: monospace; text-align: center;">Ошибка загрузки</div>
        <div style="color: #888; font-family: monospace; text-align: center; max-width: 300px;">${message}</div>
        <button onclick="location.reload()" style="background: #00d4aa; color: #0a0a0f; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-family: monospace;">Перезагрузить</button>
      </div>
    `;
  }

  async loadCachedMessages() {
    try {
      const cachedMessages = await storage.getRecentMessages(50);
      if (cachedMessages.length > 0) {
        console.log(`[App] Загружено ${cachedMessages.length} сохранённых сообщений`);
        cachedMessages.forEach(msg => {
          this.addMessage(msg, false); // false = не сохранять повторно
        });
        this.addSystemMessage(`Загружено ${cachedMessages.length} сообщений из истории`);
      }
    } catch (error) {
      console.error('[App] Ошибка загрузки кэша:', error);
    }
  }

  async connectToMesh() {
    try {
      this.mesh = new BitChatMesh(); // Автоопределение сервера

      // Подписываемся на события
      this.mesh.addEventListener('connected', (e) => {
        this.updateConnectionStatus(true);
        this.updateUserProfile(e.detail);
        this.addSystemMessage(`Подключен к mesh-сети как ${e.detail.nickname}`);
      });

      this.mesh.addEventListener('disconnected', () => {
        this.updateConnectionStatus(false);
        this.addSystemMessage('Отключен от mesh-сети');
      });

      this.mesh.addEventListener('peer-joined', (e) => {
        this.addSystemMessage(`${e.detail.nickname} присоединился к сети`);
      });

      this.mesh.addEventListener('peer-left', (e) => {
        this.addSystemMessage(`${e.detail.nickname} покинул сеть`);
        this.updatePeerList();
      });

      this.mesh.addEventListener('peer-connected', (e) => {
        console.log('[App] peer-connected:', e.detail.nickname);
        this.updatePeerList();
      });

      this.mesh.addEventListener('peers-updated', () => {
        console.log('[App] peers-updated');
        this.updatePeerList();
      });

      this.mesh.addEventListener('message', (e) => {
        this.addMessage(e.detail);
      });

      this.mesh.addEventListener('private-message', (e) => {
        this.addMessage({ ...e.detail, isPrivate: true });
      });

      this.mesh.addEventListener('file-incoming', (e) => {
        this.addSystemMessage(`${e.detail.sender} отправляет файл: ${e.detail.fileName}`);
        this.fileTransfers.set(e.detail.transferId, {
          ...e.detail,
          progress: 0,
          direction: 'download'
        });
      });

      this.mesh.addEventListener('file-progress', (e) => {
        const transfer = this.fileTransfers.get(e.detail.transferId);
        if (transfer) {
          transfer.progress = e.detail.progress;
          this.updateFileProgress(e.detail.transferId, e.detail.progress);
        }
      });

      this.mesh.addEventListener('file-received', (e) => {
        this.addFileMessage(e.detail);
        this.fileTransfers.delete(e.detail.transferId);
      });

      this.mesh.addEventListener('file-sent', (e) => {
        this.addSystemMessage(`Файл ${e.detail.fileName} отправлен`);
        this.fileTransfers.delete(e.detail.transferId);
      });

      this.mesh.addEventListener('message-delivered', (e) => {
        this.markMessageDelivered(e.detail.messageId);
      });

      await this.mesh.connect();
    } catch (error) {
      console.error('Ошибка подключения:', error);
      this.addSystemMessage('Ошибка подключения к сети. Проверьте signaling сервер.');
    }
  }

  render() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <!-- Кнопка меню для мобильных -->
      <button class="sidebar-toggle" id="sidebarToggle" aria-label="Открыть меню">☰</button>

      <!-- Оверлей для закрытия сайдбара -->
      <div class="sidebar-overlay" id="sidebarOverlay"></div>

      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <div class="logo">
            <span class="logo-icon">🔗</span>
            <span>BitChat Web</span>
          </div>
          <div class="connection-status">
            <span class="status-dot" id="statusDot"></span>
            <span id="statusText">Подключение...</span>
          </div>
        </div>

        <div class="user-profile" id="userProfile">
          <div class="user-info">
            <div class="user-avatar" id="userAvatar">?</div>
            <div class="user-details">
              <div class="user-nickname" id="userNickname">Загрузка...</div>
              <div class="user-id" id="userId">-</div>
            </div>
          </div>
          <div class="fingerprint" id="userFingerprint">-</div>
        </div>

        <div class="peers-section">
          <div class="section-title">Пиры онлайн (<span id="peerCount">0</span>)</div>
          <ul class="peer-list" id="peerList"></ul>
        </div>
      </aside>

      <main class="main-area">
        <header class="chat-header">
          <div class="channel-info">
            <span class="channel-icon">📡</span>
            <div>
              <div class="channel-name">#mesh</div>
              <div class="channel-description">Локальная mesh-сеть • P2P • Шифрование</div>
            </div>
          </div>
        </header>

        <div class="messages-container" id="messagesContainer"></div>

        <div class="input-area">
          <form class="input-form" id="messageForm">
            <div class="input-wrapper">
              <textarea
                class="message-input"
                id="messageInput"
                placeholder="Введите сообщение... (Enter для отправки)"
                rows="1"
              ></textarea>
            </div>
            <div class="input-actions">
              <label class="action-btn" for="fileInput" title="Отправить файл">
                📎
              </label>
              <input type="file" id="fileInput" class="file-input" multiple>
              <button type="submit" class="send-btn" id="sendBtn" title="Отправить">
                ➤
              </button>
            </div>
          </form>
        </div>
      </main>
    `;
  }

  bindEvents() {
    const form = document.getElementById('messageForm');
    const input = document.getElementById('messageInput');
    const fileInput = document.getElementById('fileInput');

    // Мобильное меню
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    const toggleSidebar = () => {
      sidebar.classList.toggle('open');
      sidebarOverlay.classList.toggle('open');
    };

    const closeSidebar = () => {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('open');
    };

    sidebarToggle.addEventListener('click', toggleSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);

    // Закрываем сайдбар при клике на пира
    document.getElementById('peerList').addEventListener('click', () => {
      if (window.innerWidth < 768) {
        closeSidebar();
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendMessage();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Автоматическое изменение высоты textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    fileInput.addEventListener('change', (e) => {
      const files = e.target.files;
      for (const file of files) {
        this.sendFile(file);
      }
      fileInput.value = '';
    });

    // IRC-style команды
    input.addEventListener('input', () => {
      const value = input.value;
      if (value.startsWith('/')) {
        this.handleCommand(value);
      }
    });
  }

  sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();

    if (!content || !this.mesh) return;

    // Проверяем на команды
    if (content.startsWith('/')) {
      this.executeCommand(content);
      input.value = '';
      input.style.height = 'auto';
      return;
    }

    const messageId = this.mesh.sendMessage(content);

    // Добавляем своё сообщение локально
    this.addMessage({
      id: messageId,
      content,
      sender: this.mesh.nickname,
      senderId: this.mesh.peerId,
      timestamp: Date.now(),
      isOwn: true
    });

    input.value = '';
    input.style.height = 'auto';
  }

  async sendFile(file) {
    if (!this.mesh) return;

    const transferId = await this.mesh.sendFile(file);

    this.fileTransfers.set(transferId, {
      fileName: file.name,
      fileSize: file.size,
      progress: 0,
      direction: 'upload'
    });

    this.addSystemMessage(`Отправка файла: ${file.name} (${this.formatFileSize(file.size)})`);
  }

  executeCommand(command) {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'nick':
      case 'name':
        if (args[0]) {
          this.mesh.setNickname(args[0]);
          this.updateUserProfile({
            nickname: args[0],
            peerId: this.mesh.peerId,
            fingerprint: this.mesh.fingerprint
          });
          this.addSystemMessage(`Никнейм изменён на ${args[0]}`);
        }
        break;

      case 'who':
      case 'peers':
        const peers = this.mesh.getConnectedPeers();
        this.addSystemMessage(`Подключено пиров: ${peers.length}`);
        peers.forEach(p => {
          this.addSystemMessage(`  • ${p.nickname} (${p.peerId.substring(0, 8)}...)`);
        });
        break;

      case 'msg':
      case 'pm':
        if (args.length >= 2) {
          const targetNick = args[0];
          const message = args.slice(1).join(' ');
          const peer = this.peers.find(p =>
            p.nickname.toLowerCase() === targetNick.toLowerCase()
          );
          if (peer) {
            this.mesh.sendPrivateMessage(peer.peerId, message);
            this.addMessage({
              content: message,
              sender: this.mesh.nickname,
              isOwn: true,
              isPrivate: true,
              recipient: peer.nickname,
              timestamp: Date.now()
            });
          } else {
            this.addSystemMessage(`Пир ${targetNick} не найден`);
          }
        }
        break;

      case 'slap':
        if (args[0]) {
          this.mesh.sendMessage(`*шлёпает ${args[0]} большой форелью* 🐟`);
          this.addMessage({
            content: `*шлёпает ${args[0]} большой форелью* 🐟`,
            sender: this.mesh.nickname,
            isOwn: true,
            timestamp: Date.now()
          });
        }
        break;

      case 'me':
        if (args.length > 0) {
          const action = `* ${this.mesh.nickname} ${args.join(' ')}`;
          this.mesh.sendMessage(action);
          this.addMessage({
            content: action,
            sender: this.mesh.nickname,
            isOwn: true,
            isAction: true,
            timestamp: Date.now()
          });
        }
        break;

      case 'clear':
        document.getElementById('messagesContainer').innerHTML = '';
        this.messages = [];
        break;

      case 'fingerprint':
      case 'fp':
        this.addSystemMessage(`Твой fingerprint: ${this.mesh.fingerprint}`);
        break;

      case 'help':
        this.addSystemMessage('Доступные команды:');
        this.addSystemMessage('  /nick <имя> - сменить никнейм');
        this.addSystemMessage('  /who - список подключенных пиров');
        this.addSystemMessage('  /msg <ник> <сообщение> - приватное сообщение');
        this.addSystemMessage('  /slap <ник> - шлёпнуть форелью');
        this.addSystemMessage('  /me <действие> - действие от третьего лица');
        this.addSystemMessage('  /fingerprint - показать свой fingerprint');
        this.addSystemMessage('  /clear - очистить чат');
        break;

      default:
        this.addSystemMessage(`Неизвестная команда: /${cmd}. Введите /help для справки.`);
    }
  }

  handleCommand(value) {
    // Подсказки для команд (можно расширить)
  }

  addMessage(msg, saveToStorage = true) {
    this.messages.push(msg);

    // Сохраняем в IndexedDB для офлайн-доступа
    if (saveToStorage && msg.id) {
      storage.saveMessage(msg).catch(err => {
        console.warn('[App] Не удалось сохранить сообщение:', err);
      });
    }

    const container = document.getElementById('messagesContainer');

    const isOwn = msg.isOwn || msg.senderId === this.mesh?.peerId;
    const initial = msg.sender ? msg.sender.charAt(0).toUpperCase() : '?';

    const messageEl = document.createElement('div');
    messageEl.className = `message${isOwn ? ' own' : ''}`;
    messageEl.dataset.id = msg.id;

    messageEl.innerHTML = `
      <div class="message-avatar">${initial}</div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-sender">${msg.sender || 'Неизвестный'}</span>
          <span class="message-time">${this.formatTime(msg.timestamp)}</span>
          ${msg.isPrivate ? '<span class="message-private">🔒</span>' : ''}
        </div>
        <div class="message-text">${this.escapeHtml(msg.content)}</div>
        ${msg.isRelay ? '<div class="message-relay">↪ через mesh</div>' : ''}
      </div>
    `;

    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
  }

  addFileMessage(file) {
    const container = document.getElementById('messagesContainer');

    const messageEl = document.createElement('div');
    messageEl.className = 'message';

    const initial = file.sender ? file.sender.charAt(0).toUpperCase() : '?';

    messageEl.innerHTML = `
      <div class="message-avatar">${initial}</div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-sender">${file.sender || 'Неизвестный'}</span>
          <span class="message-time">${this.formatTime(Date.now())}</span>
        </div>
        <div class="file-message">
          <span class="file-icon">${this.getFileIcon(file.fileType)}</span>
          <div class="file-info">
            <div class="file-name">${this.escapeHtml(file.fileName)}</div>
            <div class="file-size">${this.formatFileSize(file.fileSize)}</div>
          </div>
          <button class="file-download" data-url="${file.url}" data-name="${file.fileName}">
            Скачать
          </button>
        </div>
      </div>
    `;

    const downloadBtn = messageEl.querySelector('.file-download');
    downloadBtn.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = file.url;
      a.download = file.fileName;
      a.click();
    });

    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
  }

  addSystemMessage(text) {
    const container = document.getElementById('messagesContainer');

    const messageEl = document.createElement('div');
    messageEl.className = 'system-message';
    messageEl.innerHTML = text.replace(
      /([A-Za-z]+\d*)/g,
      '<span class="highlight">$1</span>'
    );

    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
  }

  updateFileProgress(transferId, progress) {
    const progressEl = document.querySelector(`[data-transfer-id="${transferId}"] .file-progress-bar`);
    if (progressEl) {
      progressEl.style.width = `${progress}%`;
    }
  }

  markMessageDelivered(messageId) {
    const messageEl = document.querySelector(`[data-id="${messageId}"]`);
    if (messageEl) {
      const header = messageEl.querySelector('.message-header');
      if (!header.querySelector('.delivered')) {
        const check = document.createElement('span');
        check.className = 'delivered';
        check.textContent = ' ✓';
        check.style.color = 'var(--success)';
        header.appendChild(check);
      }
    }
  }

  updateConnectionStatus(connected) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');

    if (connected) {
      dot.classList.add('connected');
      text.textContent = 'Подключен к mesh';
    } else {
      dot.classList.remove('connected');
      text.textContent = 'Отключен';
    }
  }

  updateUserProfile({ nickname, peerId, fingerprint }) {
    document.getElementById('userNickname').textContent = nickname;
    document.getElementById('userId').textContent = peerId.substring(0, 12) + '...';
    document.getElementById('userAvatar').textContent = nickname.charAt(0).toUpperCase();
    document.getElementById('userFingerprint').textContent = fingerprint;
  }

  updatePeerList() {
    const peers = this.mesh?.getConnectedPeers() || [];
    console.log('[App] updatePeerList:', peers.length, 'пиров', peers);
    const peerList = document.getElementById('peerList');
    const peerCount = document.getElementById('peerCount');

    peerCount.textContent = peers.length;

    peerList.innerHTML = peers.map(peer => `
      <li class="peer-item" data-peer-id="${peer.peerId}">
        <div class="peer-avatar">${peer.nickname.charAt(0).toUpperCase()}</div>
        <span class="peer-name">${peer.nickname}</span>
        <span class="peer-status"></span>
      </li>
    `).join('');
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  getFileIcon(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar')) return '📦';
    if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('xml')) return '📝';
    return '📄';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
