import { audit } from "@/lib/audit";
import { walletTicket } from "@/lib/wallet";
import { googleWalletConfig, googleWalletSaveUrl } from "@/lib/wallet/google";

/**
 * GET /t/<code>/wallet/google?k=<first 12 of the secret> → Google's "Save to Google Wallet" page for the ticket.
 * Same access rule as the ticket page. The link is signed fresh on every click and never cached.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const cfg = googleWalletConfig();
  if (!cfg) return new Response("Google Wallet passes are not available.", { status: 404 });
  const { code } = await params;
  const t = await walletTicket(code, new URL(req.url).searchParams.get("k") ?? "");
  if (!t) return new Response("Not found", { status: 404 });
  if (t === "gone") return new Response("This ticket is no longer valid.", { status: 410 });
  let url: string;
  try {
    url = googleWalletSaveUrl(t, cfg);
  } catch (e) {
    console.error("[wallet] Google pass could not be signed", e);
    return new Response("The Wallet pass could not be created. Use the ticket page or the saved image instead.", { status: 503 });
  }
  await audit("ticket.wallet_pass", { targetType: "ticket", targetId: t.code, metadata: { wallet: "google" } });
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
}
