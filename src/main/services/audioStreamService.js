'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

/**
 * AudioStreamService manages one-way audio extraction from RTSP streams.
 */
class AudioStreamService extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, any>} */
    this._sessions = new Map();
  }

  /**
   * Starts an audio-only FFmpeg process.
   * @param {import('./cameraService').Camera} camera
   * @param {Electron.BrowserWindow} win
   */
  start(camera, win) {
    if (this._sessions.has(camera.id)) {
      this.stop(camera.id);
    }

    const url = this._buildRtspUrl(camera);
    const transport = camera.transport || 'tcp';
    
    // Extract mono PCM s16le @ 16kHz
    const args = [
      '-loglevel', 'warning',
      '-rtsp_transport', transport,
      '-i', url,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-f', 's16le',
      '-ar', '16000',
      '-ac', '1',
      'pipe:1'
    ];

    console.log(`[AudioService] Spawning audio pipe for ${camera.id}:`, args.join(' '));

    const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    
    const session = {
      process: proc,
      cameraId: camera.id
    };

    proc.stdout.on('data', (chunk) => {
      // Send raw Int16 bytes to renderer
      if (win && !win.isDestroyed()) {
        win.webContents.send('stream:audio', camera.id, chunk);
      }
    });

    proc.on('close', (code) => {
      console.log(`[AudioService] Audio process for ${camera.id} closed with code ${code}`);
      this._sessions.delete(camera.id);
      if (win && !win.isDestroyed()) {
        win.webContents.send('stream:audio:status', camera.id, 'closed');
      }
    });

    this._sessions.set(camera.id, session);
  }

  stop(cameraId) {
    const session = this._sessions.get(cameraId);
    if (session) {
      if (session.process) {
        session.process.kill('SIGKILL');
      }
      this._sessions.delete(cameraId);
    }
  }

  stopAll() {
    for (const id of this._sessions.keys()) {
      this.stop(id);
    }
  }

  /** @private */
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
}

module.exports = { AudioStreamService };
