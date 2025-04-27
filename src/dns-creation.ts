import crypto from 'crypto';

export function generateDkimKeys(
  outputDir: string,
  selector: string = 'default'
): { privateKey: string; publicKey: string } {
  console.log('Generating DKIM keys...');
  // Generate key pair
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return {
    privateKey,
    publicKey,
  };

  // Create DNS TXT record
  // Convert the public key to the correct format for DNS
  /* const publicKeyForDns = publicKey
    .toString()
    .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\n/g, '')
    .trim();

  const dnsRecord = `${selector}._domainkey IN TXT "v=DKIM1; k=rsa; p=${publicKeyForDns}"`;

  console.log('DKIM keys generated successfully!');
  console.log(`Private key saved at: ${privateKeyPath}`);
  console.log(`Public key saved at: ${publicKeyPath}`);

  return { privateKeyPath, publicKeyPath, dnsRecord }; */
}

export function generateSpfRecord(domain: string, ips: string[]): string {
  const ipEntries = ips
    .map(ip => {
      return ip.includes(':') ? `ip6:${ip}` : `ip4:${ip}`;
    })
    .join(' ');

  const spfRecord = `v=spf1 ${ipEntries} ${ipEntries ? '~all' : '-all'}`;

  return spfRecord;
}

export function generateDmarcRecord(domain: string): string {
  const dmarcRecord = 'v=DMARC1; p=none; sp=none; adkim=r; aspf=r;';
  return dmarcRecord;
}
