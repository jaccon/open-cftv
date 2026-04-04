'use strict';

const http = require('http');
const os = require('os');
const { EventEmitter } = require('events');

/**
 * HttpService provides a simple web server to expose camera info or streams.
 * Currently it serves a basic JSON status page, but can be expanded to relay MJPEG.
 */
class HttpService extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.port = 2323;
    this.running = false;
    this.clients = new Map(); // cameraId -> Set<res>
    this.cameras = []; // Reference to active cameras
  }

  /**
   * Updates the list of available cameras for the mosaic.
   */
  setCameras(cameras) {
    this.cameras = cameras;
  }

  /**
   * Broadcasts a frame to all connected web clients for a specific camera.
   */
  broadcastFrame(cameraId, frameBuffer) {
    const clients = this.clients.get(cameraId);
    if (!clients || clients.size === 0) return;

    const boundary = '--boundary\r\n' +
                     'Content-Type: image/jpeg\r\n' +
                     'Content-Length: ' + frameBuffer.length + '\r\n\r\n';
    
    for (const res of clients) {
      try {
        res.write(boundary);
        res.write(frameBuffer);
        res.write('\r\n');
      } catch (err) {
        clients.delete(res);
      }
    }
  }

  /**
   * Starts the HTTP server on the specified port.
   * @param {number} port 
   * @returns {Promise<string>} - The local server URL
   */
  start(port = 2323) {
    return new Promise((resolve, reject) => {
      if (this.running) {
        this.stop().then(() => this.start(port)).then(resolve).catch(reject);
        return;
      }

      this.port = port;
      this.server = http.createServer((req, res) => {
        const url = req.url;

        // Route: Stream endpoint (MJPEG)
        if (url.startsWith('/stream/')) {
          const cameraId = url.split('/')[2];
          res.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace; boundary=boundary',
            'Cache-Control': 'no-cache',
            'Connection': 'close',
            'Pragma': 'no-cache'
          });

          if (!this.clients.has(cameraId)) this.clients.set(cameraId, new Set());
          const clients = this.clients.get(cameraId);
          clients.add(res);

          req.on('close', () => clients.delete(res));
          return;
        }

        // Route: Root (HTML Mosaic)
        if (url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this._generateMosaicHtml());
          return;
        }

        res.writeHead(404);
        res.end();
      });

      this.server.on('error', (err) => {
        this.running = false;
        this.emit('error', err);
        reject(err);
      });

      this.server.listen(this.port, () => {
        this.running = true;
        resolve(`http://${this._getLocalIp()}:${this.port}`);
      });
    });
  }

  _generateMosaicHtml() {
    const cameraCards = this.cameras.map(cam => `
      <div class="card">
        <div class="header">${cam.name} <span class="badge ${cam.enabled ? 'on' : 'off'}"></span></div>
        <div class="stream">
          ${cam.enabled 
            ? `<img src="/stream/${cam.id}" alt="${cam.name}" loading="lazy">` 
            : '<div class="disabled">Stream Disabled</div>'}
        </div>
      </div>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>OpenCams — Live Mosaic</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { background: #0d0d0f; color: #f0f0f3; font-family: sans-serif; margin: 0; padding: 20px; }
          .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px; }
          .card { background: #141417; border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.5); }
          .header { padding: 12px 16px; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); }
          .stream { aspect-ratio: 16/9; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center; }
          .stream img { width: 100%; height: 100%; object-fit: contain; }
          .badge { width: 8px; height: 8px; border-radius: 50%; }
          .on { background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.5); }
          .off { background: #55555f; }
          .disabled { color: #55555f; font-size: 12px; text-transform: uppercase; }
          h1 { font-size: 20px; margin-bottom: 24px; color: #6366f1; }
        </style>
      </head>
      <body>
        <h1>OpenCams — Live Mosaic</h1>
        <div class="grid">${cameraCards || '<p>No cameras found.</p>'}</div>
      </body>
      </html>
    `;
  }

  /**
   * Stops the HTTP server.
   */
  stop() {
    return new Promise((resolve) => {
      if (!this.server || !this.running) {
        resolve();
        return;
      }
      this.clients.clear();
      this.server.close(() => {
        this.running = false;
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * Gets the current server status and URL.
   */
  getStatus() {
    return {
      running: this.running,
      url: this.running ? `http://${this._getLocalIp()}:${this.port}` : null,
      port: this.port
    };
  }

  /** @private */
  _getLocalIp() {
    const { networkInterfaces } = os;
    const ifaces = networkInterfaces();
    for (const iface of Object.values(ifaces)) {
      for (const info of iface) {
        if (info.family === 'IPv4' && !info.internal) return info.address;
      }
    }
    return 'localhost';
  }
}

module.exports = { HttpService };
