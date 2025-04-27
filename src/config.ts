import fs from 'fs';
import path from 'path';

export interface DkimConfig {
  publicKey: string;
  privateKey: string;
  selector: string;
}

export interface TinkSESConfig {
  port: number;
  host: string;
  username: string;
  password: string;
  domain: string;
  ip: string[];
  dkim: DkimConfig;
}

export const defaultConfig: TinkSESConfig = {
  port: 25,
  host: 'localhost',
  username: 'user',
  password: 'password',
  domain: 'example.com',
  ip: [],
  dkim: {
    privateKey: '',
    publicKey: '',
    selector: 'default',
  },
};

export function loadConfig(configPath: string): TinkSESConfig | null {
  try {
    const configFile = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configFile);
  } catch (error) {
    console.error(`Error reading config file at ${configPath}:`, (error as Error).message);
    return null;
  }
}

export function saveConfig(configPath: string, config: TinkSESConfig): void {
  const dirPath = path.dirname(configPath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
