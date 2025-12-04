import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 5173,
    host: '0.0.0.0', // Доступ по сети
    https: {
      key: readFileSync(resolve(__dirname, 'certs/key.pem')),
      cert: readFileSync(resolve(__dirname, 'certs/cert.pem'))
    },
    open: false      // Не открывать браузер автоматически
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
