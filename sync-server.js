/* =====================================================================
 * 妈妈工作台 · 实时同步服务端（零依赖，仅用 Node 内置模块）
 * ---------------------------------------------------------------------
 * 一个进程同时提供：
 *   1) 静态站点托管（index.html / styles.css / app.js ...）
 *   2) 同步接口  GET  /api/db   -> 拉取数据
 *                PUT  /api/db   -> 上传数据（写入后向所有在线设备推送）
 *   3) 实时推送  GET  /api/stream -> SSE 长连接，任意设备改动即通知其他设备
 *
 * 部署：把整个 mama-hub 目录丢到任意 Node 主机（Render / Railway / 自己的服务器），
 *       启动命令 `node sync-server.js` 即可，手机和电脑打开同一个网址就能实时同步。
 * ===================================================================== */

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = path.join(__dirname, 'hub-data.json');
// 设置环境变量 SYNC_KEY 后，所有读写都需要带 ?key= 或 X-Sync-Key 头
const SYNC_KEY = process.env.SYNC_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

let dbRaw = '{}';
try { dbRaw = fs.readFileSync(DATA_FILE, 'utf8') || '{}'; JSON.parse(dbRaw); }
catch (e) { dbRaw = '{}'; }

const sseClients = new Set();

function readDB() { return dbRaw; }
function writeDB(json) {
  dbRaw = json;
  try { fs.writeFileSync(DATA_FILE, json); } catch (e) { console.warn('写盘失败', e.message); }
  // 广播给所有正在监听的浏览器（实时同步核心）
  const msg = 'data: ' + Date.now() + '\n\n';
  sseClients.forEach(res => { try { res.write(msg); } catch (e) {} });
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Key'
  });
  res.end(body);
}

function checkKey(req, url) {
  if (!SYNC_KEY) return true;
  const q = url.searchParams.get('key') || req.headers['x-sync-key'] || '';
  return q === SYNC_KEY;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // 预检
  if (req.method === 'OPTIONS') { send(res, 204, ''); return; }

  // SSE 实时流
  if (p === '/api/stream') {
    if (!checkKey(req, url)) { send(res, 401, 'unauthorized'); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // 同步接口
  if (p === '/api/db') {
    if (!checkKey(req, url)) { send(res, 401, 'unauthorized'); return; }
    if (req.method === 'GET') {
      send(res, 200, readDB());
      return;
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try { JSON.parse(body); } catch (e) { send(res, 400, '{"ok":false,"error":"bad json"}'); return; }
        writeDB(body);
        send(res, 200, '{"ok":true}');
      });
      return;
    }
    send(res, 405, '{"ok":false,"error":"method not allowed"}');
    return;
  }

  // 健康检查（仅 /health，避免占用根路径）
  if (p === '/health') {
    send(res, 200, '{"status":"ok","service":"mama-hub-sync","clients":' + sseClients.size + '}', 'application/json; charset=utf-8');
    return;
  }

  // 静态文件托管
  let rel = decodeURIComponent(p);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(__dirname, path.normalize(rel));
  if (!filePath.startsWith(__dirname)) { send(res, 403, 'forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { send(res, 404, 'not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log('🌸 妈妈工作台已启动: http://' + HOST + ':' + PORT);
  console.log('   同步接口: /api/db  实时流: /api/stream' + (SYNC_KEY ? '  (已启用密钥)' : ''));
});
