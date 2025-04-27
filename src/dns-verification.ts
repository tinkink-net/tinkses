import dns from 'dns';
import { promisify } from 'util';
import fs from 'fs';
import crypto from 'crypto';
import { TinkSESConfig } from './config.js';
import { generateSpfRecord, generateDmarcRecord } from './dns-creation.js';

// Promisify DNS lookups
const resolveTxt = promisify(dns.resolveTxt);

interface VerificationResult {
  isValid: boolean;
  message: string;
}

/**
 * Verify SPF record configuration
 * @param domain Domain to check
 * @param ips Expected IP addresses in the SPF record
 */
async function verifySpfRecord(domain: string, ips: string[]): Promise<VerificationResult> {
  try {
    const records = await resolveTxt(domain);

    // Find SPF record
    const spfRecord = records.flat().find(record => record.startsWith('v=spf1'));

    if (!spfRecord) {
      return {
        isValid: false,
        message: `No SPF record found for ${domain}. Please add the SPF record to your DNS configuration.`,
      };
    }

    // Check if all IPs are included in the SPF record
    const missingIps = ips.filter(ip => {
      const format = ip.includes(':') ? `ip6:${ip}` : `ip4:${ip}`;
      return !spfRecord.includes(format);
    });

    if (missingIps.length > 0) {
      return {
        isValid: false,
        message: `SPF record found but missing the following IPs: ${missingIps.join(', ')}`,
      };
    }

    return {
      isValid: true,
      message: 'SPF record is properly configured.',
    };
  } catch (error) {
    return {
      isValid: false,
      message: `Failed to verify SPF record: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Verify DKIM record configuration
 * @param domain Domain to check
 * @param selector DKIM selector
 */
async function verifyDkimRecord(domain: string, selector: string): Promise<VerificationResult> {
  try {
    const dkimDomain = `${selector}._domainkey.${domain}`;
    const records = await resolveTxt(dkimDomain);

    if (!records || records.length === 0) {
      return {
        isValid: false,
        message: `No DKIM record found for ${dkimDomain}. Please add the DKIM record to your DNS configuration.`,
      };
    }

    const dkimRecord = records.flat().find(record => record.startsWith('v=DKIM1'));

    if (!dkimRecord) {
      return {
        isValid: false,
        message: `Invalid DKIM record format for ${dkimDomain}. Record should start with "v=DKIM1".`,
      };
    }

    return {
      isValid: true,
      message: 'DKIM record is properly configured.',
    };
  } catch (error) {
    return {
      isValid: false,
      message: `Failed to verify DKIM record: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Verify DMARC record configuration
 * @param domain Domain to check
 */
async function verifyDmarcRecord(domain: string): Promise<VerificationResult> {
  try {
    const dmarcDomain = `_dmarc.${domain}`;
    const records = await resolveTxt(dmarcDomain);

    if (!records || records.length === 0) {
      return {
        isValid: false,
        message: `No DMARC record found for ${dmarcDomain}. Please add the DMARC record to your DNS configuration.`,
      };
    }

    const dmarcRecord = records.flat().find(record => record.startsWith('v=DMARC1'));

    if (!dmarcRecord) {
      return {
        isValid: false,
        message: `Invalid DMARC record format for ${dmarcDomain}. Record should start with "v=DMARC1".`,
      };
    }

    return {
      isValid: true,
      message: 'DMARC record is properly configured.',
    };
  } catch (error) {
    return {
      isValid: false,
      message: `Failed to verify DMARC record: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Generate DNS configuration tips for missing or invalid records
 * @param config TinkSES configuration
 * @param spf Whether to generate for SPF record
 * @param dkim Whether to generate for DKIM record
 * @param dmarc Whether to generate for DMARC record
 * @returns Configuration tips as a formatted string
 */
export function generateDnsConfigurationTips(
  config: TinkSESConfig,
  spf: boolean,
  dkim: boolean,
  dmarc: boolean
): string {
  let tips = '\n=== DNS CONFIGURATION TIPS ===\n';

  if (spf) {
    const spfRecord = generateSpfRecord(config.domain, config.ip);
    tips += '\n📌 SPF Record:\n';
    tips += "Add this TXT record to your domain's DNS configuration:\n\n";
    tips += `${config.domain}. IN TXT "${spfRecord}"\n\n`;
    tips += 'This allows your server IPs to send mail for your domain.\n';
  }

  if (dkim) {
    // If DKIM private key exists, extract public key for DNS record
    let dkimTip = '\n📌 DKIM Record:\n';
    if (config.dkim.publicKey) {
      try {
        const publicKey = config.dkim.publicKey
          .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\n/g, '')
          .trim();

        dkimTip += "Add this TXT record to your domain's DNS configuration:\n\n";
        dkimTip += `${config.dkim.selector}._domainkey.${config.domain}. IN TXT "v=DKIM1; k=rsa; p=${publicKey}"\n\n`;
      } catch (error) {
        dkimTip +=
          'Unable to generate DKIM record from private key. Please run "tinkses init" to generate new keys.\n';
      }
    } else {
      dkimTip += 'DKIM private key not found. Please run "tinkses init" to generate DKIM keys.\n';
    }
    tips += dkimTip;
    tips += 'DKIM proves email authenticity and prevents domain spoofing.\n';
  }

  if (dmarc) {
    const dmarcRecord = generateDmarcRecord(config.domain);
    tips += '\n📌 DMARC Record:\n';
    tips += "Add this TXT record to your domain's DNS configuration:\n\n";
    tips += `_dmarc.${config.domain}. IN TXT "${dmarcRecord}"\n\n`;
    tips += 'DMARC tells receivers how to handle emails that fail SPF or DKIM checks.\n';
  }

  tips += "\nOnce you've added these records, DNS changes may take 24-48 hours to propagate.\n";
  tips += 'You can verify your DNS records using tools like https://mxtoolbox.com/\n';

  return tips;
}

export async function verifyDnsConfiguration(
  config: TinkSESConfig,
  strict: boolean = false
): Promise<boolean> {
  console.log(`\nVerifying DNS configuration for ${config.domain}...`);

  const spfResult = await verifySpfRecord(config.domain, config.ip);
  const dkimResult = await verifyDkimRecord(config.domain, config.dkim.selector);
  const dmarcResult = await verifyDmarcRecord(config.domain);

  console.log(`\nSPF: ${spfResult.isValid ? '✓' : '✗'} ${spfResult.message}`);
  console.log(`DKIM: ${dkimResult.isValid ? '✓' : '✗'} ${dkimResult.message}`);
  console.log(`DMARC: ${dmarcResult.isValid ? '✓' : '✗'} ${dmarcResult.message}`);

  const allValid = spfResult.isValid && dkimResult.isValid && dmarcResult.isValid;

  if (!allValid) {
    // Display configuration tips for missing or invalid records
    const configTips = generateDnsConfigurationTips(
      config,
      !spfResult.isValid,
      !dkimResult.isValid,
      !dmarcResult.isValid
    );
    console.log(configTips);

    if (strict) {
      console.log(
        '\nServer start aborted. Please configure your DNS records correctly and try again.'
      );
      return false;
    } else {
      console.log(
        '\nContinuing server startup, but emails may be marked as spam or rejected by receivers.'
      );
    }
  } else {
    console.log(
      '\nAll DNS records are properly configured! Your emails should have good deliverability.'
    );
  }

  return !strict || allValid;
}
