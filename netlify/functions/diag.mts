// Netlify Function (v2) endpoint for diagnostics reports. Storage is Netlify Blobs,
// which needs no configuration when running on Netlify. See ../lib/diag-handler.mjs.
import { getStore } from "@netlify/blobs";
import { handleDiag } from "../lib/diag-handler.mjs";

export default async (req: Request): Promise<Response> => {
  const res = await handleDiag(
    { method: req.method, url: req.url, header: (n: string) => req.headers.get(n), text: () => req.text() },
    getStore("diagnostics"),
    { DIAG_READ_TOKEN: process.env.DIAG_READ_TOKEN }
  );
  return new Response(res.body || null, { status: res.status, headers: res.headers });
};
