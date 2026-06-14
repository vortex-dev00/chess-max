// Thin fetch wrapper used by every page.

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export const api = {
  get: (url) => request("GET", url).then((r) => r.data),
  post: (url, body) => request("POST", url, body),
  del: (url) => request("DELETE", url),
};
