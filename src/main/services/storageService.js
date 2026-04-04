'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const DATA_DIR = app ? app.getPath('userData') : path.join(os.homedir(), '.rtsp-manager');
const CAMERAS_FILE = path.join(DATA_DIR, 'cameras.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  theme: 'dark',
  gridColumns: 2,
  snapshotDir: path.join(os.homedir(), 'Pictures', 'RTSPManager'),
  recordingsDir: path.join(os.homedir(), 'Movies', 'RTSPManager'),
  maxConnectedCameras: 16,
};

/**
 * StorageService handles JSON-based persistence for cameras and settings.
 * All files live in Electron's userData directory.
 */
class StorageService {
  /**
   * Creates the userData directory if it doesn't exist.
   */
  async init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Loads persisted cameras from disk.
   * @returns {import('./cameraService').Camera[]}
   */
  loadCameras() {
    return this._readJson(CAMERAS_FILE, []);
  }

  /**
   * Persists the current cameras array to disk.
   * @param {import('./cameraService').Camera[]} cameras
   */
  saveCameras(cameras) {
    this._writeJson(CAMERAS_FILE, cameras);
  }

  /**
   * Returns application settings, merged with defaults.
   * @returns {typeof DEFAULT_SETTINGS}
   */
  getSettings() {
    return { ...DEFAULT_SETTINGS, ...this._readJson(SETTINGS_FILE, {}) };
  }

  /**
   * Persists application settings.
   * @param {Partial<typeof DEFAULT_SETTINGS>} settings
   */
  saveSettings(settings) {
    const current = this.getSettings();
    this._writeJson(SETTINGS_FILE, { ...current, ...settings });
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /** @private */
  _readJson(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return fallback;
    }
  }

  /** @private */
  _writeJson(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error(`[StorageService] Failed to write ${filePath}:`, err.message);
    }
  }
}

module.exports = { StorageService };
