/**
 * BitChat Web Mesh Network
 * Реализует P2P mesh-сеть через WebRTC
 * Поддерживает multi-hop маршрутизацию и передачу файлов
 */

import { io } from 'socket.io-client';
import {
  generateKeyPair,
  generatePeerId,
  generateFingerprint,
  encryptMessage,
  decryptMessage,
  generateMessageId
} from './crypto.js';

// Конфигурация WebRTC
// STUN-серверы для определения внешнего IP (NAT traversal через интернет)
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' }
  ]
};

// Максимальный TTL для сообщений
const MAX_TTL = 7;

// Размер чанка для передачи файлов (16KB)
const FILE_CHUNK_SIZE = 16384;

// Загрузка пользовательского TURN-сервера из localStorage
function loadTurnConfig() {
  const stored = localStorage.getItem('bitchat_turn');
  if (stored) {
    try {
      const turn = JSON.parse(stored);
      if (turn.urls) {
        return turn;
      }
    } catch (e) {
      // Повреждённые данные — игнорируем
    }
  }
  return null;
}

// Собирает конфиг WebRTC с учётом пользовательского TURN
function getRtcConfig() {
  const config = { iceServers: [...RTC_CONFIG.iceServers] };
  const turn = loadTurnConfig();
  if (turn) {
    config.iceServers.push(turn);
  }
  return config;
}

