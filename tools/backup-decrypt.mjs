// Déchiffre une sauvegarde : node tools/backup-decrypt.mjs backup/2026-10-10.enc CLE > sauvegarde.json
import fs from 'fs';
import crypto from 'crypto';
const [file, k] = process.argv.slice(2);
const b = fs.readFileSync(file);
if(b.slice(0, 4).toString() !== 'AAB1') throw new Error('format inconnu');
const d = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(k).digest(), b.slice(4, 16));
d.setAuthTag(b.slice(16, 32));
process.stdout.write(Buffer.concat([d.update(b.slice(32)), d.final()]));
