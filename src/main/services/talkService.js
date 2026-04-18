'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

let FFMPEG_PATH = require('ffmpeg-static');
if (FFMPEG_PATH && FFMPEG_PATH.includes('app.asar')) {
  FFMPEG_PATH = FFMPEG_PATH.replace('app.asar', 'app.asar.unpacked');
}
FFMPEG_PATH = process.env.FFMPEG_PATH || FFMPEG_PATH;

/**
 * TalkService manages pushing audio data to RTSP cameras (Backchannel).
 */
class TalkService extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, any>} */
    this._sessions = new Map();
  }

  /**
   * Starts a talk session for a camera.
   * @param {import('./cameraService').Camera} camera
   */
  start(camera) {
    if (this._sessions.has(camera.id)) {
      this.stop(camera.id);
    }

    const url = this._buildRtspUrl(camera);

    // We use -f rtsp and backchannel=1 (common for many cameras via FFmpeg)
    // Most cameras expect G.711 alaw or ulaw at 8000Hz mono.
    // We'll accept raw PCM s16le 16000Hz or 8000Hz from renderer and transcode.
    const args = [
      '-loglevel', 'info',
      '-f', 's16le',
      '-ar', '16000',
      '-ac', '1',
      '-i', 'pipe:0',
      '-vn',
      '-acodec', 'pcm_alaw', // Many cameras prefer G.711 alaw
      '-ar', '8000',
      '-ac', '1',
      '-f', 'rtsp',
      '-rtsp_transport', camera.transport || 'tcp',
      '-rtsp_flags', '+prefer_tcp',
      `${url}?backchannel=1`
    ];

    console.log(`[TalkService] Spawning FFmpeg for camera ${camera.id}:`, args.join(' '));

    const proc = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'ignore', 'pipe'] });

    const session = {
      process: proc,
      cameraId: camera.id
    };

    proc.stderr.on('data', (data) => {
      console.warn(`[TalkService][${camera.id}] FFmpeg: ${data.toString()}`);
    });

    proc.on('close', (code) => {
      console.log(`[TalkService] FFmpeg talk session closed for camera ${camera.id} with code ${code}`);
      this._sessions.delete(camera.id);
    });

    this._sessions.set(camera.id, session);
  }

  /**
   * Pushes a chunk of raw PCM audio data to the FFmpeg process.
   * @param {string} cameraId
   * @param {Buffer} buffer
   */
  sendAudio(cameraId, buffer) {
    const session = this._sessions.get(cameraId);
    if (session && session.process && session.process.stdin.writable) {
      session.process.stdin.write(buffer);
    }
  }

  /**
   * Stops a talk session.
   * @param {string} cameraId
   */
  stop(cameraId) {
    const session = this._sessions.get(cameraId);
    if (session) {
      if (session.process) {
        session.process.stdin.end();
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

module.exports = { TalkService };
