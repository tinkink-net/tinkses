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
import { verifyDnsConfiguration } from './dns-verification';

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
  .description('Initialize TinkSES with DKIM keys and detect IP addresses')
  .option('-o, --output <directory>', 'Directory for DKIM keys', './keys')
  .option('-d, --domain <domain>', 'Domain name to use')
  .option('-s, --selector <selector>', 'DKIM selector', 'default')
  .option('-i, --interactive', 'Use interactive setup mode', false)
  .action(async options => {
    console.log('Initializing TinkSES...');

    // Load existing config or create new one
    const configPath = program.opts().config;
    const config = loadConfig(configPath);

    // If interactive mode or no domain specified, use interactive setup
    if (options.interactive || !options.domain) {
      const { config: updatedConfig, outputDir } = await runInteractiveSetup(config, options);
      await completeInitialization(updatedConfig, outputDir, configPath);
    } else {
      // Update domain if specified through CLI
      if (options.domain) {
        config.domain = options.domain;
      }
      await completeInitialization(config, options.output, configPath);
    }

    console.log('\nInitialization complete! You can now start TinkSES with:');
    console.log(`npx tinkses -c ${configPath}`);
  });

// Main command to start server
program.action(async () => {
  // Load config
  const configPath = program.opts().config;

  // Check if config file exists
  const configFileExists = fs.existsSync(configPath);

  // Load or create config
  const config = loadConfig(configPath);

  // Check if DKIM keys are set up properly
  const dkimSetupComplete =
    config.dkim.privateKey &&
    fs.existsSync(config.dkim.privateKey) &&
    config.domain &&
    config.domain !== 'example.com';

  if (!configFileExists || !dkimSetupComplete) {
    console.log('TinkSES is not initialized properly. Running interactive initialization...');

    // Run interactive setup
    const { config: updatedConfig, outputDir } = await runInteractiveSetup(config);

    await completeInitialization(updatedConfig, outputDir, configPath);

    console.log('\nInitialization complete!');
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

/**
 * Run interactive setup to configure TinkSES
 * @param config Current configuration
 * @param options Command options
 * @returns Updated configuration and output directory
 */
async function runInteractiveSetup(
  config: TinkSESConfig,
  options: { selector?: string; output?: string } = {}
) {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'domain',
      message: 'What domain name will you use for sending emails?',
      default: config.domain !== 'example.com' ? config.domain : undefined,
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
      default: options.selector || config.dkim.selector || 'default',
    },
    {
      type: 'input',
      name: 'outputDir',
      message: 'Where should DKIM keys be stored?',
      default: options.output || './keys',
    },
    {
      type: 'input',
      name: 'port',
      message: 'What port should the SMTP server run on?',
      default: config.port.toString(),
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
      default: config.host,
    },
    {
      type: 'input',
      name: 'username',
      message: 'Set SMTP authentication username:',
      default: config.username !== 'user' ? config.username : undefined,
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
  config.domain = answers.domain;
  config.dkim.selector = answers.selector;
  config.port = parseInt(answers.port);
  config.host = answers.host;
  config.username = answers.username;
  config.password = answers.password;

  return { config, outputDir: answers.outputDir };
}

/**
 * Complete the initialization process by generating keys and DNS records
 * @param config Configuration
 * @param outputDir Output directory for keys
 * @param configPath Path to save config
 */
async function completeInitialization(
  config: TinkSESConfig,
  outputDir: string,
  configPath: string
) {
  // Create output directory if it doesn't exist
  const resolvedOutputDir = path.resolve(outputDir);
  if (!fs.existsSync(resolvedOutputDir)) {
    fs.mkdirSync(resolvedOutputDir, { recursive: true });
  }

  // Generate DKIM keys
  const { privateKeyPath, publicKeyPath, dnsRecord } = generateDkimKeys(
    resolvedOutputDir,
    config.dkim.selector
  );

  // Update config with DKIM settings
  config.dkim.privateKey = privateKeyPath;

  // Detect IP addresses
  console.log('\nDetecting IP addresses...');
  const ips = await getAllIPs(false);
  console.log(`Found ${ips.length} IP addresses:`);
  ips.forEach(ip => console.log(` - ${ip}`));

  // Update config with IP addresses
  config.ip = ips;

  // Generate SPF record
  const spfRecord = generateSpfRecord(config.domain, ips);

  // Generate DMARC record
  const dmarcRecord = generateDmarcRecord(config.domain);

  // Save updated config
  saveConfig(configPath, config);
  console.log(`\nConfiguration saved to ${configPath}`);

  // Display DNS records to configure
  console.log('\nPlease configure these DNS records for your domain:');
  console.log(`\nDKIM Record (${config.dkim.selector}._domainkey.${config.domain}):`);
  console.log(dnsRecord);

  console.log('\nSPF Record:');
  console.log(spfRecord);

  console.log(`\nDMARC Record (_dmarc.${config.domain}):`);
  console.log(dmarcRecord);
}

// Parse CLI args and execute
program.parse(process.argv);
