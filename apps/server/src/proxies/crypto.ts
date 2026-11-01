import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Encrypts secrets at rest (proxy passwords) with AES-256-GCM. The key lives in
 * the data directory, generated on first use, so a copied database file alone
 * does not reveal credentials.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(dataDir: string) {
    const file = path.join(dataDir, 'secret.key');
    if (fs.existsSync(file)) {
      const raw = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
      if (raw.length !== 32) throw new Error(`Invalid key file at ${file}`);
      this.key = raw;
    } else {
      this.key = crypto.randomBytes(32);
      fs.writeFileSync(file, this.key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
    }
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const [ver, iv, tag, data] = payload.split(':');
    if (ver !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised secret format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}
