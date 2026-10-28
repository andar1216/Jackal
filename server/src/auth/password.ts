import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// scrypt (built into Node, so no extra dependency). These settings are in line with OWASP's
// guidance (about 64 MiB of memory per hash). They're stored inside each hash, so they can be
// raised later without breaking existing passwords.
const N = 2 ** 16
const R = 8
const P = 2
const KEY_LENGTH = 64
const MAX_MEMORY = 256 * 1024 * 1024

const scrypt = (password: string, salt: Buffer, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password.normalize('NFKC'), salt, KEY_LENGTH, { ...options, maxmem: MAX_MEMORY }, (err, key) =>
      err ? reject(err) : resolve(key),
    )
  })

/** Returns `scrypt$N$r$p$salt$hash` (salt and hash are base64). */
export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, { N, r: R, p: P })
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, n, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), { N: Number(n), r: Number(r), p: Number(p) })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

let dummyHash: Promise<string> | undefined

/** Spend the same time as a real check, so "no such email" can't be told apart by response time. */
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword('not-a-real-password')
  await verifyPassword(password, await dummyHash)
}
