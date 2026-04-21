/**
 * Pages Function — proxy /api/* ไปยัง API Worker
 * ตั้งค่า env.API_BASE ใน Pages project settings → Environment variables
 *   ตัวอย่าง: API_BASE = "https://lottery-th-api.YOUR_SUBDOMAIN.workers.dev"
 * หากไม่ได้ตั้งจะคืน 503
 */
export async function onRequest(context) {
  const { request, env } = context;
  const base = env.API_BASE;
  if (!base) {
    return new Response(
      JSON.stringify({ error: "API_BASE not configured on Pages environment" }),
      { status: 503, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }
  const url = new URL(request.url);
  const target = base.replace(/\/$/, "") + url.pathname + url.search;

  const upstream = await fetch(target, {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
  });

  const headers = new Headers(upstream.headers);
  headers.set("x-proxy", "pages-fn");
  return new Response(upstream.body, { status: upstream.status, headers });
}
