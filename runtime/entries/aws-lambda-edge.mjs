import "#internal/nitro/virtual/polyfill";
import { nitroApp } from "../app.mjs";
export const handler = async function handler2(event, context) {
  const request = event.Records[0].cf.request;
  const r = await nitroApp.localCall({
    event,
    url: request.uri,
    context,
    headers: normalizeIncomingHeaders(request.headers),
    method: request.method,
    query: request.querystring,
    body: request.body
  });
  return {
    status: r.status.toString(),
    headers: normalizeOutgoingHeaders(r.headers),
    body: r.body.toString()
  };
};
function normalizeIncomingHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, keyValues]) => [key, keyValues.map((kv) => kv.value)]));
}
function normalizeOutgoingHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, Array.isArray(v) ? v.map((value) => ({ value })) : [{ value: v }]]));
}
