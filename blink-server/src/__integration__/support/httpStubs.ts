/**
 * The only stubs in the integration suite: outbound HTTP to Expo Push and
 * Twilio, intercepted at `fetch`. Everything above that boundary (route,
 * service, SQL) runs for real. Any other non-local host throws, so a test
 * can never reach the network by accident.
 */

export interface StubbedRequest {
  url: string;
  body: unknown;
}

export const pushRequests: StubbedRequest[] = [];
export const smsRequests: StubbedRequest[] = [];

const realFetch = globalThis.fetch;

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const stubFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input);
  const { hostname, pathname } = new URL(url);

  if (hostname === 'exp.host') {
    const body = parseBody(init?.body);
    pushRequests.push({ url, body });
    if (pathname.endsWith('/getReceipts')) return json({ data: {} });
    // Expo answers a single message with one ticket and a batch with an array.
    const ticket = (i: number) => ({ status: 'ok', id: `stub-ticket-${pushRequests.length}-${i}` });
    return json({ data: Array.isArray(body) ? body.map((_, i) => ticket(i)) : ticket(0) });
  }

  if (hostname === 'api.twilio.com') {
    smsRequests.push({ url, body: init?.body?.toString() });
    return json({ sid: `SMstub${smsRequests.length}` }, 201);
  }

  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return realFetch(input, init);
  }

  throw new Error(`Integration tests must not reach the network (blocked fetch to ${url})`);
};

export function installHttpStubs(): void {
  globalThis.fetch = stubFetch;
}

export function resetHttpStubs(): void {
  pushRequests.length = 0;
  smsRequests.length = 0;
}

export function uninstallHttpStubs(): void {
  globalThis.fetch = realFetch;
}
