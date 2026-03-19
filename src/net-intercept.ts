// ─── Browser-side fetch interceptor ──────────────────────────────────────────
// Monkey-patches window.fetch to log all outbound requests to the audit log.

import { AuditLog } from './audit.js';

export function installBrowserFetchInterceptor(audit: AuditLog): void {
  const originalFetch = window.fetch;

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const startMs = performance.now();

    // Normalize URL
    let url: string;
    if (input instanceof Request) {
      url = input.url;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = input;
    }

    // Normalize method + headers
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    const rawHeaders: Record<string, string> = {};
    const headerSource = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    if (headerSource instanceof Headers) {
      headerSource.forEach((v, k) => { rawHeaders[k] = v; });
    } else if (headerSource && typeof headerSource === 'object') {
      for (const [k, v] of Object.entries(headerSource)) {
        rawHeaders[k] = String(v);
      }
    }

    // Capture request body
    let bodyPreview: string | undefined;
    const bodySource = init?.body ?? (input instanceof Request ? input.body : undefined);
    if (typeof bodySource === 'string') {
      bodyPreview = AuditLog.truncateBody(bodySource);
    }

    // Log request
    audit.log('net.request', url, {
      origin: 'browser',
      method,
      headers: AuditLog.maskHeaders(rawHeaders),
      ...(bodyPreview ? { bodyPreview } : {}),
    }, { source: 'system' });

    // Call original
    const resp = await originalFetch.call(window, input, init);

    const durationMs = Math.round(performance.now() - startMs);

    // Collect response headers
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => { respHeaders[k] = v; });

    // Log response
    audit.log('net.response', url, {
      origin: 'browser',
      method,
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders,
      durationMs,
    }, { source: 'system' });

    return resp;
  };
}
