import { execSync } from 'child_process';
import path from 'path';

export default async () => {
  const root = path.resolve(__dirname, '../..');
  execSync('npm run build:chromium', { cwd: root, stdio: 'inherit' });
};
