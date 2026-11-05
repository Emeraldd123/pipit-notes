#!/usr/bin/env node
// Pipit Notes laptop relay: lets your own Tailscale devices reach Ollama.
// Tailscale serve forwards requests addressed to <laptop>.ts.net; Ollama only answers requests addressed to
// localhost (a guard against websites attacking it). This passes each request on unchanged except that it is
// addressed to localhost. It listens on 127.0.0.1 only, so nothing on the Wi-Fi can reach it; only
// `tailscale serve` (tailnet-only) does.
import http from "node:http";
const TARGET = { host: "127.0.0.1", port: 11434 }, PORT = 11435;
http.createServer((req, res) => {
  const up = http.request({ ...TARGET, method: req.method, path: req.url, headers: { ...req.headers, host: `localhost:${TARGET.port}` } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" }); res.end("Ollama isn't running on the laptop."); });
  req.pipe(up);
}).listen(PORT, "127.0.0.1", () => console.log(`relay on 127.0.0.1:${PORT} -> Ollama`));
