import * as fs from 'fs';
import * as path from 'path';

const STATE_FILE = path.join(__dirname, '../.auth-state.json');

function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as {
        email: string;
        password: string;
        firmCode: string;
      };
    }
  } catch {}
  return { email: 'unknown@test.com', password: 'unknown', firmCode: 'UNKN' };
}

export const testCredentials = readState();
// Re-read on each import in case globalSetup just wrote it
Object.assign(testCredentials, readState());
