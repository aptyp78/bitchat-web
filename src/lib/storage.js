/**
 * BitChat Web - Локальное хранилище
 * IndexedDB для кэширования сообщений и файлов
 */

const DB_NAME = 'bitchat-db';
const DB_VERSION = 1;

class BitChatStorage {
  constructor() {
    this.db = null;
    this.isReady = false;
    this.readyPromise = this.init();
  }

  async init() {
    // Проверяем доступность IndexedDB
    if (typeof indexedDB === 'undefined') {
      console.warn('[Storage] IndexedDB недоступен в этом браузере');
      this.isReady = false;
      return;
    }

    return new Promise((resolve) => {
      // Таймаут на открытие базы (5 секунд)
      const timeout = setTimeout(() => {
        console.warn('[Storage] Таймаут открытия IndexedDB');
        this.isReady = false;
        resolve();
      }, 5000);

      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        clearTimeout(timeout);
        console.error('[Storage] Исключение при открытии IndexedDB:', error);
        this.isReady = false;
        resolve();
        return;
      }

      request.onerror = () => {
        clearTimeout(timeout);
        console.error('[Storage] Ошибка открытия IndexedDB:', request.error);
        this.isReady = false;
        resolve();
      };

      request.onsuccess = () => {
        clearTimeout(timeout);
        this.db = request.result;
        this.isReady = true;
        console.log('[Storage] IndexedDB готов');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Хранилище сообщений
        if (!db.objectStoreNames.contains('messages')) {
          const messagesStore = db.createObjectStore('messages', { keyPath: 'id' });
          messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
          messagesStore.createIndex('channel', 'channel', { unique: false });
          messagesStore.createIndex('senderId', 'senderId', { unique: false });
        }

        // Хранилище отложенных сообщений
        if (!db.objectStoreNames.contains('pending')) {
          const pendingStore = db.createObjectStore('pending', { keyPath: 'id' });
          pendingStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Хранилище файлов
        if (!db.objectStoreNames.contains('files')) {
          const filesStore = db.createObjectStore('files', { keyPath: 'id' });
          filesStore.createIndex('messageId', 'messageId', { unique: false });
        }

        // Хранилище контактов/пиров
        if (!db.objectStoreNames.contains('peers')) {
          const peersStore = db.createObjectStore('peers', { keyPath: 'peerId' });
          peersStore.createIndex('nickname', 'nickname', { unique: false });
          peersStore.createIndex('lastSeen', 'lastSeen', { unique: false });
        }

        console.log('[Storage] Схема базы данных создана');
      };
    });
  }

  async waitReady() {
    await this.readyPromise;
    return this.isReady;
  }

  // === СООБЩЕНИЯ ===

  async saveMessage(message) {
    const ready = await this.waitReady();
    if (!ready) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages'], 'readwrite');
      const store = transaction.objectStore('messages');

      const messageData = {
        ...message,
        timestamp: message.timestamp || Date.now(),
        channel: message.channel || 'mesh'
      };

      const request = store.put(messageData);

      request.onsuccess = () => resolve(messageData);
      request.onerror = () => reject(request.error);
    });
  }

  async getMessages(channel = 'mesh', limit = 100) {
    const ready = await this.waitReady();
    if (!ready) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages'], 'readonly');
      const store = transaction.objectStore('messages');
      const index = store.index('channel');
      const request = index.getAll(IDBKeyRange.only(channel));

      request.onsuccess = () => {
        let messages = request.result || [];
        // Сортируем по времени и берём последние
        messages.sort((a, b) => a.timestamp - b.timestamp);
        if (messages.length > limit) {
          messages = messages.slice(-limit);
        }
        resolve(messages);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getRecentMessages(limit = 50) {
    const ready = await this.waitReady();
    if (!ready) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages'], 'readonly');
      const store = transaction.objectStore('messages');
      const index = store.index('timestamp');
      const messages = [];

      const request = index.openCursor(null, 'prev');

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && messages.length < limit) {
          messages.push(cursor.value);
          cursor.continue();
        } else {
          resolve(messages.reverse());
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async clearOldMessages(maxAge = 7 * 24 * 60 * 60 * 1000) {
    const ready = await this.waitReady();
    if (!ready) return 0;

    const cutoff = Date.now() - maxAge;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages'], 'readwrite');
      const store = transaction.objectStore('messages');
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(cutoff);
      let deleted = 0;

      const request = index.openCursor(range);

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          console.log(`[Storage] Удалено ${deleted} старых сообщений`);
          resolve(deleted);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // === ОТЛОЖЕННЫЕ СООБЩЕНИЯ ===

  async savePendingMessage(message) {
    const ready = await this.waitReady();
    if (!ready) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pending'], 'readwrite');
      const store = transaction.objectStore('pending');

      const pendingData = {
        ...message,
        id: message.id || `pending_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        createdAt: Date.now(),
        status: 'pending'
      };

      const request = store.put(pendingData);

      request.onsuccess = () => resolve(pendingData);
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingMessages() {
    const ready = await this.waitReady();
    if (!ready) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pending'], 'readonly');
      const store = transaction.objectStore('pending');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async removePendingMessage(id) {
    const ready = await this.waitReady();
    if (!ready) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pending'], 'readwrite');
      const store = transaction.objectStore('pending');
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // === ФАЙЛЫ ===

  async saveFile(fileData) {
    const ready = await this.waitReady();
    if (!ready) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.put(fileData);

      request.onsuccess = () => resolve(fileData);
      request.onerror = () => reject(request.error);
    });
  }

  async getFile(id) {
    const ready = await this.waitReady();
    if (!ready) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // === ПИРЫ ===

  async savePeer(peer) {
    const ready = await this.waitReady();
    if (!ready) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['peers'], 'readwrite');
      const store = transaction.objectStore('peers');

      const peerData = {
        ...peer,
        lastSeen: Date.now()
      };

      const request = store.put(peerData);

      request.onsuccess = () => resolve(peerData);
      request.onerror = () => reject(request.error);
    });
  }

  async getKnownPeers() {
    const ready = await this.waitReady();
    if (!ready) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['peers'], 'readonly');
      const store = transaction.objectStore('peers');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // === УТИЛИТЫ ===

  async clearAll() {
    const ready = await this.waitReady();
    if (!ready) return;

    const stores = ['messages', 'pending', 'files', 'peers'];

    return Promise.all(stores.map(storeName => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }));
  }

  async getStorageStats() {
    const ready = await this.waitReady();
    if (!ready) return { messages: 0, pending: 0, files: 0, peers: 0 };

    const stats = {};
    const stores = ['messages', 'pending', 'files', 'peers'];

    for (const storeName of stores) {
      stats[storeName] = await new Promise((resolve) => {
        const transaction = this.db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
      });
    }

    return stats;
  }
}

// Экспортируем синглтон
export const storage = new BitChatStorage();
