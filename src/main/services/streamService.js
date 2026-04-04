'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const os = require('os');

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const SNAPSHOT_DIR = path.join(os.tmpdir(), 'rtsp-manager-snapshots');

/**
 * @typedef {'idle'|'connecting'|'streaming'|'error'|'stopped'} StreamStatus
 */

/**
 * @typedef {Object} StreamSession
 * @property {string}         cameraId
 * @property {ChildProcess}   process
 * @property {StreamStatus}   status
 * @property {number}         startedAt   - Unix timestamp ms
 * @property {number}         frames      - Frame counter
 * @property {string|null}    lastError
 * @property {NodeJS.Timeout} reconnectTimer
 */

/**
 * StreamService manages FFmpeg child processes for each camera.
 * It pipes MJPEG frames to the renderer via IPC events.
 * It emits 'frame' events whenever a new JPEG frame is decoded.
 */
class StreamService extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, StreamSession>} */
    this._sessions = new Map();
    this._ensureSnapshotDir();
  }

  /**
   * Creates and starts an FFmpeg MJPEG pipe for a camera.
   * @param {import('./cameraService').Camera} camera
   * @param {Electron.BrowserWindow} win - window to send frames to
   * @returns {{ status: StreamStatus }}
   */
  async start(camera, win) {
    this.stop(camera.id);

    const session = {
      cameraId: camera.id,
      process: null,
      status: 'connecting',
      startedAt: Date.now(),
      frames: 0,
      lastError: null,
      reconnectTimer: null,
    };

    this._sessions.set(camera.id, session);
    this._sendStatus(win, camera.id, 'connecting');

    this._launchProcess(camera, session, win);
    return { status: session.status };
  }

  /**
   * Stops the FFmpeg process for a given camera.
   * @param {string} cameraId
   */
  stop(cameraId) {
    const session = this._sessions.get(cameraId);
    if (!session) return;

    clearTimeout(session.reconnectTimer);

    if (session.process) {
      session.process.removeAllListeners();
      session.process.kill('SIGKILL');
      session.process = null;
    }

    session.status = 'stopped';
    this._sessions.delete(cameraId);
  }

  /**
   * Stops all active streaming sessions.
   */
  stopAll() {
    for (const id of this._sessions.keys()) {
      this.stop(id);
    }
  }

  /**
   * Returns the current status of a camera stream.
   * @param {string} cameraId
   * @returns {{ status: StreamStatus, frames: number, uptimeMs: number }}
   */
  getStatus(cameraId) {
    const session = this._sessions.get(cameraId);
    if (!session) return { status: 'idle', frames: 0, uptimeMs: 0 };
    return {
      status: session.status,
      frames: session.frames,
      uptimeMs: Date.now() - session.startedAt,
      lastError: session.lastError,
    };
  }

  /**
   * Captures a single JPEG snapshot from the RTSP stream.
   * @param {import('./cameraService').Camera} camera
   * @returns {Promise<string>} base64-encoded JPEG
   */
  async takeSnapshot(camera) {
    return new Promise((resolve, reject) => {
      const outPath = path.join(SNAPSHOT_DIR, `${camera.id}_${Date.now()}.jpg`);
      const url = this._buildRtspUrl(camera);
      const inputArgs = this._buildInputArgs(camera.transport || 'tcp');
      const args = [
        ...inputArgs,
        '-i', url,
        '-frames:v', '1',
        '-vcodec', 'mjpeg',
        '-q:v', '2',
        '-y',
        outPath,
      ];

      const proc = spawn(FFMPEG_PATH, args);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outPath)) {
          const data = fs.readFileSync(outPath).toString('base64');
          fs.unlinkSync(outPath);
          resolve(`data:image/jpeg;base64,${data}`);
        } else {
          reject(new Error(`Snapshot failed: ${stderr.slice(-300)}`));
        }
      });

      setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Snapshot timeout')); }, 15000);
    });
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /**
   * Launches an FFmpeg process that outputs MJPEG to stdout.
   * Handles H.264 and HEVC (H.265) streams over TCP or UDP.
   * @private
   */
  _launchProcess(camera, session, win) {
    if (!this._sessions.has(camera.id)) {
      console.log(`[StreamService] Skipping launch for camera ${camera.id} (no active session)`);
      return;
    }
    const url = this._buildRtspUrl(camera);
    const transport = camera.transport || 'tcp';
    const codec = camera.codec || 'auto';
    const inputArgs = this._buildInputArgs(transport, codec);

    const args = [
      '-loglevel', 'warning',
      ...inputArgs,
      '-i', url,
      '-an',
      '-vcodec', 'mjpeg',   // output: decode any input codec → MJPEG frames
      '-f', 'mjpeg',
      '-q:v', '5',
      '-r', '15',
      'pipe:1',
    ];

    console.log(`[StreamService] Spawning FFmpeg for camera ${camera.id} (${transport}):`, args.join(' '));

    let proc;
    try {
      proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      console.error(`[StreamService] FATAL: Could not spawn FFmpeg at "${FFMPEG_PATH}".`, err.message);
      session.status = 'error';
      session.lastError = `FFmpeg error: ${err.message}`;
      this._sendStatus(win, camera.id, 'error');
      return;
    }
    session.process = proc;

    // Monitor process spawn errors (async)
    proc.on('error', (err) => {
      console.error(`[StreamService] FFmpeg spawn error for ${camera.id}:`, err.message);
      session.status = 'error';
      session.lastError = `Spawn failed: ${err.message}`;
      this._sendStatus(win, camera.id, 'error');
    });

    let buffer = Buffer.alloc(0);
    let firstFrameReceived = false;

    proc.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const frames = this._extractFrames(buffer);

      frames.extracted.forEach((frame) => {
        session.frames++;

        if (!firstFrameReceived) {
          firstFrameReceived = true;
          console.log(`[StreamService] First frame received for camera ${camera.id}`);
        }

        if (session.status !== 'streaming') {
          session.status = 'streaming';
          this._sendStatus(win, camera.id, 'streaming');
        }
        this.emit('frame', camera.id, frame);
      });

      buffer = frames.remainder;
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (!msg) return;
      session.lastError = msg.slice(-300);
      console.warn(`[StreamService][${camera.id}] FFmpeg: ${msg}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('stream:error', camera.id, session.lastError);
      }
    });

    proc.on('close', (code) => {
      if (session.status === 'stopped') return;

      console.log(`[StreamService] FFmpeg closed for camera ${camera.id} with code ${code}`);
      session.status = 'error';
      this._sendStatus(win, camera.id, 'error');

      const interval = (camera.reconnectInterval || 5) * 1000;
      session.retryTimer = setTimeout(() => {
        if (!session.stopped && this._sessions.has(camera.id)) {
          console.log(`[StreamService] Retrying camera ${camera.id} in ${interval / 1000}s...`);
          this._launchProcess(camera, session, win);
        }
      }, interval);
    });
  }

  /**
   * Builds FFmpeg input flags based on transport protocol.
   * UDP streams need extra buffer/delay settings for HEVC.
   * @param {'tcp'|'udp'} transport
   * @returns {string[]}
   * @private
   */
  _buildInputArgs(transport, codec) {
    const base = [
      '-rtsp_transport', transport,
      '-allowed_media_types', 'video',
      '-probesize', '32768',          // probe 32KB (faster stream start)
      '-analyzeduration', '500000',   // 0.5s analysis window
    ];

    if (transport === 'udp') {
      return [
        ...base,
        '-buffer_size', '2048000',  // 2MB UDP receive buffer
        '-max_delay', '500000',   // 500ms max PTS delay
        '-fflags', '+genpts+discardcorrupt',
        '-err_detect', 'ignore_err',
        '-skip_frame', 'noref',    // recover from corrupted ref frames (H.264 UDP)
      ];
    }

    // TCP defaults – genpts for cameras that send broken timestamps
    return [
      ...base,
      '-fflags', '+genpts',
    ];
  }

  /**
   * Extracts complete JPEG frames from a buffer using SOI/EOI markers.
   * @private
   */
  _extractFrames(buffer) {
    const extracted = [];
    let start = buffer.indexOf(Buffer.from([0xff, 0xd8]));

    while (start !== -1) {
      const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end === -1) break;

      extracted.push(buffer.slice(start, end + 2));
      start = buffer.indexOf(Buffer.from([0xff, 0xd8]), end + 2);
    }

    const remainder = start !== -1 ? buffer.slice(start) : Buffer.alloc(0);
    return { extracted, remainder };
  }

  /**
   * Builds the final RTSP URL, injecting credentials if provided.
   * @private
   */
  _buildRtspUrl(camera) {
    if (!camera.username) return camera.rtspUrl;

    try {
      const url = new URL(camera.rtspUrl);
      url.username = encodeURIComponent(camera.username);
      url.password = encodeURIComponent(camera.password || '');
      return url.toString();
    } catch {
      return camera.rtspUrl;
    }
  }

  /**
   * Sends a status event to the renderer.
   * @private
   */
  _sendStatus(win, cameraId, status) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('stream:status', cameraId, status);
    }
  }

  /** @private */
  _ensureSnapshotDir() {
    if (!fs.existsSync(SNAPSHOT_DIR)) {
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    }
  }
}

module.exports = { StreamService };
