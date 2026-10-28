import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from '../config.js'

// AES-256-GCM: encrypts and also detects tampering. Stored as `v1.<iv>.<tag>.<ciphertext>` (base64url).

const getKey = () => {
  const key = Buffer.from(config.integrationKey, 'base64')
  if (key.length !== 32) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be 32 random bytes encoded as base64.')
  }
  return key
}

export const hasEncryptionKey = () => Buffer.from(config.integrationKey, 'base64').length === 32

export function encryptSecret(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

export function decryptSecret(stored: string) {
  const [version, iv, tag, data] = stored.split('.')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognized secret format.')
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}
