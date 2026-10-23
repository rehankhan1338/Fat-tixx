import { audit } from "@/lib/audit";
import { walletTicket } from "@/lib/wallet";
import { appleWalletConfig, buildPkpass } from "@/lib/wallet/apple";

/**
 * GET /t/<code>/wallet/apple?k=<first 12 of the secret> → the ticket as an Apple Wallet pass (.pkpass).
 * Same access rule as the ticket page. The pass holds the live QR credential, so it is never cached.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const cfg = appleWalletConfig();
  if (!cfg) return new Response("Apple Wallet passes are not available.", { status: 404 });
  const { code } = await params;
  const t = await walletTicket(code, new URL(req.url).searchParams.get("k") ?? "");
  if (!t) return new Response("Not found", { status: 404 });
  if (t === "gone") return new Response("This ticket is no longer valid.", { status: 410 });
  let pass: Buffer;
  try {
    pass = buildPkpass(t, cfg);
  } catch (e) {
    console.error("[wallet] Apple pass could not be signed", e);
    return new Response("The Wallet pass could not be created. Use the ticket page or the saved image instead.", { status: 503 });
  }
  await audit("ticket.wallet_pass", { targetType: "ticket", targetId: t.code, metadata: { wallet: "apple" } });
  return new Response(new Uint8Array(pass), {
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="ticket-${t.code}.pkpass"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
