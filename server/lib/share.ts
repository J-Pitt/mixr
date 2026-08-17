import os from 'node:os';

export function isLanIPv4(address: string, internal: boolean, family: string | number): boolean {
  if (internal) return false;
  const kind = String(family);
  if (kind !== 'IPv4' && kind !== '4') return false;
  if (address.startsWith('169.254.')) return false;
  return true;
}

/** IPv4 addresses other machines on the LAN can use to reach this process. */
export function lanAddresses(): string[] {
  const found: string[] = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      if (!isLanIPv4(net.address, net.internal, net.family)) continue;
      if (!found.includes(net.address)) found.push(net.address);
    }
  }
  return found;
}

export function shareUrls(port: number, listeningOnLan: boolean): {
  localUrl: string;
  lanUrls: string[];
  shareUrl: string;
  listeningOnLan: boolean;
} {
  const localUrl = `http://127.0.0.1:${port}`;
  const lanUrls = lanAddresses().map((address) => `http://${address}:${port}`);
  return {
    localUrl,
    lanUrls,
    shareUrl: lanUrls[0] ?? localUrl,
    listeningOnLan,
  };
}
