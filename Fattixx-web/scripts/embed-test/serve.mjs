// Serves the embed test page on a separate origin: node scripts/embed-test/serve.mjs (then open http://localhost:5500)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const port = Number(process.env.PORT) || 5500;
createServer(async (_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(await readFile(new URL("./index.html", import.meta.url)));
}).listen(port, () => console.log(`Embed test page: http://localhost:${port}`));
