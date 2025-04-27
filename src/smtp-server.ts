import fs from 'fs';
import path from 'path';
import { SMTPServer, SMTPServerOptions } from 'smtp-server';
import { simpleParser, HeaderLines, AddressObject } from 'mailparser';
import nodemailer from 'nodemailer';
import { DkimConfig, TinkSESConfig } from './config.js';
import dns from 'dns';
import { promisify } from 'util';
import { createRequire } from 'module';

import { SendMailOptions } from 'nodemailer';

// Define a type for address objects returned by addressparser
interface EmailAddress {
  address: string;
  name?: string;
}

// Import addressparser with createRequire since it doesn't have proper types
const require = createRequire(import.meta.url);
const addressparser = require('nodemailer/lib/addressparser');

export function createDkimSigner(domain: string, dkimConfig: DkimConfig) {
  try {
    const privateKey = dkimConfig.privateKey;
    if (!privateKey) return undefined;

    return {
      domainName: domain,
      keySelector: dkimConfig.selector,
      privateKey,
    };
  } catch (error) {
    console.error('Error loading DKIM private key:', error);
    return undefined;
  }
}

export class SmtpServer {
  private server: SMTPServer;
  private config: TinkSESConfig;

  constructor(config: TinkSESConfig) {
    this.config = config;

    const options: SMTPServerOptions = {
      secure: false, // Changed to false for development
      disableReverseLookup: true,
      authMethods: ['PLAIN', 'LOGIN'],
      allowInsecureAuth: true,

      onAuth: (auth, session, callback) => {
        const username = auth.username;
        const password = auth.password;

        console.log(`[AUTH] Attempt: ${username}`);

        // Simple authentication check against config
        if (username === this.config.username && password === this.config.password) {
          console.log(`[AUTH] SUCCESS: User '${username}' authenticated`);
          callback(null, { user: username });
        } else {
          console.log(`[AUTH] FAILED: Invalid credentials for user '${username}'`);
          callback(new Error('Invalid username or password'));
        }
      },

      onConnect: (session, callback) => {
        console.log(`[CONN] New connection from ${session.remoteAddress}`);
        callback();
      },

      onMailFrom: (address, session, callback) => {
        console.log(`[FROM] ${address.address}`);

        // Ensure the from address is from the configured domain
        const [, domain] = address.address.split('@');
        if (domain !== this.config.domain) {
          console.log(`[ERROR] Domain '${domain}' not allowed, expected '${this.config.domain}'`);
          return callback(new Error(`Sending from domain ${domain} not allowed`));
        }

        callback();
      },

      onRcptTo: (address, session, callback) => {
        console.log(`[TO] ${address.address}`);
        callback();
      },

      onData: (stream, session, callback) => {
        console.log('[DATA] Receiving message data...');

        const chunks: Buffer[] = [];
        stream.on('data', chunk => {
          chunks.push(chunk);
        });

        stream.on('end', async () => {
          const messageBuffer = Buffer.concat(chunks);

          try {
            // Parse the email
            const parsedMail = await simpleParser(messageBuffer);
            const from = session.envelope.mailFrom ? session.envelope.mailFrom.address : 'unknown';
            const to = session.envelope.rcptTo.map(rcpt => rcpt.address).join(', ');
            const subject = parsedMail.subject || '(No Subject)';
            const messageId =
              parsedMail.messageId ||
              `<${Date.now()}.${Math.random().toString(36).substring(2)}@${this.config.domain}>`;

            console.log('┌──────────────────────────────────────────────────────');
            console.log(`│ MESSAGE RECEIVED:`);
            console.log(`│ From: ${from}`);
            console.log(`│ To: ${to}`);
            console.log(`│ Subject: ${subject}`);
            console.log(`│ MessageID: ${messageId}`);
            console.log('└──────────────────────────────────────────────────────');

            // Create base mail options
            const flattenAddresses = (field: any) => {
              if (!field) return '';
              if (Array.isArray(field)) {
                return field
                  .map((addr: any) => (typeof addr === 'string' ? addr : addr.text || addr.address))
                  .join(', ');
              }
              if (typeof field === 'string') return field;
              if (field.text) return field.text;
              if (field.value && Array.isArray(field.value)) {
                return field.value.map((addr: any) => addr.address || addr.text).join(', ');
              }
              return '';
            };

            const mailOptions: SendMailOptions = {
              from: from,
              to: flattenAddresses(parsedMail.to) || to,
              cc: flattenAddresses(parsedMail.cc),
              bcc: flattenAddresses(parsedMail.bcc),
              subject: subject,
              text: parsedMail.text || undefined,
              html: parsedMail.html || undefined,
              attachments: parsedMail.attachments
                ? parsedMail.attachments.map((attachment: any) => ({
                    filename: attachment.filename,
                    content: attachment.content,
                    contentType: attachment.contentType,
                    encoding: attachment.encoding,
                    contentDisposition:
                      attachment.contentDisposition === 'inline' ? 'inline' : 'attachment',
                  }))
                : [],
              messageId: messageId,
              headers: parsedMail.headerLines
                .filter(
                  header =>
                    !['from', 'to', 'cc', 'bcc', 'subject', 'message-id'].includes(
                      header.key.toLowerCase()
                    )
                )
                .map(header => ({
                  key: header.key,
                  value: header.line,
                })),
            };

            // Get the from address domain for DKIM
            const fromAddress: EmailAddress = addressparser(from, { flatten: true })[0];
            const fromDomain = fromAddress.address.split('@')[1];

            // Create recipient list from envelope or headers
            let recipientsStr = to;
            if (parsedMail.cc)
              recipientsStr += ',' + (typeof parsedMail.cc === 'string' ? parsedMail.cc : to);
            if (parsedMail.bcc)
              recipientsStr += ',' + (typeof parsedMail.bcc === 'string' ? parsedMail.bcc : '');

            const recipients: EmailAddress[] = addressparser(recipientsStr, { flatten: true });

            console.log(`Recipients: ${recipients.map((r: EmailAddress) => r.address).join(', ')}`);

            // Group recipients by domain
            const recipientGroups: Record<string, EmailAddress[]> = {};
            for (const recipient of recipients) {
              const recipientDomain = recipient.address.split('@')[1];
              if (!recipientGroups[recipientDomain]) {
                recipientGroups[recipientDomain] = [];
              }
              recipientGroups[recipientDomain].push(recipient);
            }

            // Create DKIM signer
            const dkimSigner = createDkimSigner(this.config.domain, this.config.dkim);

            // Track delivery results
            const results = {
              success: [] as string[],
              failed: [] as { domain: string; error: string }[],
            };

            // Send to each domain group
            for (const domain in recipientGroups) {
              const domainRecipients = recipientGroups[domain];
              console.log(
                `Processing domain: ${domain} with ${domainRecipients.length} recipients`
              );

              const domainMessage = {
                envelope: {
                  from: from,
                  to: domainRecipients.map(to => to.address),
                },
                ...mailOptions,
              };

              try {
                // Look up MX records for the domain
                const mx = await promisify(dns.resolveMx)(domain).catch(() => [
                  { priority: 0, exchange: domain },
                ]);
                const priorityMx = mx.sort((a, b) => a.priority - b.priority)[0];
                const mxHost = priorityMx.exchange;
                const mxPort = 25;

                console.log(`Using MX record: ${mxHost}:${mxPort} for domain ${domain}`);

                // Create a transport for this specific domain
                const transport = nodemailer.createTransport({
                  host: mxHost,
                  port: mxPort,
                  secure: false,
                  name: fromDomain,
                  debug: true,
                  tls: {
                    rejectUnauthorized: false,
                  },
                  dkim: dkimSigner,
                });

                // Send the email
                const info = await transport.sendMail(domainMessage);
                console.log(`[SUCCESS] Email sent to ${domain} (${info.messageId})`);
                results.success.push(domain);
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`[ERROR] Failed to send to domain ${domain}:`, error);
                results.failed.push({
                  domain,
                  error: errorMessage,
                });
                // Continue with other domains even if one fails
              }
            }

            // Log summary of results
            console.log('┌──────────────────────────────────────────────────────');
            console.log(`│ DELIVERY RESULTS:`);
            console.log(`│ Success: ${results.success.length} domains`);
            console.log(`│ Failed: ${results.failed.length} domains`);
            if (results.failed.length > 0) {
              console.log(`│ Failed domains:`);
              results.failed.forEach(failure => {
                console.log(`│   - ${failure.domain}: ${failure.error}`);
              });
            }
            console.log('└──────────────────────────────────────────────────────');

            // Return appropriate response based on results
            if (results.failed.length > 0) {
              if (results.success.length > 0) {
                // Partial success
                const error = new Error(
                  `Partial delivery: ${results.success.length} succeeded, ${results.failed.length} failed`
                );
                // @ts-ignore - Adding custom properties to Error
                error.deliveryResults = results;
                callback(error);
              } else {
                // Complete failure
                const error = new Error(`Delivery failed to all ${results.failed.length} domains`);
                // @ts-ignore - Adding custom properties to Error
                error.deliveryResults = results;
                callback(error);
              }
            } else {
              // Complete success
              callback();
            }
          } catch (error) {
            console.log('┌──────────────────────────────────────────────────────');
            console.log(`│ ERROR PROCESSING MESSAGE:`);
            console.log(`│ ${error instanceof Error ? error.message : String(error)}`);
            console.log('└──────────────────────────────────────────────────────');
            callback(new Error('Error processing message'));
          }
        });
      },
    };

    this.server = new SMTPServer(options);

    this.server.on('error', err => {
      console.log('┌──────────────────────────────────────────────────────');
      console.log(`│ SMTP SERVER ERROR:`);
      console.log(`│ ${err instanceof Error ? err.message : String(err)}`);
      console.log('└──────────────────────────────────────────────────────');
    });
  }

  public start(): void {
    this.server.listen(this.config.port, this.config.host, () => {
      console.log('┌──────────────────────────────────────────────────────');
      console.log(`│ SMTP SERVER STARTED`);
      console.log(`│ Listening on: ${this.config.host}:${this.config.port}`);
      console.log(`│ Domain: ${this.config.domain}`);
      console.log('└──────────────────────────────────────────────────────');
    });
  }

  public stop(): Promise<void> {
    return new Promise(resolve => {
      this.server.close(() => {
        console.log('┌──────────────────────────────────────────────────────');
        console.log(`│ SMTP SERVER STOPPED`);
        console.log('└──────────────────────────────────────────────────────');
        resolve();
      });
    });
  }
}
