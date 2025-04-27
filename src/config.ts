import fs from 'fs';
import path from 'path';

export interface DkimConfig {
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
    privateKey: '/path/to/private.key',
    selector: 'default',
  },
};

export function loadConfig(configPath: string): TinkSESConfig {
  try {
    const configFile = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configFile);
  } catch (error) {
    console.log(`Config file not found at ${configPath}, creating default config.`);
    const config = { ...defaultConfig };
    const dirPath = path.dirname(configPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return config;
  }
}

export function saveConfig(configPath: string, config: TinkSESConfig): void {
  const dirPath = path.dirname(configPath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
