import fs from 'fs';
import path from 'path';
import { SMTPServer, SMTPServerOptions } from 'smtp-server';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { TinkSESConfig } from './config';
import { createDkimSigner } from './dns-creation';

export class SmtpServer {
  private server: SMTPServer;
  private config: TinkSESConfig;
  private transporter: nodemailer.Transporter;

  constructor(config: TinkSESConfig) {
    this.config = config;

    // Create a transporter for sending emails
    this.transporter = nodemailer.createTransport({
      dkim:
        config.dkim.privateKey && fs.existsSync(config.dkim.privateKey)
          ? createDkimSigner(config.dkim)
          : undefined,
    });

    const options: SMTPServerOptions = {
      secure: false, // Changed to false for development
      disableReverseLookup: true,
      authMethods: ['PLAIN', 'LOGIN'],

      onAuth: (auth, session, callback) => {
        const username = auth.username;
        const password = auth.password;

        console.log(`Auth attempt: ${username}`);

        // Simple authentication check against config
        if (username === this.config.username && password === this.config.password) {
          console.log('Authentication successful');
          callback(null, { user: username });
        } else {
          console.log('Authentication failed');
          callback(new Error('Invalid username or password'));
        }
      },

      onConnect: (session, callback) => {
        console.log(`Client connected: ${session.remoteAddress}`);
        callback();
      },

      onMailFrom: (address, session, callback) => {
        console.log(`Mail from: ${address.address}`);

        // Ensure the from address is from the configured domain
        const [, domain] = address.address.split('@');
        if (domain !== this.config.domain) {
          console.log(`Domain ${domain} not allowed, expected ${this.config.domain}`);
          return callback(new Error(`Sending from domain ${domain} not allowed`));
        }

        callback();
      },

      onRcptTo: (address, session, callback) => {
        console.log(`Recipient: ${address.address}`);
        callback();
      },

      onData: (stream, session, callback) => {
        console.log('Receiving message data');

        const chunks: Buffer[] = [];
        stream.on('data', chunk => {
          chunks.push(chunk);
        });

        stream.on('end', async () => {
          const messageBuffer = Buffer.concat(chunks);

          try {
            // Parse the email
            const parsedMail = await simpleParser(messageBuffer);
            console.log(`Received email: ${parsedMail.subject}`);

            // Process and send the email
            const mailOptions = {
              from: session.envelope.mailFrom?.address,
              to: session.envelope.rcptTo.map(rcpt => rcpt.address).join(','),
              subject: parsedMail.subject,
              text: parsedMail.text,
              html: parsedMail.html || undefined,
              attachments: parsedMail.attachments,
              messageId: parsedMail.messageId,
              headers: parsedMail.headerLines.map(header => ({
                key: header.key,
                value: header.line,
              })),
            };

            // Send email using the transporter
            await this.transporter.sendMail(mailOptions);
            console.log('Email sent successfully');

            callback();
          } catch (error) {
            console.error('Error processing email:', error);
            callback(new Error('Error processing message'));
          }
        });
      },
    };

    this.server = new SMTPServer(options);

    this.server.on('error', err => {
      console.error('SMTP Server error:', err);
    });
  }

  public start(): void {
    this.server.listen(this.config.port, this.config.host, () => {
      console.log(`SMTP server listening on ${this.config.host}:${this.config.port}`);
    });
  }

  public stop(): Promise<void> {
    return new Promise(resolve => {
      this.server.close(() => {
        console.log('SMTP server stopped');
        resolve();
      });
    });
  }
}
