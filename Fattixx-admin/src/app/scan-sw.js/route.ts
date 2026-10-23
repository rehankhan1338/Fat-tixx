import { readFile } from "node:fs/promises";

// The check-in scanner's service worker (the public site's public/scan-sw.js, plan 8.2): the console has no public/
// folder, so it serves the same file here. Without it the scanner page can't reopen offline when staff open it from
// the console.
export const dynamic = "force-static";

export async function GET() {
  const js = await readFile(new URL("../../../../Fattixx-web/public/scan-sw.js", import.meta.url), "utf8");
  return new Response(js, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
}
