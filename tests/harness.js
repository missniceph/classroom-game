// Shared test setup: serves the site, runs a private PeerJS server, and routes CDN requests
// to local copies of the libraries (so tests work offline).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { ExpressPeerServer } = require('peer');
const express = require('express');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const LIB = {
  peerjs: require.resolve('peerjs/dist/peerjs.min.js'),
  qrcode: require.resolve('qrcode-generator/qrcode.js'),
};

async function startServers(webPort = 8123, peerPort = 9123) {
  const web = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => web.listen(webPort, '127.0.0.1', r));
  const app = express();
  const peerHttp = await new Promise(r => { const h = app.listen(peerPort, '127.0.0.1', () => r(h)); });
  app.use('/', ExpressPeerServer(peerHttp, { path: '/' }));
  return {
    base: `http://127.0.0.1:${webPort}/`,
    peerParam: `peerserver=127.0.0.1:${peerPort}`,
    close() { web.close(); try { peerHttp.close(); } catch (e) {} },
  };
}

async function launch() {
  return chromium.launch({
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-ui-for-media-stream'],
  });
}

async function newContext(browser, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ acceptDownloads: true }, opts));
  await ctx.route(/cdn\.jsdelivr\.net|unpkg\.com/, (route) => {
    const url = route.request().url();
    const file = url.includes('peerjs') ? LIB.peerjs : url.includes('qrcode') ? LIB.qrcode : null;
    if (!file) return route.abort();
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(file) });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return ctx;
}

module.exports = { startServers, launch, newContext, devices };
