# TinkSES

An open-source mail sending service, you can use it to send emails from your own server.

Aka, a self-hosted SES.

Oh, we don't have any other services dependencies, such as AWS SES, SendGrid, Mailgun, or Database, Redis, etc.

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

```sh
npx tinkses
```

### Configuration

If no configuration file is found, a default configuration file will be created in the current directory. You can also specify a configuration file using the `-c` or `--config` option.

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
  "ip": [],
  "dkim": {
    "privateKey": "/path/to/private.key",
    "selector": "default"
  },
}
```

- `port`: The port to listen on. Default is `25`.
- `host`: The host to listen on. Default is `localhost`.
- `username`: The username to authenticate with. Default is `user`.
- `password`: The password to authenticate with. Default is `password`.
- `domain`: The domain to use for sending emails. Default is `example.com`.
- `ip`: The IP address to use for sending emails. This is an array of IP addresses. Default is an empty array.
- `dkim`: The DKIM configuration. This is an object that contains the following fields:
  - `privateKey`: The path to the private key file. This is required.
  - `selector`: The selector to use for DKIM signing. Default is `default`.


## License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Roadmap

- [ ] init the project
- [ ] init command to
  - [ ] determine the IP (both IPv4 and IPv6)
  - [ ] generate DKIM keys
  - [ ] write IPs and DKIM keys to the config file
  - [ ] generate SPF records
  - [ ] generate DMARC records
- [ ] server
  - [ ] SMTP server
- [ ] transport
  - [ ] SMTP transport to send emails
