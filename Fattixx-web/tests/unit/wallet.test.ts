/**
 * Apple Wallet / Google Wallet passes: the .pkpass archive (files, SHA-1 manifest, PKCS #7 signature) and the signed
 * "Save to Google Wallet" JWT. Uses throwaway keys generated here; no Apple or Google account, no database.
 */
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { applePassJson, buildPkpass } from "@/lib/wallet/apple";
import { googleWalletPayload, googleWalletSaveUrl } from "@/lib/wallet/google";
import type { WalletTicket } from "@/lib/wallet/ticket";
import { isoWithOffset } from "@/lib/tz";

const ticket: WalletTicket = {
  code: "ABCDEF123456", qrPayload: "FTX1.ABCDEF123456.0123456789abcdef0123456789abcdef.sig", eventId: 42, eventTitle: "Harbor Nights",
  startsAt: new Date("2026-11-14T00:00:00Z"), endsAt: new Date("2026-11-14T04:00:00Z"), doorsAt: new Date("2026-11-13T23:00:00Z"), timezone: "America/New_York",
  venueName: "The Pier", venueAddress: "1 Market St, Charleston, SC", online: false, ticketType: "VIP", seat: null, attendee: "Sam Lee",
  orderCode: "ORD123", orgName: "Lowcountry Live", ageRestriction: 21, ticketUrl: "http://localhost:3000/t/ABCDEF123456?k=0123456789ab",
};

/** Read a stored or deflated ZIP back into name → bytes (enough for what zipStore writes). */
function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("ascii");
    const data = buf.subarray(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size);
    out[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    i += 30 + nameLen + extra + size;
  }
  expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
  return out;
}

function selfSigned(cn: string) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(pubPem);
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: "commonName", value: cn }]);
  cert.setIssuer([{ name: "commonName", value: cn }]);
  cert.sign(forge.pki.privateKeyFromPem(keyPem), forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem, pubPem };
}

describe("wallet passes", () => {
  it("event times keep the event's own time zone and offset", () => {
    expect(isoWithOffset(ticket.startsAt, "America/New_York")).toBe("2026-11-13T19:00:00-05:00");
    expect(isoWithOffset(new Date("2026-07-01T12:30:00Z"), "Asia/Kolkata")).toBe("2026-07-01T18:00:00+05:30");
  });

  it("pass.json: QR is the ticket's signed payload; event, ticket and back fields", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading back loosely typed JSON
    const p = applePassJson(ticket, { passTypeId: "pass.com.fattixx.test", teamId: "ABCDE12345" }) as Record<string, any>;
    expect(p.serialNumber).toBe("ABCDEF123456");
    expect(p.barcodes[0]).toMatchObject({ format: "PKBarcodeFormatQR", message: ticket.qrPayload });
    expect(p.eventTicket.primaryFields[0].value).toBe("Harbor Nights");
    expect(p.relevantDate).toBe("2026-11-13T19:00:00-05:00");
    expect(JSON.stringify(p.eventTicket.backFields)).toContain("21+ event");
  });

  it(".pkpass: every file is in a SHA-1 manifest that is signed with the pass certificate", () => {
    const pass = selfSigned("Pass Type ID: pass.com.fattixx.test");
    const wwdr = selfSigned("Apple Worldwide Developer Relations");
    const pkpass = buildPkpass(ticket, { passTypeId: "pass.com.fattixx.test", teamId: "ABCDE12345", cert: pass.certPem, key: pass.keyPem, passphrase: null, wwdr: wwdr.certPem });
    const files = unzip(pkpass);
    expect(Object.keys(files).sort()).toEqual(["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png", "logo@3x.png", "manifest.json", "pass.json", "signature"]);
    const manifest = JSON.parse(files["manifest.json"].toString("utf8")) as Record<string, string>;
    for (const [name, sha1] of Object.entries(manifest)) expect(createHash("sha1").update(files[name]).digest("hex")).toBe(sha1);
    expect(Object.keys(manifest)).not.toContain("signature");

    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(files.signature.toString("binary")))) as forge.pkcs7.PkcsSignedData & { rawCapture: { signature: string; authenticatedAttributes: forge.asn1.Asn1[] } };
    expect(p7.certificates.map((c) => c.subject.getField("CN").value)).toEqual(["Pass Type ID: pass.com.fattixx.test", "Apple Worldwide Developer Relations"]);
    // The signature covers the authenticated attributes, whose message digest is SHA-256 of manifest.json.
    const attrs = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, p7.rawCapture.authenticatedAttributes);
    const verify = createVerify("RSA-SHA256").update(Buffer.from(forge.asn1.toDer(attrs).getBytes(), "binary"));
    expect(verify.verify(pass.pubPem, Buffer.from(p7.rawCapture.signature, "binary"))).toBe(true);
    const digestAttr = p7.rawCapture.authenticatedAttributes.find((a) => forge.asn1.derToOid((a.value as forge.asn1.Asn1[])[0].value as string) === forge.pki.oids.messageDigest)!;
    const digest = ((digestAttr.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0].value as string;
    expect(Buffer.from(digest, "binary").toString("hex")).toBe(createHash("sha256").update(files["manifest.json"]).digest("hex"));
  });

  it("Google Wallet: class id changes with the event details; ticket object carries the QR", () => {
    const cfg = { issuerId: "3388000000012345678", clientEmail: "wallet@fattixx-test.iam.gserviceaccount.com" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading back loosely typed JSON
    const a = googleWalletPayload(ticket, cfg, "https://fattixx.test") as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading back loosely typed JSON
    const b = googleWalletPayload({ ...ticket, startsAt: new Date("2026-11-15T00:00:00Z") }, cfg, "https://fattixx.test") as any;
    const cls = a.payload.eventTicketClasses[0], obj = a.payload.eventTicketObjects[0];
    expect(cls.id).toMatch(/^3388000000012345678\.fx_event_42_[0-9a-f]{10}$/);
    expect(b.payload.eventTicketClasses[0].id).not.toBe(cls.id);
    expect(obj).toMatchObject({ id: "3388000000012345678.fx_ticket_ABCDEF123456", classId: cls.id, state: "ACTIVE", barcode: { type: "QR_CODE", value: ticket.qrPayload } });
    expect(a).toMatchObject({ aud: "google", typ: "savetowallet", origins: ["https://fattixx.test"] });
    expect(cls.dateTime.start).toBe("2026-11-13T19:00:00-05:00");
  });

  it("Google Wallet: the save link is an RS256 JWT signed with the service account key", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const url = googleWalletSaveUrl(ticket, { issuerId: "3388000000012345678", clientEmail: "w@x.iam.gserviceaccount.com", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
    expect(url.startsWith("https://pay.google.com/gp/v/save/")).toBe(true);
    const [h, p, s] = url.slice("https://pay.google.com/gp/v/save/".length).split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString()).iss).toBe("w@x.iam.gserviceaccount.com");
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
});