// Автоматическое определение адреса signaling сервера
function getSignalingUrl() {
  // Сначала проверяем сохранённый адрес
  const saved = localStorage.getItem('bitchat_signaling_url');
  if (saved) {
    return saved;
  }
  const host = window.location.hostname;
  const port = 3001;
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${host}:${port}`;
}

export class BitChatMesh extends EventTarget {
  constructor(signalingUrl = null) {
    super();

    this.signalingUrl = signalingUrl || getSignalingUrl();
    this.socket = null;

    // Криптографические ключи — сохраняем в localStorage
    this.keyPair = this._loadOrCreateKeyPair();
    this.peerId = generatePeerId(this.keyPair.publicKey);
    this.fingerprint = generateFingerprint(this.keyPair.publicKey);

    // Никнейм пользователя — сохраняем в localStorage
    this.nickname = this._loadOrCreateNickname();

    // Подключенные пиры (peerId -> {connection, dataChannel, publicKey, nickname})
    this.peers = new Map();

    // Известные пиры (для маршрутизации)
    this.knownPeers = new Map();

    // Bloom filter для отслеживания обработанных сообщений
    this.seenMessages = new Set();

    // Очередь сообщений для повторной отправки
    this.messageQueue = new Map();

    // Передача файлов в процессе
    this.fileTransfers = new Map();

    // Очистка старых сообщений каждые 5 минут
    setInterval(() => this._cleanupSeenMessages(), 5 * 60 * 1000);
  }

  /**
   * Загружает или создаёт ключи (сохраняет в localStorage)
   */
  _loadOrCreateKeyPair() {
    const stored = localStorage.getItem('bitchat_keypair');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        // Повреждённые данные — создаём новые
      }
    }
    const keyPair = generateKeyPair();
    localStorage.setItem('bitchat_keypair', JSON.stringify(keyPair));
    return keyPair;
  }

  /**
   * Загружает или создаёт никнейм (сохраняет в localStorage)
   */
  _loadOrCreateNickname() {
    const stored = localStorage.getItem('bitchat_nickname');
    if (stored) {
      return stored;
    }
    const nickname = this._generateRandomNickname();
    localStorage.setItem('bitchat_nickname', nickname);
    return nickname;
  }

  /**
   * Генерирует случайный никнейм
   */
  _generateRandomNickname() {
    const adjectives = ['Swift', 'Silent', 'Crypto', 'Shadow', 'Mesh', 'Node', 'Peer', 'Net'];
    const nouns = ['Fox', 'Wolf', 'Hawk', 'Bear', 'Tiger', 'Eagle', 'Shark', 'Raven'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 100);
    return `${adj}${noun}${num}`;
  }

  /**
   * Подключение к сети
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(this.signalingUrl);

      this.socket.on('connect', () => {
        console.log('[BitChat] Подключен к signaling серверу');

        // Регистрируемся
        this.socket.emit('register', {
          peerId: this.peerId,
          publicKey: this.keyPair.publicKey,
          nickname: this.nickname
        });

        this._emit('connected', {
          peerId: this.peerId,
          nickname: this.nickname,
          fingerprint: this.fingerprint
        });

        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('[BitChat] Ошибка подключения:', error);
        reject(error);
      });

      // Получаем список существующих пиров
      this.socket.on('peer-list', (peers) => {
        console.log(`[BitChat] Получен список пиров: ${peers.length}`);
        peers.forEach(peer => {
          this.knownPeers.set(peer.peerId, peer);
          this._emit('peer-connected', peer); // Показываем в списке онлайн
          this._initiateConnection(peer.peerId);
        });
      });

      // Новый пир присоединился
      this.socket.on('peer-joined', (peer) => {
        console.log(`[BitChat] Новый пир: ${peer.nickname}`);
        this.knownPeers.set(peer.peerId, peer);
        this._emit('peer-joined', peer);
        this._emit('peer-connected', peer); // Показываем в списке онлайн
      });

      // Пир отключился
      this.socket.on('peer-left', (peer) => {
        console.log(`[BitChat] Пир ушёл: ${peer.nickname}`);
        this.peers.delete(peer.peerId);
        this.knownPeers.delete(peer.peerId);
        this._emit('peer-left', peer);
        this._emit('peers-updated'); // Обновляем список
      });

      // WebRTC сигнализация
      this.socket.on('webrtc-offer', async ({ offer, fromPeerId }) => {
        await this._handleOffer(offer, fromPeerId);
      });

      this.socket.on('webrtc-answer', async ({ answer, fromPeerId }) => {
        await this._handleAnswer(answer, fromPeerId);
      });

      this.socket.on('ice-candidate', async ({ candidate, fromPeerId }) => {
        await this._handleIceCandidate(candidate, fromPeerId);
      });

      // Fallback: получение сообщений через сервер
      this.socket.on('relay-message', (packet) => {
        console.log('[BitChat] Получено relay сообщение');
        this._handleRelayMessage(packet);
      });
    });
  }

  /**
   * Инициирует WebRTC соединение с пиром
   */
  async _initiateConnection(targetPeerId) {
    if (this.peers.has(targetPeerId)) return;

    const connection = new RTCPeerConnection(getRtcConfig());
    const peer = this.knownPeers.get(targetPeerId);

    // Мониторинг ICE-состояния
    this._monitorConnection(connection, targetPeerId);

    // Создаём data channel
    const dataChannel = connection.createDataChannel('bitchat', {
      ordered: true
    });

    this._setupDataChannel(dataChannel, targetPeerId, peer);

    // ICE кандидаты
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', {
          targetPeerId,
          candidate: event.candidate,
          fromPeerId: this.peerId
        });
      }
    };

    // Создаём offer
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);

    this.socket.emit('webrtc-offer', {
      targetPeerId,
      offer,
      fromPeerId: this.peerId
    });

    this.peers.set(targetPeerId, {
      connection,
      dataChannel,
      publicKey: peer?.publicKey,
      nickname: peer?.nickname,
      state: 'connecting'
    });
  }

  /**
   * Обрабатывает входящий offer
   */
  async _handleOffer(offer, fromPeerId) {
    const connection = new RTCPeerConnection(getRtcConfig());
    const peer = this.knownPeers.get(fromPeerId);

    // Мониторинг ICE-состояния
    this._monitorConnection(connection, fromPeerId);

    connection.ondatachannel = (event) => {
      this._setupDataChannel(event.channel, fromPeerId, peer);
      const existingPeer = this.peers.get(fromPeerId);
      if (existingPeer) {
        existingPeer.dataChannel = event.channel;
      }
    };

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', {
          targetPeerId: fromPeerId,
          candidate: event.candidate,
          fromPeerId: this.peerId
        });
      }
    };

    await connection.setRemoteDescription(offer);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);

    this.socket.emit('webrtc-answer', {
      targetPeerId: fromPeerId,
      answer,
      fromPeerId: this.peerId
    });

    this.peers.set(fromPeerId, {
      connection,
      dataChannel: null,
      publicKey: peer?.publicKey,
      nickname: peer?.nickname,
      state: 'connecting'
    });
  }

  /**
   * Обрабатывает входящий answer
   */
  async _handleAnswer(answer, fromPeerId) {
    const peer = this.peers.get(fromPeerId);
    if (peer) {
      await peer.connection.setRemoteDescription(answer);
    }
  }

  /**
   * Обрабатывает ICE кандидат
   */
  async _handleIceCandidate(candidate, fromPeerId) {
    const peer = this.peers.get(fromPeerId);
    if (peer) {
      await peer.connection.addIceCandidate(candidate);
    }
  }

  /**
   * Настраивает data channel
   */
  _setupDataChannel(channel, peerId, peerInfo) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log(`[BitChat] Data channel открыт с ${peerInfo?.nickname || peerId}`);
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.state = 'connected';
        peer.dataChannel = channel;
      }
      this._emit('peer-connected', {
        peerId,
        nickname: peerInfo?.nickname,
        publicKey: peerInfo?.publicKey
      });
    };

    channel.onclose = () => {
      console.log(`[BitChat] Data channel закрыт с ${peerInfo?.nickname || peerId}`);
    };

    channel.onmessage = (event) => {
      this._handleMessage(event.data, peerId);
    };
  }

  /**
   * Обрабатывает relay сообщение от сервера (fallback)
   */
  _handleRelayMessage(packet) {
    // Проверяем, не обрабатывали ли мы уже это сообщение
    if (this.seenMessages.has(packet.id)) {
      return;
    }
    // Не обрабатываем свои же сообщения
    if (packet.senderId === this.peerId) {
      return;
    }
    this.seenMessages.add(packet.id);

    switch (packet.type) {
      case 'message':
        this._emit('message', {
          id: packet.id,
          content: packet.content,
          sender: packet.senderNickname,
          senderId: packet.senderId,
          timestamp: packet.timestamp,
          isRelay: true
        });
        break;
      case 'file-meta':
        this._handleFileMeta(packet, packet.senderId);
        break;
      case 'file-chunk':
        this._handleFileChunk(packet, packet.senderId);
        break;
      case 'file-complete':
        this._handleFileComplete(packet, packet.senderId);
        break;
    }
  }

  /**
   * Обрабатывает входящее сообщение
   */
  _handleMessage(data, fromPeerId) {
    try {
      let packet;

      if (data instanceof ArrayBuffer) {
        // Бинарные данные (файл)
        this._handleFileChunk(data, fromPeerId);
        return;
      }

      packet = JSON.parse(data);

      // Проверяем, не обрабатывали ли мы уже это сообщение
      if (this.seenMessages.has(packet.id)) {
        return;
      }
      this.seenMessages.add(packet.id);

      switch (packet.type) {
        case 'message':
          this._handleChatMessage(packet, fromPeerId);
          break;
        case 'private-message':
          this._handlePrivateMessage(packet, fromPeerId);
          break;
        case 'file-meta':
          this._handleFileMeta(packet, fromPeerId);
          break;
        case 'file-chunk':
          this._handleFileChunk(packet, fromPeerId);
          break;
        case 'file-complete':
          this._handleFileComplete(packet, fromPeerId);
          break;
        case 'delivery-ack':
          this._handleDeliveryAck(packet);
          break;
        default:
          console.warn('[BitChat] Неизвестный тип пакета:', packet.type);
      }

      // Пересылаем сообщение другим пирам (mesh routing)
      if (packet.ttl > 0) {
        this._relayPacket(packet, fromPeerId);
      }
    } catch (error) {
      console.error('[BitChat] Ошибка обработки сообщения:', error);
    }
  }

  /**
   * Обрабатывает chat сообщение
   */
  _handleChatMessage(packet, fromPeerId) {
    const senderPeer = this.knownPeers.get(packet.senderId) || this.peers.get(packet.senderId);

    this._emit('message', {
      id: packet.id,
      content: packet.content,
      sender: packet.senderNickname,
      senderId: packet.senderId,
      timestamp: packet.timestamp,
      isRelay: packet.senderId !== fromPeerId
    });

    // Отправляем подтверждение доставки
    this._sendDeliveryAck(packet.id, packet.senderId);
  }

  /**
   * Обрабатывает приватное сообщение
   */
  _handlePrivateMessage(packet, fromPeerId) {
    // Проверяем, адресовано ли нам
    if (packet.recipientId !== this.peerId) {
      return; // Не нам - пересылка произойдёт в _handleMessage
    }

    const senderPeer = this.knownPeers.get(packet.senderId);
    if (!senderPeer) {
      console.warn('[BitChat] Неизвестный отправитель приватного сообщения');
      return;
    }

    // Расшифровываем
    const decrypted = decryptMessage(
      packet.encryptedContent,
      senderPeer.publicKey,
      this.keyPair.secretKey
    );

    if (decrypted) {
      this._emit('private-message', {
        id: packet.id,
        content: decrypted,
        sender: packet.senderNickname,
        senderId: packet.senderId,
        timestamp: packet.timestamp
      });

      this._sendDeliveryAck(packet.id, packet.senderId);
    }
  }

  /**
   * Отправляет сообщение всем (broadcast)
   */
  sendMessage(content) {
    const packet = {
      type: 'message',
      id: generateMessageId(),
      senderId: this.peerId,
      senderNickname: this.nickname,
      content,
      timestamp: Date.now(),
      ttl: MAX_TTL
    };

    this.seenMessages.add(packet.id);

    // Отправляем через WebRTC если есть соединения
    this._broadcastPacket(packet);

    // Всегда отправляем через сервер как fallback
    if (this.socket && this.socket.connected) {
      this.socket.emit('relay-message', packet);
    }

    // Добавляем в очередь для повторной отправки
    this.messageQueue.set(packet.id, {
      packet,
      attempts: 0,
      timestamp: Date.now()
    });

    return packet.id;
  }

  /**
   * Отправляет приватное сообщение конкретному пиру
   */
  sendPrivateMessage(targetPeerId, content) {
    const targetPeer = this.knownPeers.get(targetPeerId);
    if (!targetPeer) {
      console.error('[BitChat] Пир не найден:', targetPeerId);
      return null;
    }

    // Шифруем сообщение
    const encrypted = encryptMessage(
      content,
      targetPeer.publicKey,
      this.keyPair.secretKey
    );

    const packet = {
      type: 'private-message',
      id: generateMessageId(),
      senderId: this.peerId,
      senderNickname: this.nickname,
      recipientId: targetPeerId,
      encryptedContent: encrypted,
      timestamp: Date.now(),
      ttl: MAX_TTL
    };

    this.seenMessages.add(packet.id);
    this._broadcastPacket(packet);

    this.messageQueue.set(packet.id, {
      packet,
      attempts: 0,
      timestamp: Date.now()
    });

    return packet.id;
  }

  /**
   * Отправляет файл
   */
  async sendFile(file, targetPeerId = null) {
    const transferId = generateMessageId();
    const totalChunks = Math.ceil(file.size / FILE_CHUNK_SIZE);

    // Отправляем метаданные файла
    const metaPacket = {
      type: 'file-meta',
      id: generateMessageId(),
      transferId,
      senderId: this.peerId,
      senderNickname: this.nickname,
      recipientId: targetPeerId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      totalChunks,
      timestamp: Date.now(),
      ttl: MAX_TTL
    };

    this.seenMessages.add(metaPacket.id);
    this._broadcastPacket(metaPacket);
    // Relay через сервер
    if (this.socket && this.socket.connected) {
      this.socket.emit('relay-message', metaPacket);
    }

    // Отправляем чанки файла
    const reader = new FileReader();
    let offset = 0;
    let chunkIndex = 0;

    const readNextChunk = () => {
      const slice = file.slice(offset, offset + FILE_CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      const chunkData = e.target.result;

      const chunkPacket = {
        type: 'file-chunk',
        id: generateMessageId(),
        transferId,
        chunkIndex,
        data: this._arrayBufferToBase64(chunkData),
        timestamp: Date.now(),
        ttl: MAX_TTL
      };

      this.seenMessages.add(chunkPacket.id);
      this._broadcastPacket(chunkPacket);
      // Relay через сервер
      if (this.socket && this.socket.connected) {
        this.socket.emit('relay-message', chunkPacket);
      }

      this._emit('file-progress', {
        transferId,
        fileName: file.name,
        progress: (chunkIndex + 1) / totalChunks * 100,
        direction: 'upload'
      });

      offset += FILE_CHUNK_SIZE;
      chunkIndex++;

      if (offset < file.size) {
        // Небольшая задержка для предотвращения перегрузки
        setTimeout(readNextChunk, 10);
      } else {
        // Файл полностью отправлен
        const completePacket = {
          type: 'file-complete',
          id: generateMessageId(),
          transferId,
          senderId: this.peerId,
          senderNickname: this.nickname,
          timestamp: Date.now(),
          ttl: MAX_TTL
        };

        this.seenMessages.add(completePacket.id);
        this._broadcastPacket(completePacket);
        // Relay через сервер
        if (this.socket && this.socket.connected) {
          this.socket.emit('relay-message', completePacket);
        }

        this._emit('file-sent', {
          transferId,
          fileName: file.name,
          fileSize: file.size
        });
      }
    };

    readNextChunk();
    return transferId;
  }

  /**
   * Обрабатывает метаданные файла
   */
  _handleFileMeta(packet, fromPeerId) {
    // Если есть получатель и это не мы - игнорируем
    if (packet.recipientId && packet.recipientId !== this.peerId) {
      return;
    }

    this.fileTransfers.set(packet.transferId, {
      fileName: packet.fileName,
      fileSize: packet.fileSize,
      fileType: packet.fileType,
      totalChunks: packet.totalChunks,
      chunks: new Map(),
      senderId: packet.senderId,
      senderNickname: packet.senderNickname
    });

    this._emit('file-incoming', {
      transferId: packet.transferId,
      fileName: packet.fileName,
      fileSize: packet.fileSize,
      fileType: packet.fileType,
      sender: packet.senderNickname
    });
  }

  /**
   * Обрабатывает чанк файла
   */
  _handleFileChunk(packet, fromPeerId) {
    const transfer = this.fileTransfers.get(packet.transferId);
    if (!transfer) return;

    transfer.chunks.set(packet.chunkIndex, this._base64ToArrayBuffer(packet.data));

    const progress = transfer.chunks.size / transfer.totalChunks * 100;
    this._emit('file-progress', {
      transferId: packet.transferId,
      fileName: transfer.fileName,
      progress,
      direction: 'download'
    });
  }

  /**
   * Обрабатывает завершение передачи файла
   */
  _handleFileComplete(packet, fromPeerId) {
    const transfer = this.fileTransfers.get(packet.transferId);
    if (!transfer) return;

    // Собираем файл из чанков
    const chunks = [];
    for (let i = 0; i < transfer.totalChunks; i++) {
      const chunk = transfer.chunks.get(i);
      if (chunk) {
        chunks.push(chunk);
      }
    }

    const blob = new Blob(chunks, { type: transfer.fileType });
    const url = URL.createObjectURL(blob);

    this._emit('file-received', {
      transferId: packet.transferId,
      fileName: transfer.fileName,
      fileSize: transfer.fileSize,
      fileType: transfer.fileType,
      url,
      blob,
      sender: transfer.senderNickname
    });

    this.fileTransfers.delete(packet.transferId);
  }

  /**
   * Отправляет подтверждение доставки
   */
  _sendDeliveryAck(messageId, targetPeerId) {
    const packet = {
      type: 'delivery-ack',
      id: generateMessageId(),
      messageId,
      senderId: this.peerId,
      targetPeerId,
      timestamp: Date.now(),
      ttl: MAX_TTL
    };

    this._broadcastPacket(packet);
  }

  /**
   * Обрабатывает подтверждение доставки
   */
  _handleDeliveryAck(packet) {
    if (packet.targetPeerId !== this.peerId) return;

    this.messageQueue.delete(packet.messageId);
    this._emit('message-delivered', { messageId: packet.messageId });
  }

  /**
   * Рассылает пакет всем подключенным пирам
   */
  _broadcastPacket(packet) {
    const data = JSON.stringify(packet);

    for (const [peerId, peer] of this.peers) {
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        try {
          peer.dataChannel.send(data);
        } catch (error) {
          console.error(`[BitChat] Ошибка отправки к ${peerId}:`, error);
        }
      }
    }
  }

  /**
   * Пересылает пакет другим пирам (mesh routing)
   */
  _relayPacket(packet, excludePeerId) {
    const relayPacket = { ...packet, ttl: packet.ttl - 1 };
    const data = JSON.stringify(relayPacket);

    for (const [peerId, peer] of this.peers) {
      if (peerId === excludePeerId) continue;

      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        try {
          peer.dataChannel.send(data);
        } catch (error) {
          console.error(`[BitChat] Ошибка пересылки к ${peerId}:`, error);
        }
      }
    }
  }

  /**
   * Мониторинг состояния ICE-соединения
   */
  _monitorConnection(connection, peerId) {
    connection.oniceconnectionstatechange = () => {
      const state = connection.iceConnectionState;
      console.log(`[BitChat] ICE состояние с ${peerId.substring(0, 8)}: ${state}`);

      if (state === 'failed') {
        console.warn(`[BitChat] ICE соединение не удалось с ${peerId.substring(0, 8)}. Используется relay через сервер.`);
        this._emit('ice-failed', { peerId });
      }

      if (state === 'disconnected' || state === 'closed') {
        const peer = this.peers.get(peerId);
        if (peer) {
          peer.state = 'disconnected';
        }
      }
    };
  }

  /**
   * Устанавливает адрес signaling-сервера (для работы через интернет)
   */
  setSignalingUrl(url) {
    if (url) {
      localStorage.setItem('bitchat_signaling_url', url);
    } else {
      localStorage.removeItem('bitchat_signaling_url');
    }
  }

  /**
   * Устанавливает TURN-сервер (для NAT traversal через интернет)
   */
  setTurnServer(urls, username, credential) {
    if (urls) {
      const turn = { urls };
      if (username) turn.username = username;
      if (credential) turn.credential = credential;
      localStorage.setItem('bitchat_turn', JSON.stringify(turn));
    } else {
      localStorage.removeItem('bitchat_turn');
    }
  }

  /**
   * Возвращает текущие настройки сети
   */
  getNetworkConfig() {
    return {
      signalingUrl: this.signalingUrl,
      turnServer: loadTurnConfig(),
      rtcConfig: getRtcConfig()
    };
  }

  /**
   * Очищает старые ID сообщений
   */
  _cleanupSeenMessages() {
    // Храним только последние 10000 сообщений
    if (this.seenMessages.size > 10000) {
      const arr = Array.from(this.seenMessages);
      this.seenMessages = new Set(arr.slice(-5000));
    }
  }

  /**
   * Отключение от сети
   */
  disconnect() {
    for (const [_, peer] of this.peers) {
      if (peer.connection) {
        peer.connection.close();
      }
    }
    this.peers.clear();

    if (this.socket) {
      this.socket.disconnect();
    }

    this._emit('disconnected');
  }

  /**
   * Устанавливает никнейм
   */
  setNickname(nickname) {
    this.nickname = nickname;
    localStorage.setItem('bitchat_nickname', nickname);
  }

  /**
   * Получает список подключенных пиров (все известные пиры онлайн)
   */
  getConnectedPeers() {
    // Возвращаем всех известных пиров (подключенных к серверу)
    const peers = Array.from(this.knownPeers.values()).map(peer => ({
      peerId: peer.peerId,
      nickname: peer.nickname,
      publicKey: peer.publicKey
    }));
    console.log('[BitChat] getConnectedPeers: knownPeers.size =', this.knownPeers.size);
    return peers;
  }

  /**
   * Помощник: ArrayBuffer в Base64
   */
  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Помощник: Base64 в ArrayBuffer
   */
  _base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Генерирует событие
   */
  _emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}
