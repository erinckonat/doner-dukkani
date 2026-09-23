// Admin tasks for the game server, run on the VPS as the `doner` user:
//   node admin.mjs import-save <email> <save.json>
// Gives <email>'s account the save in <save.json> (a SaveData object, or {save: ...}).
// If the account doesn't exist yet, the save waits in pending/ and is attached
// the moment that email signs up.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.env.DATA_DIR || '/opt/doner-dukkani/data');
const [cmd, rawEmail, file] = process.argv.slice(2);

function write(target, body) {
  mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.admin.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, target);
}

if (cmd !== 'import-save' || !rawEmail || !file) {
  console.error('usage: node admin.mjs import-save <email> <save.json>');
  process.exit(1);
}

const email = rawEmail.trim().toLowerCase();
const parsed = JSON.parse(readFileSync(file, 'utf8'));
const save = parsed.save ?? parsed;
if (!Number.isFinite(save.money) || !Array.isArray(save.unlocked)) throw new Error('not a save');
// Newest copy everywhere, and marked synced so devices take it over their own.
save.t = Date.now();
save.synced = true;
const body = JSON.stringify({ save, updated: Date.now() });

const usersFile = path.join(DATA_DIR, 'users.json');
const user = existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, 'utf8'))[email] : null;
if (user) {
  write(path.join(DATA_DIR, 'saves', `${user.id}.json`), body);
  console.log(`save written to ${email}'s account`);
} else {
  write(path.join(DATA_DIR, 'pending', `${encodeURIComponent(email)}.json`), body);
  console.log(`no account yet: save waits for ${email} to sign up`);
}
