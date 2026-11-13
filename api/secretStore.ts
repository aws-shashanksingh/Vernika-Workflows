import crypto from 'crypto';

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function encryptionKey(): Buffer {
  const keyStr = (process.env.CREDENTIAL_ENCRYPTION_KEY || '').trim().replace(/^['"]|['"]$/g, '');
  if (!keyStr) {
    throw new Error('MISSING_ENCRYPTION_KEY: CREDENTIAL_ENCRYPTION_KEY environment variable is not set.');
  }
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(keyStr)) {
    key = Buffer.from(keyStr, 'hex');
  } else {
    const cleanB64 = keyStr.replace(/-/g, '+').replace(/_/g, '/');
    key = Buffer.from(cleanB64, 'base64');
  }
  if (key.length !== 32) {
    throw new Error(`INVALID_ENCRYPTION_KEY_LENGTH: CREDENTIAL_ENCRYPTION_KEY must resolve to 32 bytes (got ${key.length} bytes).`);
  }
  return key;
}

export function encryptSecret(value: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(secret.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
