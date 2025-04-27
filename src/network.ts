import os from 'os';

export interface NetworkInterface {
  name: string;
  ipv4: string[];
  ipv6: string[];
}

/**
 * Check if an IP address is a private/LAN IP
 */
export function isPrivateIP(ip: string): boolean {
  // IPv4 private ranges
  if (ip.includes('.')) {
    const parts = ip.split('.').map(Number);

    // 10.0.0.0 - 10.255.255.255
    if (parts[0] === 10) return true;

    // 172.16.0.0 - 172.31.255.255
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

    // 192.168.0.0 - 192.168.255.255
    if (parts[0] === 192 && parts[1] === 168) return true;

    // 169.254.0.0 - 169.254.255.255 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;

    // 127.0.0.0 - 127.255.255.255 (loopback)
    if (parts[0] === 127) return true;

    // 100.64.0.0/10 (CGNAT range used by Tailscale and ISPs)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

    // 100.100.100.100 (Tailscale Quad100 address)
    if (parts[0] === 100 && parts[1] === 100 && parts[2] === 100 && parts[3] === 100) return true;
  }
  // IPv6 private ranges
  else if (ip.includes(':')) {
    // fe80::/10 (link-local)
    if (
      ip.toLowerCase().startsWith('fe8') ||
      ip.toLowerCase().startsWith('fe9') ||
      ip.toLowerCase().startsWith('fea') ||
      ip.toLowerCase().startsWith('feb')
    )
      return true;

    // fc00::/7 (unique local addresses)
    if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true;

    // ::1 (loopback)
    if (ip === '::1') return true;
  }

  return false;
}

export function getNetworkInterfaces(includePrivate: boolean = true): NetworkInterface[] {
  const interfaces = os.networkInterfaces();
  const result: NetworkInterface[] = [];

  for (const [name, netInterface] of Object.entries(interfaces)) {
    if (!netInterface) continue;

    const ipv4: string[] = [];
    const ipv6: string[] = [];

    for (const iface of netInterface) {
      // Skip internal/loopback interfaces for external use
      if (!iface.internal) {
        const isPrivate = isPrivateIP(iface.address);
        if (includePrivate || !isPrivate) {
          if (iface.family === 'IPv4') {
            ipv4.push(iface.address);
          } else if (iface.family === 'IPv6') {
            ipv6.push(iface.address);
          }
        }
      }
    }

    if (ipv4.length > 0 || ipv6.length > 0) {
      result.push({ name, ipv4, ipv6 });
    }
  }

  return result;
}

export interface IPInfoResponse {
  ip: string;
  city?: string;
  region?: string;
  country?: string;
  loc?: string;
  org?: string;
  postal?: string;
  timezone?: string;
}

export async function getPublicIPs(): Promise<{ ipv4?: string; ipv6?: string }> {
  const result: { ipv4?: string; ipv6?: string } = {};

  try {
    // Try to get public IPv4
    const ipv4Response = await fetch('https://ipinfo.io/json');
    if (ipv4Response.ok) {
      const data: IPInfoResponse = await ipv4Response.json();
      if (data && data.ip) {
        result.ipv4 = data.ip;
      }
    }
  } catch (error) {
    console.error('Error getting public IPv4:', error);
  }

  try {
    // Try to get public IPv6
    const ipv6Response = await fetch('https://v6.ipinfo.io/json');
    if (ipv6Response.ok) {
      const data: IPInfoResponse = await ipv6Response.json();
      if (data && data.ip) {
        result.ipv6 = data.ip;
      }
    }
  } catch (error) {
    console.error('Error getting public IPv6:', error);
  }

  return result;
}

export async function getAllIPs(includePrivate: boolean = true): Promise<string[]> {
  const ips: string[] = [];

  // Get local interfaces
  const interfaces = getNetworkInterfaces(includePrivate);
  for (const iface of interfaces) {
    ips.push(...iface.ipv4);
    ips.push(...iface.ipv6);
  }

  // Try to get public IPs
  try {
    const publicIPs = await getPublicIPs();
    if (publicIPs.ipv4 && !ips.includes(publicIPs.ipv4)) {
      ips.push(publicIPs.ipv4);
    }
    if (publicIPs.ipv6 && !ips.includes(publicIPs.ipv6)) {
      ips.push(publicIPs.ipv6);
    }
  } catch (error) {
    console.error('Error getting public IPs:', error);
  }

  // Return unique IPs
  return [...new Set(ips)];
}

/**
 * Test connection to common email providers' SMTP servers on port 25
 * @returns Results of connection tests
 */
export interface SmtpConnectionResult {
  host: string;
  success: boolean;
  error?: string;
  responseTime?: number; // in ms
}

export async function testSmtpConnections(
  providers: string[] = [
    'smtp.gmail.com',
    'smtp.mail.yahoo.com',
    'smtp-mail.outlook.com',
    'smtp.office365.com',
    'smtp.zoho.com',
  ]
): Promise<SmtpConnectionResult[]> {
  const results: SmtpConnectionResult[] = [];
  const port = 25;

  // Using native Node.js net module for raw TCP connections
  const net = await import('net');

  const testConnection = (host: string): Promise<SmtpConnectionResult> => {
    return new Promise(resolve => {
      const startTime = Date.now();
      const socket = net.createConnection({ host, port });
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve({
          host,
          success: false,
          error: 'Connection timed out after 5000ms',
        });
      }, 5000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        const responseTime = Date.now() - startTime;
        socket.end();
        resolve({
          host,
          success: true,
          responseTime,
        });
      });

      socket.on('error', err => {
        clearTimeout(timeout);
        resolve({
          host,
          success: false,
          error: err.message,
        });
      });
    });
  };

  // Run tests in parallel
  const connectionPromises = providers.map(provider => testConnection(provider));
  const connectionResults = await Promise.all(connectionPromises);

  return connectionResults;
}
