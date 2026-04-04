'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

/**
 * DatabaseService manages SQLite persistence for OpenCams.
 * Includes cameras table and settings table.
 */
class DatabaseService {
  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'opencams.sqlite');
    this.db = new Database(this.dbPath);
    this._initSchema();
  }

  _initSchema() {
    // Cameras table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cameras (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        group_name TEXT,
        rtsp_url TEXT NOT NULL,
        username TEXT,
        password TEXT,
        transport TEXT DEFAULT 'tcp',
        codec TEXT DEFAULT 'h264',
        reconnect_interval INTEGER DEFAULT 5,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Settings table (key-value store)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Default settings if empty
    this._setDefaultSettings();
  }

  _setDefaultSettings() {
    const defaults = {
      gridColumns: '2',
      snapshotDir: path.join(app.getPath('pictures'), 'OpenCams'),
      webServerEnabled: '0',
      webServerPort: '2323'
    };

    const insert = this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(defaults)) {
      insert.run(key, value);
    }
  }

  // --- Cameras ---

  getAllCameras() {
    const rows = this.db.prepare('SELECT * FROM cameras ORDER BY created_at DESC').all();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      group: row.group_name,
      rtspUrl: row.rtsp_url,
      username: row.username,
      password: row.password,
      transport: row.transport,
      codec: row.codec,
      reconnectInterval: row.reconnect_interval,
      enabled: row.enabled === 1
    }));
  }

  saveCamera(camera) {
    const upsert = this.db.prepare(`
      INSERT INTO cameras (id, name, group_name, rtsp_url, username, password, transport, codec, reconnect_interval, enabled)
      VALUES (@id, @name, @group, @rtspUrl, @username, @password, @transport, @codec, @reconnectInterval, @enabled)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        group_name=excluded.group_name,
        rtsp_url=excluded.rtsp_url,
        username=excluded.username,
        password=excluded.password,
        transport=excluded.transport,
        codec=excluded.codec,
        reconnect_interval=excluded.reconnect_interval,
        enabled=excluded.enabled
    `);
    upsert.run({ ...camera, enabled: camera.enabled ? 1 : 0 });
  }

  deleteCamera(id) {
    this.db.prepare('DELETE FROM cameras WHERE id = ?').run(id);
  }

  // --- Settings ---

  getSettings() {
    const rows = this.db.prepare('SELECT * FROM settings').all();
    const settings = {};
    rows.forEach(row => {
      let val = row.value;
      if (row.key === 'gridColumns' || row.key === 'webServerPort') val = parseInt(val, 10);
      if (row.key === 'webServerEnabled') val = val === '1';
      settings[row.key] = val;
    });
    return settings;
  }

  saveSettings(settings) {
    const update = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(settings)) {
      update.run(key, value.toString());
    }
  }

  // --- Maintenance ---

  async exportDump(targetPath) {
    const data = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      cameras: this.getAllCameras(),
      settings: this.getSettings()
    };
    fs.writeFileSync(targetPath, JSON.stringify(data, null, 2));
    return targetPath;
  }

  async importDump(sourcePath) {
    const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    
    this.db.transaction(() => {
      // Import settings
      if (data.settings) this.saveSettings(data.settings);
      
      // Import cameras
      if (data.cameras) {
        data.cameras.forEach(cam => this.saveCamera(cam));
      }
    })();
  }

  async reset() {
    this.db.prepare('DELETE FROM cameras').run();
    this.db.prepare('DELETE FROM settings').run();
    this._setDefaultSettings();
  }
}

module.exports = { DatabaseService };
