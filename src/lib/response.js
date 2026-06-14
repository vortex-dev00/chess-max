// JSON response helpers shared by every route.

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

export const ok = (data = {}) => json({ ok: true, ...data });
export const error = (message, status = 400) => json({ error: message }, { status });
export const forbidden = () => error("Not allowed.", 403);
export const notFound = () => error("Not found.", 404);
