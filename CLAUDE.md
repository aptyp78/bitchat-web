# CLAUDE.md — AI Assistant Guide for BitChat Web

## Project Overview

BitChat Web is a decentralized peer-to-peer chat application with file transfer, built for local network deployment. It uses WebRTC for direct P2P communication, a Socket.IO signaling server for peer discovery, and TweetNaCl for end-to-end encryption. The UI and comments are in Russian.

## Tech Stack

- **Frontend:** Vanilla JavaScript (ES modules, no framework), Vite 5
- **Backend:** Express + Socket.IO signaling server (Node.js)
- **Networking:** WebRTC Data Channels with mesh routing
- **Encryption:** TweetNaCl (Curve25519 key exchange, XSalsa20-Poly1305)
- **Storage:** IndexedDB (messages, peers, files), localStorage (keypair, nickname)
- **Styling:** Pure CSS with CSS variables (dark theme, mobile-first responsive)
- **PWA:** Service Worker for offline caching

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start signaling server + Vite dev server concurrently
npm run client       # Vite dev server only (https://localhost:5173)
npm run server       # Signaling server only (https://localhost:3001)
npm run build        # Production build (output: dist/)
npm run preview      # Preview production build
```

No test runner, linter, or formatter is configured.

## Architecture

```
Browser ←→ Signaling Server (Express :3001, Socket.IO) ←→ Browser
   ↕                                                        ↕
   └──────── WebRTC Data Channel (direct P2P) ──────────────┘
```

1. Client connects to signaling server at port 3001 via Socket.IO
2. Signaling server broadcasts peer list and relays WebRTC offer/answer/ICE
3. Once WebRTC data channels are established, messaging is fully P2P
4. Signaling server acts as relay fallback when direct P2P fails

## Project Structure

```
bitchat-web/
├── index.html                 # Entry point (PWA setup, service worker registration)
├── vite.config.js             # Vite config (HTTPS via mkcert, port 5173)
├── package.json               # Dependencies and scripts
├── certs/                     # mkcert TLS certificates
│   ├── cert.pem
│   └── key.pem
├── server/
│   └── signaling.js           # WebRTC signaling server (Express + Socket.IO, port 3001)
├── src/
│   ├── components/
│   │   └── app.js             # Main UI class (BitChatApp) — rendering, events, IRC commands
│   ├── lib/
│   │   ├── crypto.js          # Key generation, encrypt/decrypt, signatures (TweetNaCl)
│   │   ├── mesh.js            # P2P mesh network (BitChatMesh) — WebRTC, routing, file transfer
│   │   └── storage.js         # IndexedDB persistence (BitChatStorage) — messages, peers, files
│   └── styles/
│       └── main.css           # All styles (dark theme, responsive breakpoints, animations)
└── public/
    ├── manifest.json          # PWA manifest
    ├── sw.js                  # Service Worker (cache-first for assets, network-first for HTML)
    └── icons/
        └── icon.svg           # App icon
```

## Key Source Files

### `src/components/app.js` — BitChatApp class
- Manages entire UI lifecycle: rendering, event binding, message display
- IRC-style commands: `/nick`, `/who`, `/msg`, `/slap`, `/me`, `/fingerprint`, `/clear`, `/help`
- Listens to mesh events (connected, disconnected, peer-joined, message, file-*)
- Persists messages to IndexedDB, loads history on startup

### `src/lib/mesh.js` — BitChatMesh class (extends EventTarget)
- WebRTC peer connection management with automatic discovery
- Mesh routing with TTL (max 7 hops) and message deduplication
- File chunking (16KB) and transfer with progress tracking
- Encryption for private messages, relay fallback via signaling server
- Auto-detects signaling server URL from `window.location`

### `src/lib/crypto.js` — Cryptography module
- `generateKeyPair()` — Curve25519 keys
- `generatePeerId()` — SHA-256 hash of public key
- `encryptMessage()` / `decryptMessage()` — NaCl box (asymmetric)
- `signData()` / `verifySignature()` — Ed25519 signatures

### `src/lib/storage.js` — BitChatStorage singleton
- IndexedDB `bitchat-db` with stores: messages, pending, files, peers
- 5-second timeout for graceful degradation
- Auto-cleanup of messages older than 7 days

### `server/signaling.js` — Signaling server
- Express + HTTPS + Socket.IO on port 3001
- In-memory peer/room tracking (no database)
- Relays WebRTC signaling and acts as message fallback

## Code Conventions

- **Language:** All UI text and code comments are in Russian
- **Naming:** camelCase for JS variables/functions, kebab-case for CSS classes
- **Classes:** Constructor-based ES6 classes (BitChatApp, BitChatMesh, BitChatStorage)
- **Events:** Custom events via EventTarget with `detail` payload
- **Modules:** ES module imports/exports
- **Comment tags:** `[BitChat]`, `[App]`, `[Storage]`, `[SW]`, `[PWA]` prefixes
- **No TypeScript, no linting, no testing frameworks**

## Configuration

All configuration is hardcoded (no environment variables):
- Vite dev server: port 5173, host 0.0.0.0, HTTPS with mkcert
- Signaling server: port 3001, CORS enabled for all origins
- WebRTC: No ICE servers configured (local network only)
- Mesh: MAX_TTL 7, FILE_CHUNK_SIZE 16KB, message cleanup every 5 minutes

## State Management

- **Distributed:** Each peer maintains its own state independently
- **Transient:** In-memory maps (peers, active transfers)
- **Persistent:** localStorage (keypair, nickname), IndexedDB (messages, peers, pending, files)
- **No centralized state store** — state is managed within class instances

## Security Model

- Asymmetric encryption (NaCl box) for private messages
- Ed25519 signatures for message authentication
- Public key exchange during peer discovery via signaling
- Fingerprint verification is manual (user responsibility)
- No authentication/authorization layer on the signaling server
