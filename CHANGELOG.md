# Changelog

## [1.1.0] - 2024-12-04

### Added
- HTTPS support with mkcert certificates for local network access
- Unified certificate configuration for both Vite and Signaling servers
- IndexedDB timeout and graceful degradation in storage.js
- Error state display when app fails to initialize

### Fixed
- App stuck on "Загрузка..." loading screen
- "Connection not secure" error for LAN users
- Signaling server certificate rejection issue
- Optional chaining syntax error in index.html
- IndexedDB initialization blocking app startup

### Changed
- Moved from @vitejs/plugin-basic-ssl to custom mkcert certificates
- Signaling server now uses shared certificates from /certs folder
- Removed selfsigned package dependency from signaling server

### Technical Details
- Certificates location: `/certs/cert.pem` and `/certs/key.pem`
- Vite server: https://192.168.2.1:5173
- Signaling server: https://192.168.2.1:3001

## [1.0.0] - 2024-12-03

### Initial Release
- P2P mesh chat with WebRTC
- End-to-end encryption
- File transfer support
- PWA with offline support
- Service Worker for caching
- IndexedDB for message persistence
