/**
 * Криптографический модуль BitChat Web
 * Реализует шифрование на основе Noise Protocol концепций
 * Использует TweetNaCl для криптографических операций
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';

/**
 * Генерирует пару ключей для идентификации пира
 */
export function generateKeyPair() {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey)
  };
}

/**
 * Генерирует ключи для подписи (Ed25519)
 */
export function generateSigningKeyPair() {
  const keyPair = nacl.sign.keyPair();
  return {
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey)
  };
}

/**
 * Генерирует уникальный ID пира на основе публичного ключа
 */
export function generatePeerId(publicKey) {
  const hash = nacl.hash(decodeBase64(publicKey));
  return encodeBase64(hash).substring(0, 16);
}

/**
 * Генерирует fingerprint для верификации
 */
export function generateFingerprint(publicKey) {
  const hash = nacl.hash(decodeBase64(publicKey));
  // Форматируем как читаемый fingerprint
  const hex = Array.from(hash.slice(0, 16))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.match(/.{1,4}/g).join(':').toUpperCase();
}

/**
 * Шифрует сообщение для конкретного получателя
 */
export function encryptMessage(message, recipientPublicKey, senderSecretKey) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageUint8 = decodeUTF8(message);

  const encrypted = nacl.box(
    messageUint8,
    nonce,
    decodeBase64(recipientPublicKey),
    decodeBase64(senderSecretKey)
  );

  // Объединяем nonce и зашифрованное сообщение
  const fullMessage = new Uint8Array(nonce.length + encrypted.length);
  fullMessage.set(nonce);
  fullMessage.set(encrypted, nonce.length);

  return encodeBase64(fullMessage);
}

/**
 * Расшифровывает сообщение от отправителя
 */
export function decryptMessage(encryptedMessage, senderPublicKey, recipientSecretKey) {
  try {
    const messageWithNonce = decodeBase64(encryptedMessage);
    const nonce = messageWithNonce.slice(0, nacl.box.nonceLength);
    const message = messageWithNonce.slice(nacl.box.nonceLength);

    const decrypted = nacl.box.open(
      message,
      nonce,
      decodeBase64(senderPublicKey),
      decodeBase64(recipientSecretKey)
    );

    if (!decrypted) {
      throw new Error('Не удалось расшифровать сообщение');
    }

    return encodeUTF8(decrypted);
  } catch (error) {
    console.error('Ошибка расшифровки:', error);
    return null;
  }
}

/**
 * Шифрует данные для широковещательной рассылки (симметричное шифрование)
 */
export function encryptBroadcast(data, sharedKey) {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const dataUint8 = typeof data === 'string' ? decodeUTF8(data) : data;

  const encrypted = nacl.secretbox(dataUint8, nonce, decodeBase64(sharedKey));

  const fullMessage = new Uint8Array(nonce.length + encrypted.length);
  fullMessage.set(nonce);
  fullMessage.set(encrypted, nonce.length);

  return encodeBase64(fullMessage);
}

/**
 * Расшифровывает широковещательные данные
 */
export function decryptBroadcast(encryptedData, sharedKey) {
  try {
    const messageWithNonce = decodeBase64(encryptedData);
    const nonce = messageWithNonce.slice(0, nacl.secretbox.nonceLength);
    const message = messageWithNonce.slice(nacl.secretbox.nonceLength);

    const decrypted = nacl.secretbox.open(message, nonce, decodeBase64(sharedKey));

    if (!decrypted) {
      throw new Error('Не удалось расшифровать данные');
    }

    return decrypted;
  } catch (error) {
    console.error('Ошибка расшифровки broadcast:', error);
    return null;
  }
}

/**
 * Генерирует общий ключ для комнаты/канала
 */
export function generateRoomKey() {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  return encodeBase64(key);
}

/**
 * Подписывает данные
 */
export function signData(data, secretKey) {
  const dataUint8 = typeof data === 'string' ? decodeUTF8(data) : data;
  const signed = nacl.sign(dataUint8, decodeBase64(secretKey));
  return encodeBase64(signed);
}

/**
 * Проверяет подпись
 */
export function verifySignature(signedData, publicKey) {
  try {
    const opened = nacl.sign.open(decodeBase64(signedData), decodeBase64(publicKey));
    if (!opened) return null;
    return encodeUTF8(opened);
  } catch {
    return null;
  }
}

/**
 * Генерирует случайный ID для сообщения
 */
export function generateMessageId() {
  const bytes = nacl.randomBytes(16);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
