import 'server-only';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import forge from 'node-forge';
import { isoWithOffset } from '../tz';
import { zipStore } from './zip';
import { doorsText, pemFromEnv, venueText, whenText, type WalletTicket } from './ticket';

/**
 * Apple Wallet passes (.pkpass). Needs, from the Apple Developer account (Certificates, Identifiers & Profiles):
 *   APPLE_WALLET_PASS_TYPE_ID   the Pass Type ID, e.g. pass.com.fattixx.ticket
 *   APPLE_WALLET_TEAM_ID        the 10-character Team ID
 *   APPLE_WALLET_CERT           the Pass Type ID certificate (PEM, or base64 of the PEM)
 *   APPLE_WALLET_KEY            its private key (PEM, or base64 of the PEM)
 *   APPLE_WALLET_KEY_PASSPHRASE the key's passphrase, when it has one
 *   APPLE_WALLET_WWDR           Apple's WWDR intermediate certificate, G4 (PEM, or base64 of the PEM)
 * The button is hidden until all of them are set.
 */
export interface AppleWalletConfig { passTypeId: string; teamId: string; cert: string; key: string; passphrase: string | null; wwdr: string }

export function appleWalletConfig(): AppleWalletConfig | null {
  const passTypeId = process.env.APPLE_WALLET_PASS_TYPE_ID?.trim();
  const teamId = process.env.APPLE_WALLET_TEAM_ID?.trim();
  const cert = pemFromEnv(process.env.APPLE_WALLET_CERT);
  const key = pemFromEnv(process.env.APPLE_WALLET_KEY);
  const wwdr = pemFromEnv(process.env.APPLE_WALLET_WWDR);
  if (!passTypeId || !teamId || !cert || !key || !wwdr) return null;
  return { passTypeId, teamId, cert, key, wwdr, passphrase: process.env.APPLE_WALLET_KEY_PASSPHRASE || null };
}

/** pass.json. Colors are the site's: ivory background, red text. */
export function applePassJson(t: WalletTicket, cfg: Pick<AppleWalletConfig, 'passTypeId' | 'teamId'>): Record<string, unknown> {
  const field = (key: string, label: string, value: string | null | undefined) => (value ? [{ key, label, value }] : []);
  const doors = doorsText(t);
  const venue = venueText(t);
  // A day after the event (or its end) the pass greys out in Wallet.
  const expires = new Date((t.endsAt ?? t.startsAt).getTime() + 86_400_000);
  return {
    formatVersion: 1,
    passTypeIdentifier: cfg.passTypeId,
    teamIdentifier: cfg.teamId,
    serialNumber: t.code,
    organizationName: t.orgName,
    description: `Ticket for ${t.eventTitle}`,
    logoText: t.orgName,
    backgroundColor: 'rgb(245, 241, 234)',
    foregroundColor: 'rgb(168, 18, 26)',
    labelColor: 'rgb(200, 32, 26)',
    relevantDate: isoWithOffset(t.startsAt, t.timezone),
    expirationDate: isoWithOffset(expires, t.timezone),
    sharingProhibited: true,
    barcodes: [{ format: 'PKBarcodeFormatQR', message: t.qrPayload, messageEncoding: 'iso-8859-1', altText: t.code }],
    // iOS 8 and older read the single `barcode`.
    barcode: { format: 'PKBarcodeFormatQR', message: t.qrPayload, messageEncoding: 'iso-8859-1', altText: t.code },
    eventTicket: {
      primaryFields: [{ key: 'event', label: 'EVENT', value: t.eventTitle }],
      secondaryFields: [...field('when', 'WHEN', whenText(t)), ...field('doors', 'DOORS', doors)],
      auxiliaryFields: [...field('ticket', 'TICKET', t.ticketType), ...field('seat', 'SEAT', t.seat), ...field('holder', 'ATTENDEE', t.attendee)],
      backFields: [
        ...field('venue', 'Venue', venue),
        ...field('order', 'Order', t.orderCode),
        ...field('code', 'Ticket code', t.code),
        ...field('age', 'Age', t.ageRestriction ? `${t.ageRestriction}+ event. Bring a valid photo ID.` : null),
        { key: 'link', label: 'Your ticket online', value: t.ticketUrl },
        { key: 'scan', label: 'At the door', value: 'One scan per ticket. Turn your screen brightness up.' },
      ],
    },
  };
}

const ASSETS = ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png', 'logo@3x.png'];

/** PKCS #7 detached signature of manifest.json, made with the Pass Type ID certificate and the WWDR intermediate. */
function sign(manifest: Buffer, cfg: AppleWalletConfig): Buffer {
  const cert = forge.pki.certificateFromPem(cfg.cert);
  const wwdr = forge.pki.certificateFromPem(cfg.wwdr);
  const key = cfg.passphrase ? forge.pki.decryptRsaPrivateKey(cfg.key, cfg.passphrase) : forge.pki.privateKeyFromPem(cfg.key);
  if (!key) throw new Error('APPLE_WALLET_KEY could not be read (wrong passphrase?)');
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest.toString('binary'));
  p7.addCertificate(cert);
  p7.addCertificate(wwdr);
  p7.addSigner({
    key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}

/** The .pkpass archive: pass.json, images, manifest.json (SHA-1 of every file, as Wallet requires) and its signature. */
export function buildPkpass(t: WalletTicket, cfg: AppleWalletConfig): Buffer {
  const dir = path.join(process.cwd(), 'content', 'wallet');
  const files = [
    { name: 'pass.json', data: Buffer.from(JSON.stringify(applePassJson(t, cfg)), 'utf8') },
    // White-label passes show only the organizer's name (logoText), not the Fattixx wordmark; the icon is required.
    ...ASSETS.filter((name) => !(t.whiteLabel && name.startsWith('logo'))).map((name) => ({ name, data: fs.readFileSync(path.join(dir, name)) })),
  ];
  const manifest = Buffer.from(JSON.stringify(Object.fromEntries(files.map((f) => [f.name, createHash('sha1').update(f.data).digest('hex')]))), 'utf8');
  return zipStore([...files, { name: 'manifest.json', data: manifest }, { name: 'signature', data: sign(manifest, cfg) }]);
}
