import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';

export interface Fixture {
  url: (path: string) => string;
  port: number;
  hits: Map<string, number>;
  close: () => Promise<void>;
}

const page = (title: string, body = '', head = '') =>
  `<!doctype html><html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;

/** Local site with every redirect pattern the engines must handle. */
export async function startSite(): Promise<Fixture> {
  const hits = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    hits.set(u.pathname, (hits.get(u.pathname) ?? 0) + 1);
    const html = (status: number, content: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      res.end(content);
    };
    const redirect = (status: number, to: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { location: to, ...headers });
      res.end();
    };
    switch (u.pathname) {
      case '/final':
        return html(200, page('Final page', '<p>Landing</p>', '<meta name="viewport" content="width=device-width, initial-scale=1">'));
      case '/chain':
        return redirect(301, '/chain/2');
      case '/chain/2':
        return redirect(302, `http://127.0.0.1:${(server.address() as AddressInfo).port}/chain/3`);
      case '/chain/3':
        return redirect(307, '/final?from=chain');
      case '/loop/a':
        return redirect(302, '/loop/b');
      case '/loop/b':
        return redirect(302, '/loop/a');
      case '/endless':
        return redirect(302, `/endless?n=${Number(u.searchParams.get('n') ?? 0) + 1}`);
      case '/meta':
        return html(200, page('Meta', '', '<meta http-equiv="refresh" content="0; url=/final?from=meta">'));
      case '/js':
        return html(200, page('JS redirect', '<script>setTimeout(function(){ window.location.href = "/final?from=js"; }, 50);</script>'));
      case '/js-delayed':
        return html(200, page('JS delayed', '<script>setTimeout(function(){ location.replace("/final?from=js-delayed"); }, 800);</script>'));
      case '/not-found':
        return html(404, page('Not found'));
      case '/server-error':
        return html(500, page('Oops'));
      case '/cookie-check':
        if ((req.headers.cookie ?? '').includes('seen=1')) return redirect(302, '/final?from=cookie');
        return redirect(302, '/cookie-check', { 'set-cookie': 'seen=1; Path=/; HttpOnly' });
      case '/gzip': {
        const body = zlib.gzipSync(page('Compressed'));
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        return res.end(body);
      }
      case '/slow':
        setTimeout(() => html(200, page('Slow')), 3000);
        return;
      case '/deeplink':
        return redirect(302, 'market://details?id=com.example');
      case '/ua':
        return html(200, page(`UA:${req.headers['user-agent'] ?? ''}`));
      case '/device': {
        const mobile = /Mobile|Android|iPhone/i.test(req.headers['user-agent'] ?? '');
        return mobile ? redirect(302, '/final?site=mobile') : html(200, page('Desktop site'));
      }
      case '/wide':
        return html(200, page('Wide', '<div style="width:2000px;height:50px">wide</div>'));
      default:
        return html(404, page('Unknown'));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    hits,
    url: (p) => `http://127.0.0.1:${port}${p}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export interface ProxyFixture {
  port: number;
  requests: number;
  close: () => Promise<void>;
}

/** Minimal forward HTTP proxy (absolute-form requests + CONNECT) with optional basic auth. */
export async function startHttpProxy(auth?: { user: string; pass: string }): Promise<ProxyFixture> {
  const state = { requests: 0 };
  const expected = auth ? 'Basic ' + Buffer.from(`${auth.user}:${auth.pass}`).toString('base64') : null;
  const server = http.createServer((req, res) => {
    state.requests++;
    if (expected && req.headers['proxy-authorization'] !== expected) {
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="test"' });
      return res.end();
    }
    const target = new URL(req.url!);
    const headers = { ...req.headers };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    const up = http.request(
      { host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers },
      (ur) => {
        res.writeHead(ur.statusCode ?? 502, ur.headers);
        ur.pipe(res);
      },
    );
    up.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  server.on('connect', (req, socket, head) => {
    state.requests++;
    if (expected && req.headers['proxy-authorization'] !== expected) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      return;
    }
    const [host, port] = (req.url ?? '').split(':');
    const up = net.connect(Number(port), host!, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on('error', () => socket.destroy());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as AddressInfo).port,
    get requests() {
      return state.requests;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** Minimal SOCKS5 server (CONNECT only) with optional username/password auth (RFC 1929). */
export async function startSocks5(auth?: { user: string; pass: string }): Promise<ProxyFixture> {
  const state = { requests: 0 };
  const server = net.createServer((client) => {
    let stage: 'greet' | 'auth' | 'request' = 'greet';
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greet') {
        if (buf.length < 2 || buf.length < 2 + buf[1]!) return;
        const methods = [...buf.subarray(2, 2 + buf[1]!)];
        buf = buf.subarray(2 + buf[1]!);
        if (auth) {
          if (!methods.includes(2)) return client.end(Buffer.from([5, 0xff]));
          client.write(Buffer.from([5, 2]));
          stage = 'auth';
        } else {
          client.write(Buffer.from([5, 0]));
          stage = 'request';
        }
      }
      if (stage === 'auth') {
        if (buf.length < 2) return;
        const ulen = buf[1]!;
        if (buf.length < 3 + ulen) return;
        const plen = buf[2 + ulen]!;
        if (buf.length < 3 + ulen + plen) return;
        const user = buf.subarray(2, 2 + ulen).toString();
        const pass = buf.subarray(3 + ulen, 3 + ulen + plen).toString();
        buf = buf.subarray(3 + ulen + plen);
        if (user !== auth!.user || pass !== auth!.pass) return client.end(Buffer.from([1, 1]));
        client.write(Buffer.from([1, 0]));
        stage = 'request';
      }
      if (stage === 'request') {
        if (buf.length < 5) return;
        const atyp = buf[3]!;
        let host: string;
        let off: number;
        if (atyp === 1) {
          if (buf.length < 10) return;
          host = [...buf.subarray(4, 8)].join('.');
          off = 8;
        } else if (atyp === 3) {
          const len = buf[4]!;
          if (buf.length < 5 + len + 2) return;
          host = buf.subarray(5, 5 + len).toString();
          off = 5 + len;
        } else return client.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0]));
        const port = buf.readUInt16BE(off);
        const rest = buf.subarray(off + 2);
        client.off('data', onData);
        state.requests++;
        const up = net.connect(port, host, () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          if (rest.length) up.write(rest);
          up.pipe(client);
          client.pipe(up);
        });
        up.on('error', () => client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
      }
    };
    client.on('data', onData);
    client.on('error', () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as AddressInfo).port,
    get requests() {
      return state.requests;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
