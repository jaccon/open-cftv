'use strict';

const net = require('net');
const os = require('os');
const { EventEmitter } = require('events');

/**
 * @typedef {Object} ProbeResult
 * @property {string}  ip
 * @property {number}  port
 * @property {string}  path
 * @property {string}  url
 * @property {boolean} reachable
 * @property {string}  status   - 'open'|'timeout'|'refused'
 * @property {number}  latencyMs
 */

/** Common RTSP paths to probe on discovered hosts */
const RTSP_PATHS = [
  '/stream',
  '/stream1',
  '/live',
  '/live/ch00_0',
  '/live.sdp',
  '/h264/ch1/main/av_stream',
  '/h264/ch01/main/av_stream',
  '/onvif1',
  '/onvif/media/video',
  '/cam/realmonitor?channel=1&subtype=0',
  '/axis-media/media.amp',
  '/mpeg4/media.amp',
  '/MediaInput/h264',
  '/video1',
  '/video.h264',
  '/ch0_0.h264',
  '/11',
  '/12',
];

const RTSP_PORT = 554;
const CONCURRENT_SCANS = 50;
const CONNECT_TIMEOUT_MS = 800;

/**
 * ProbeService scans a local subnet for open RTSP port 554,
 * then probes known RTSP paths and emits progress events.
 *
 * Events:
 *   'progress'  – { scanned, total, ip, status }
 *   'found'     – ProbeResult
 *   'done'      – { found: ProbeResult[] }
 *   'cancelled' – {}
 */
class ProbeService extends EventEmitter {
  constructor() {
    super();
    this._cancelled = false;
  }

  /**
   * Starts a subnet scan. Resolves when scan is complete or cancelled.
   * @param {string} [subnet]  e.g. '192.168.1' — auto-detected if omitted
   * @returns {Promise<{ found: ProbeResult[] }>}
   */
  async scan(subnet) {
    this._cancelled = false;
    const base = subnet || this._detectSubnet();
    const ips = this._generateIps(base);
    const total = ips.length;
    let scanned = 0;
    const found = [];

    this.emit('progress', { scanned: 0, total, phase: 'scanning', message: `Scanning ${base}.0/24…` });

    // Phase 1: port scan with concurrency throttle
    const openHosts = [];
    await this._throttle(ips, CONCURRENT_SCANS, async (ip) => {
      if (this._cancelled) return;
      const result = await this._checkPort(ip, RTSP_PORT);
      scanned++;
      this.emit('progress', { scanned, total, phase: 'scanning', ip, status: result.status });
      if (result.status === 'open') {
        openHosts.push({ ip, latencyMs: result.latencyMs });
        this.emit('progress', {
          scanned, total, phase: 'scanning', ip, status: 'open',
          message: `Port 554 open on ${ip} (${result.latencyMs}ms)`,
        });
      }
    });

    if (this._cancelled) {
      this.emit('cancelled', {});
      return { found };
    }

    // Phase 2: probe RTSP paths on open hosts
    const probeTotal = openHosts.length * RTSP_PATHS.length;
    let probed = 0;

    this.emit('progress', {
      scanned: 0, total: probeTotal, phase: 'probing',
      message: `Probing ${openHosts.length} host(s) with ${RTSP_PATHS.length} paths…`,
    });

    for (const { ip, latencyMs } of openHosts) {
      if (this._cancelled) break;

      for (const rtspPath of RTSP_PATHS) {
        if (this._cancelled) break;

        probed++;
        const url = `rtsp://${ip}:${RTSP_PORT}${rtspPath}`;
        const result = {
          ip,
          port: RTSP_PORT,
          path: rtspPath,
          url,
          reachable: true,
          status: 'open',
          latencyMs,
        };

        found.push(result);
        this.emit('found', result);
        this.emit('progress', {
          scanned: probed, total: probeTotal, phase: 'probing', ip,
          message: `Found: ${url}`,
        });

        // Small delay to avoid flooding
        await this._sleep(10);
      }
    }

    if (this._cancelled) {
      this.emit('cancelled', {});
    } else {
      this.emit('done', { found });
    }

    return { found };
  }

  /**
   * Cancels an in-progress scan.
   */
  cancel() {
    this._cancelled = true;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Attempts a TCP connection to host:port and measures latency.
   * @private
   */
  _checkPort(host, port) {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(CONNECT_TIMEOUT_MS);

      const cleanup = (status) => {
        socket.destroy();
        resolve({ status, latencyMs: Date.now() - start });
      };

      socket.connect(port, host, () => cleanup('open'));
      socket.on('timeout', () => cleanup('timeout'));
      socket.on('error', (err) => cleanup(err.code === 'ECONNREFUSED' ? 'refused' : 'timeout'));
    });
  }

  /**
   * Runs async tasks with a maximum concurrency.
   * @private
   */
  async _throttle(items, concurrency, fn) {
    const chunks = [];
    for (let i = 0; i < items.length; i += concurrency) {
      chunks.push(items.slice(i, i + concurrency));
    }
    for (const chunk of chunks) {
      if (this._cancelled) break;
      await Promise.all(chunk.map(fn));
    }
  }

  /**
   * Auto-detects the primary local subnet (e.g. '192.168.1').
   * @private
   */
  _detectSubnet() {
    const ifaces = os.networkInterfaces();
    for (const iface of Object.values(ifaces)) {
      for (const info of iface) {
        if (info.family === 'IPv4' && !info.internal) {
          const parts = info.address.split('.');
          return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
      }
    }
    return '192.168.1';
  }

  /**
   * Generates the 1–254 host addresses for a /24 subnet base.
   * @private
   */
  _generateIps(base) {
    return Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
  }

  /** @private */
  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = { ProbeService };
