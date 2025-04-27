#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import process from 'process';
import inquirer from 'inquirer';
import { loadConfig, saveConfig, TinkSESConfig } from './config';
import { SmtpServer } from './smtp-server';
import { generateDkimKeys, generateSpfRecord, generateDmarcRecord } from './dns-creation';
import { getAllIPs } from './network';
import { generateDnsConfigurationTips, verifyDnsConfiguration } from './dns-verification';

// Get directory name from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Package info
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

// Create CLI
const program = new Command();

program
  .name('tinkses')
  .description('TinkSES - An open-source mail sending service')
  .version(packageJson.version)
  .option('-c, --config <path>', 'Path to config file', './tinkses.config.json');

// Init command to set up DKIM, detect IP, and generate DNS records
program
  .command('init')
  .description('Initialize TinkSES configuration')
  .action(async options => {
    console.log('Initializing TinkSES...');

    // Load existing config or create new one
    const configPath = program.opts().config;
    const config = loadConfig(configPath);

    // If no config loaded, use interactive setup
    if (!config) {
      await initConfig(configPath);
    } else {
      console.log('\nConfiguration already exists. Please edit the config file directly.');
    }
  });

// Main command to start server
program.action(async () => {
  // Load config
  const configPath = program.opts().config;

  // Check if config file exists
  const configFileExists = fs.existsSync(configPath);

  // Load or create config
  const config = loadConfig(configPath);

  if (!configFileExists || !config) {
    console.log('TinkSES is not initialized properly. Running interactive initialization...');
    return await initConfig(configPath);
  }

  console.log('Starting TinkSES server...');

  // Verify DNS configuration before starting
  const verificationResult = await verifyDnsConfiguration(config, false);

  // Add option to verify DNS in strict mode
  if (process.env.TINKSES_STRICT_DNS_CHECK === 'true' && !verificationResult) {
    console.error('DNS verification failed in strict mode. Server startup aborted.');
    process.exit(1);
  }

  // Create SMTP server
  const smtpServer = new SmtpServer(config);
  smtpServer.start();

  // Handle shutdown
  const shutdown = async () => {
    console.log('Shutting down TinkSES...');
    await smtpServer.stop();
    process.exit(0);
  };

  // Handle signals for graceful shutdown
  ['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
    process.on(signal, shutdown);
  });
});

async function initConfig(configPath: string) {
  let updatedConfig: TinkSESConfig = await runInteractiveSetup();
  updatedConfig = await completeInitialization(updatedConfig, configPath);
  generateDnsConfigurationTips(updatedConfig, true, true, true);
  console.log('\nInitialization complete! You can now start TinkSES with:');
  console.log(`npx tinkses -c ${configPath}`);
}

/**
 * Run interactive setup to configure TinkSES
 * @returns configuration
 */
async function runInteractiveSetup() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'domain',
      message: 'What domain name will you use for sending emails?',
      default: 'example.com',
      validate: input => {
        if (!input || input === 'example.com') {
          return 'Please enter a valid domain name';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'selector',
      message: 'What DKIM selector would you like to use?',
      default: 'default',
    },
    {
      type: 'input',
      name: 'port',
      message: 'What port should the SMTP server run on?',
      default: '2525',
      validate: input => {
        const port = parseInt(input);
        if (isNaN(port) || port < 1 || port > 65535) {
          return 'Please enter a valid port number (1-65535)';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'host',
      message: 'What host should the SMTP server bind to?',
      default: '127.0.0.1',
    },
    {
      type: 'input',
      name: 'username',
      message: 'Set SMTP authentication username:',
      default: 'user',
      validate: input => (input ? true : 'Username cannot be empty'),
    },
    {
      type: 'password',
      name: 'password',
      message: 'Set SMTP authentication password:',
      mask: '*',
      validate: input => (input ? true : 'Password cannot be empty'),
    },
  ]);

  // Update config with user answers
  return {
    domain: answers.domain,
    port: parseInt(answers.port),
    host: answers.host,
    username: answers.username,
    password: answers.password,
    ip: [],
    dkim: {
      privateKey: '',
      publicKey: '',
      selector: answers.selector,
    },
  };
}

/**
 * Complete the initialization process by generating keys and DNS records
 * @param config Configuration
 * @param configPath Path to save config
 */
async function completeInitialization(config: TinkSESConfig, configPath: string) {
  // Create output directory if it doesn't exist
  const resolvedOutputDir = path.dirname(path.resolve(configPath));
  if (!fs.existsSync(resolvedOutputDir)) {
    fs.mkdirSync(resolvedOutputDir, { recursive: true });
  }

  // Generate DKIM keys
  const { privateKey, publicKey } = generateDkimKeys(resolvedOutputDir, config.dkim.selector);

  // Update config with DKIM settings
  config.dkim.privateKey = privateKey;
  config.dkim.publicKey = publicKey;

  // Detect IP addresses
  console.log('\nDetecting IP addresses...');
  const ips = await getAllIPs(false);
  console.log(`Found ${ips.length} IP addresses:`);
  ips.forEach(ip => console.log(` - ${ip}`));

  // Update config with IP addresses
  config.ip = ips;

  // Save updated config
  saveConfig(configPath, config);
  console.log(`\nConfiguration saved to ${configPath}`);

  return config;
}

// Parse CLI args and execute
program.parse(process.argv);
