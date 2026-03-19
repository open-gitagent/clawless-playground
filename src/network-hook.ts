// ─── Container-side network hook ─────────────────────────────────────────────
// Exported as a string constant, mounted into the WebContainer as network-hook.cjs
// and loaded via NODE_OPTIONS=--require ./network-hook.cjs.
// Patches Node.js http/https/fetch to emit __NET_AUDIT__ markers on stderr.

export const NETWORK_HOOK_CJS = `'use strict';
// ── network-hook.cjs ── injected via NODE_OPTIONS=--require ──

// Skip logging when running inside npm to avoid flooding with registry requests
if (process.env.npm_execpath || process.env.npm_lifecycle_event) {
  return;
}

(function () {
  var MARKER = '__NET_AUDIT__:';

  function maskVal(v) {
    if (!v || typeof v !== 'string') return '****';
    if (v.length <= 12) return '****';
    return v.slice(0, 7) + '...' + v.slice(-4);
  }

  var SENSITIVE = /^(authorization|x-api-key|api-key|x-goog-api-key)$/i;
  var SENSITIVE_PARTIAL = /secret|token/i;

  function maskHeaders(h) {
    if (!h || typeof h !== 'object') return {};
    var out = {};
    var keys = Object.keys(h);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = typeof h[k] === 'string' ? h[k] : String(h[k]);
      if (SENSITIVE.test(k) || SENSITIVE_PARTIAL.test(k)) {
        out[k] = maskVal(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function emit(obj) {
    try {
      process.stderr.write(MARKER + JSON.stringify(obj) + '\\n');
    } catch (_) {
      // never crash the host process
    }
  }

  function buildUrl(opts) {
    if (typeof opts === 'string') return opts;
    if (opts && opts.href) return opts.href;
    if (!opts) return '<unknown>';
    var proto = opts.protocol || 'https:';
    var host = opts.hostname || opts.host || 'localhost';
    var port = opts.port ? ':' + opts.port : '';
    var path = opts.path || '/';
    return proto + '//' + host + port + path;
  }

  var BODY_MAX = 2000;

  // ── Patch http/https ──

  function patchModule(modName) {
    try {
      var mod = require(modName);
    } catch (_) {
      return;
    }

    var origRequest = mod.request;
    var origGet = mod.get;

    function wrapRequest(orig) {
      return function patchedRequest(urlOrOpts, optsOrCb, maybeCb) {
        var opts, cb;
        if (typeof urlOrOpts === 'string' || (urlOrOpts && typeof urlOrOpts.href === 'string')) {
          opts = typeof optsOrCb === 'object' ? optsOrCb : {};
          cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
        } else {
          opts = urlOrOpts || {};
          cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
        }

        var url = buildUrl(urlOrOpts) !== '<unknown>' ? buildUrl(urlOrOpts) : buildUrl(opts);
        var method = (opts.method || 'GET').toUpperCase();
        var hdrs = opts.headers ? maskHeaders(opts.headers) : {};
        var startTime = Date.now();

        emit({
          type: 'request',
          url: url,
          method: method,
          headers: hdrs,
          ts: new Date().toISOString(),
        });

        var req = orig.apply(this, arguments);

        // Capture request body
        var bodyChunks = [];
        var bodyLen = 0;
        var origWrite = req.write;
        var origEnd = req.end;

        req.write = function (chunk) {
          if (bodyLen < BODY_MAX && chunk) {
            var s = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
            bodyChunks.push(s.slice(0, BODY_MAX - bodyLen));
            bodyLen += s.length;
          }
          return origWrite.apply(req, arguments);
        };

        req.end = function (chunk) {
          if (bodyLen < BODY_MAX && chunk && typeof chunk !== 'function') {
            var s = typeof chunk === 'string' ? chunk : (Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : '');
            if (s) {
              bodyChunks.push(s.slice(0, BODY_MAX - bodyLen));
              bodyLen += s.length;
            }
          }

          if (bodyChunks.length > 0) {
            var body = bodyChunks.join('');
            emit({
              type: 'request.body',
              url: url,
              method: method,
              bodyPreview: body.length > BODY_MAX ? body.slice(0, BODY_MAX) + '...[truncated]' : body,
              ts: new Date().toISOString(),
            });
          }

          return origEnd.apply(req, arguments);
        };

        // Capture response
        req.on('response', function (res) {
          var durationMs = Date.now() - startTime;
          emit({
            type: 'response',
            url: url,
            method: method,
            status: res.statusCode,
            headers: maskHeaders(res.headers),
            durationMs: durationMs,
            ts: new Date().toISOString(),
          });
        });

        req.on('error', function (err) {
          var durationMs = Date.now() - startTime;
          emit({
            type: 'response',
            url: url,
            method: method,
            error: err.message,
            durationMs: durationMs,
            ts: new Date().toISOString(),
          });
        });

        return req;
      };
    }

    mod.request = wrapRequest(origRequest);
    mod.get = wrapRequest(origGet);
  }

  patchModule('http');
  patchModule('https');

  // ── Patch globalThis.fetch (Node 18+) ──

  if (typeof globalThis.fetch === 'function') {
    var origFetch = globalThis.fetch;

    globalThis.fetch = function patchedFetch(input, init) {
      var url = typeof input === 'string' ? input
        : (input && input.url) ? input.url
        : String(input);
      var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

      var rawHeaders = {};
      var hdrSrc = (init && init.headers) || (input && input.headers);
      if (hdrSrc && typeof hdrSrc === 'object') {
        if (typeof hdrSrc.forEach === 'function') {
          hdrSrc.forEach(function (v, k) { rawHeaders[k] = v; });
        } else {
          var keys = Object.keys(hdrSrc);
          for (var i = 0; i < keys.length; i++) rawHeaders[keys[i]] = String(hdrSrc[keys[i]]);
        }
      }

      var bodyPreview;
      var bodySrc = (init && init.body) || (input && input.body);
      if (typeof bodySrc === 'string') {
        bodyPreview = bodySrc.length > BODY_MAX ? bodySrc.slice(0, BODY_MAX) + '...[truncated]' : bodySrc;
      }

      var startTime = Date.now();

      emit({
        type: 'request',
        url: url,
        method: method,
        headers: maskHeaders(rawHeaders),
        bodyPreview: bodyPreview,
        ts: new Date().toISOString(),
      });

      return origFetch.apply(globalThis, arguments).then(function (resp) {
        var durationMs = Date.now() - startTime;
        var respHeaders = {};
        if (resp.headers && typeof resp.headers.forEach === 'function') {
          resp.headers.forEach(function (v, k) { respHeaders[k] = v; });
        }

        emit({
          type: 'response',
          url: url,
          method: method,
          status: resp.status,
          headers: respHeaders,
          durationMs: durationMs,
          ts: new Date().toISOString(),
        });

        return resp;
      }, function (err) {
        var durationMs = Date.now() - startTime;
        emit({
          type: 'response',
          url: url,
          method: method,
          error: err.message,
          durationMs: durationMs,
          ts: new Date().toISOString(),
        });
        throw err;
      });
    };
  }
})();
`;
