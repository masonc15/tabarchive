import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const extensionRoot = path.resolve(__dirname, '../..');
export const repoRoot = path.resolve(extensionRoot, '..');
export const nativeHostPath = path.join(repoRoot, 'native', 'tabarchive-host.py');
export const nativeHostName = 'tabarchive';
export const firefoxExtensionId = 'tabarchive@masonc15.github.io';
const firefoxManifestPath = [
  'Library',
  'Application Support',
  'Mozilla',
  'NativeMessagingHosts',
];

export type SeedTab = {
  url: string;
  title: string;
  closedAt: number;
  faviconUrl?: string;
};

export function buildFirefoxDist(outputDir: string) {
  execFileSync('npx', ['webpack', '--mode', 'production', '--output-path', outputDir], {
    cwd: extensionRoot,
    env: {
      ...process.env,
      TARGET: 'firefox',
    },
    stdio: 'pipe',
  });
}

export function installFirefoxNativeHost(homeDir: string) {
  execFileSync(path.join(repoRoot, 'native', 'install.sh'), ['--browser', 'firefox'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
    },
    stdio: 'pipe',
  });
}

export function getFirefoxNativeManifestPath(homeDir: string) {
  return path.join(homeDir, ...firefoxManifestPath, `${nativeHostName}.json`);
}

function runPython(script: string, args: string[], homeDir: string) {
  const result = spawnSync('python3', ['-c', script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDir,
    },
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Python exited with status ${result.status}.`,
        result.stderr || '(no stderr)',
        result.stdout || '(no stdout)',
      ].join('\n'),
    );
  }
}

export function seedArchivedTabs(homeDir: string, tabs: SeedTab[]) {
  const script = `
import importlib.util
import json
import pathlib
import sys

host_path = pathlib.Path(sys.argv[1])
tabs = json.loads(sys.argv[2])

spec = importlib.util.spec_from_file_location("tabarchive_host", host_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

conn = module.get_connection()
module.handle_archive(conn, {"tabs": tabs})
conn.close()
`;

  runPython(script, [nativeHostPath, JSON.stringify(tabs)], homeDir);
}

export function readFirefoxExtensionUuid(profileDir: string, extensionId: string) {
  const prefsPath = path.join(profileDir, 'prefs.js');
  if (!fs.existsSync(prefsPath)) {
    return null;
  }

  const prefs = fs.readFileSync(prefsPath, 'utf8');
  const match = prefs.match(
    /user_pref\("extensions\.webextensions\.uuids", "((?:\\.|[^"])*)"\);/,
  );
  if (!match) {
    return null;
  }

  try {
    const rawJson = JSON.parse(`"${match[1]}"`) as string;
    const uuids = JSON.parse(rawJson) as Record<string, string>;
    return uuids[extensionId] ?? null;
  } catch {
    return null;
  }
}

export function removeTempRoot(tempRoot: string) {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    execFileSync('rm', ['-rf', tempRoot], { stdio: 'ignore' });
  }
}
