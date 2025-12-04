/**
 * Signaling Server для BitChat Web
 * Используется только для первоначального обнаружения пиров
 * После установки WebRTC соединения - всё P2P напрямую
 */

import express from 'express';
import { createServer as createHttpsServer } from 'https';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Используем общие mkcert сертификаты из папки certs
const certPath = join(__dirname, '..', 'certs', 'cert.pem');
const keyPath = join(__dirname, '..', 'certs', 'key.pem');

const httpsOptions = {
  cert: readFileSync(certPath),
  key: readFileSync(keyPath)
};
console.log('[SSL] Используем mkcert сертификаты из /certs');

// Создаём HTTPS сервер
const server = createHttpsServer(httpsOptions, app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Храним информацию о подключенных пирах
const peers = new Map();
// Комнаты (каналы чата)
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`[+] Пир подключился: ${socket.id}`);

  // Регистрация пира с его публичным ключом
  socket.on('register', ({ peerId, publicKey, nickname }) => {
    peers.set(socket.id, {
      peerId,
      publicKey,
      nickname,
      socketId: socket.id,
      connectedAt: Date.now()
    });

    console.log(`[*] Зарегистрирован пир: ${nickname} (${peerId.substring(0, 8)}...)`);

    // Уведомляем всех о новом пире
    socket.broadcast.emit('peer-joined', {
      peerId,
      publicKey,
      nickname
    });

    // Отправляем новому пиру список существующих пиров
    const peerList = Array.from(peers.values())
      .filter(p => p.socketId !== socket.id)
      .map(p => ({
        peerId: p.peerId,
        publicKey: p.publicKey,
        nickname: p.nickname
      }));

    socket.emit('peer-list', peerList);
  });

  // Присоединение к комнате (каналу)
  socket.on('join-room', (roomId) => {
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);

    const peer = peers.get(socket.id);
    if (peer) {
      io.to(roomId).emit('room-peer-joined', {
        roomId,
        peerId: peer.peerId,
        nickname: peer.nickname
      });
    }

    console.log(`[*] ${peer?.nickname || socket.id} присоединился к комнате: ${roomId}`);
  });

  // WebRTC сигнализация - передача offer
  socket.on('webrtc-offer', ({ targetPeerId, offer, fromPeerId }) => {
    const targetSocket = Array.from(peers.entries())
      .find(([_, p]) => p.peerId === targetPeerId);

    if (targetSocket) {
      io.to(targetSocket[0]).emit('webrtc-offer', {
        offer,
        fromPeerId
      });
    }
  });

  // WebRTC сигнализация - передача answer
  socket.on('webrtc-answer', ({ targetPeerId, answer, fromPeerId }) => {
    const targetSocket = Array.from(peers.entries())
      .find(([_, p]) => p.peerId === targetPeerId);

    if (targetSocket) {
      io.to(targetSocket[0]).emit('webrtc-answer', {
        answer,
        fromPeerId
      });
    }
  });

  // WebRTC сигнализация - ICE кандидаты
  socket.on('ice-candidate', ({ targetPeerId, candidate, fromPeerId }) => {
    const targetSocket = Array.from(peers.entries())
      .find(([_, p]) => p.peerId === targetPeerId);

    if (targetSocket) {
      io.to(targetSocket[0]).emit('ice-candidate', {
        candidate,
        fromPeerId
      });
    }
  });

  // Fallback: передача сообщений через сервер (когда WebRTC не работает)
  socket.on('relay-message', (packet) => {
    console.log(`[>] Relay сообщение от ${packet.senderNickname}`);
    // Отправляем всем кроме отправителя
    socket.broadcast.emit('relay-message', packet);
  });

  // Отключение пира
  socket.on('disconnect', () => {
    const peer = peers.get(socket.id);

    if (peer) {
      console.log(`[-] Пир отключился: ${peer.nickname} (${peer.peerId.substring(0, 8)}...)`);

      // Уведомляем всех об отключении
      socket.broadcast.emit('peer-left', {
        peerId: peer.peerId,
        nickname: peer.nickname
      });

      // Удаляем из комнат
      for (const [roomId, members] of rooms.entries()) {
        if (members.has(socket.id)) {
          members.delete(socket.id);
          io.to(roomId).emit('room-peer-left', {
            roomId,
            peerId: peer.peerId,
            nickname: peer.nickname
          });
        }
      }
    }

    peers.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0'; // Слушаем на всех интерфейсах
server.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║     BitChat Web - Signaling Server (HTTPS)            ║
║═══════════════════════════════════════════════════════║
║  🔒 HTTPS сервер на порту: ${PORT}                       ║
║  Это только для обнаружения пиров.                    ║
║  Все сообщения идут напрямую P2P через WebRTC!        ║
╚═══════════════════════════════════════════════════════╝
  `);
});
