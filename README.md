# TinkSES

An open-source mail sending service, you can use it to send emails from your own server.

Aka, a self-hosted SES.

Oh, we don't have any other services dependencies, such as AWS SES, SendGrid, Mailgun, or Database, Redis, etc.

> In case you have any interest, you can also look at our email service [TinkMail](https://tinkmail.me) for both personal and business uses.

## Features

- Send emails using SMTP
- Password authentication
- Protect your domain and IP address with DKIM and SPF
  - DKIM signing
  - SPF records
  - DMARC records
- Easy to use
  - Attachments
  - HTML emails

## Usage

### Checking SMTP Connectivity

Before you start, you should have a working server to send emails. And please remember to check your server's connectivity to popular email providers.

Please note, major server providers may block port 25 for SMTP, so you have to find a good server provider.

You can verify if your server can connect to popular email providers:

```sh
npx tinkses check-smtp
```

### Getting Started

First-time setup with the interactive init command:

```sh
npx tinkses init
```

This will:
- Detect your network interfaces (IPv4 and IPv6)
- Generate DKIM keys
- Help you set up a configuration file
- Generate DNS records (SPF, DKIM, DMARC) for your domain

### Starting the Server

After initialization, start the SMTP server:

```sh
npx tinkses
```

### Configuration

If no configuration file is found, an interactive setup will run automatically. You can also specify a configuration file using the `-c` or `--config` option.

```sh
npx tinkses -c /path/to/config.json
```

### Configuration File

The configuration file is a JSON file that contains the following fields:

```json
{
  "port": 25,
  "host": "localhost",
  "username": "user",
  "password": "password",
  "domain": "example.com",
  "ip": ["192.0.2.1", "2001:db8::1"],
  "dkim": {
    "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
    "selector": "default"
  }
}
```

- `port`: The port to listen on. Default is `25`.
- `host`: The host to listen on. Default is `localhost`.
- `username`: The username to authenticate with. Default is `user`.
- `password`: The password to authenticate with. Default is `password`.
- `domain`: The domain to use for sending emails. Default is `example.com`.
- `ip`: An array of IP addresses used for sending emails. Used in SPF record generation.
- `dkim`: The DKIM configuration with the following fields:
  - `privateKey`: The private key content (or file path) used for DKIM signing.
  - `publicKey`: The public key content used in your DNS records.
  - `selector`: The selector to use for DKIM signing. Default is `default`.

## DNS Configuration

For maximum deliverability, configure your DNS with:

1. **SPF Record** - Specifies which IP addresses can send email for your domain
2. **DKIM Record** - Adds a digital signature to verify email authenticity
3. **DMARC Record** - Policy for handling emails that fail SPF/DKIM checks

TinkSES generates these records during initialization and provides guidance on adding them to your DNS configuration.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
