'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { CameraService } = require('./services/cameraService');
const { StreamService } = require('./services/streamService');
const { DatabaseService } = require('./services/databaseService');
const { ProbeService } = require('./services/probeService');
const { HttpService } = require('./services/httpService');
const { AudioStreamService } = require('./services/audioStreamService');

// Fix PATH for macOS packaged apps (often missing common brew paths)
if (process.platform === 'darwin') {
  process.env.PATH = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    process.env.PATH
  ].join(path.delimiter);
}

/**
 * Main application class - orchestrates all Electron lifecycle events
 * and wires up IPC handlers for renderer communication.
 */
class Application {
  constructor() {
    this.mainWindow = null;
    this.cameraService = new CameraService();
    this.streamService = new StreamService();
    this.databaseService = new DatabaseService();
    this.probeService = new ProbeService();
    this.httpService = new HttpService();
    this.audioStreamService = new AudioStreamService();
  }

  /**
   * Creates the main BrowserWindow with security and display settings.
   */
  createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 600,
      backgroundColor: '#0d0d0f',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      frame: process.platform !== 'darwin',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
      icon: path.join(__dirname, '../../assets/images/icon.png'),
      show: false,
    });

    this.mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    this.mainWindow.on('closed', () => {
      this.streamService.stopAll();
      this.audioStreamService.stopAll();
      this.mainWindow = null;
    });

    this.mainWindow.webContents.on('render-process-gone', (e, details) => {
      console.error(`[Main] Renderer process gone: ${details.reason} (code: ${details.exitCode})`);
      this.streamService.stopAll();
      this.audioStreamService.stopAll();
    });
  }

  /**
   * Registers all IPC handlers for camera management operations.
   */
  registerIpcHandlers() {
    // Camera CRUD
    ipcMain.handle('camera:getAll', () => this.cameraService.getAll());
    ipcMain.handle('camera:add', (_, cameraData) => this.cameraService.add(cameraData));
    ipcMain.handle('camera:update', (_, id, cameraData) => this.cameraService.update(id, cameraData));
    ipcMain.handle('camera:delete', (_, id) => {
      this.streamService.stop(id);
      return this.cameraService.delete(id);
    });

    // Stream control
    ipcMain.handle('stream:start', async (_, id) => {
      const camera = this.cameraService.getById(id);
      if (!camera) throw new Error(`Camera ${id} not found`);
      return this.streamService.start(camera, this.mainWindow);
    });

    ipcMain.handle('stream:stop', (_, id) => this.streamService.stop(id));
    ipcMain.handle('stream:stopAll', () => this.streamService.stopAll());
    ipcMain.handle('stream:status', (_, id) => this.streamService.getStatus(id));

    // Snapshot
    ipcMain.handle('stream:snapshot', async (_, id) => {
      const camera = this.cameraService.getById(id);
      if (!camera) throw new Error(`Camera ${id} not found`);
      return this.streamService.takeSnapshot(camera);
    });

    // Audio listening Control
    ipcMain.handle('stream:startAudio', async (_, id) => {
      const camera = this.cameraService.getById(id);
      if (!camera) throw new Error(`Camera ${id} not found`);
      return this.audioStreamService.start(camera, this.mainWindow);
    });
    ipcMain.handle('stream:stopAudio', (_, id) => this.audioStreamService.stop(id));

    // System
    ipcMain.handle('app:selectDirectory', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openDirectory'],
      });
      return result.canceled ? null : result.filePaths[0];
    });

    ipcMain.handle('app:openExternal', (_, url) => shell.openExternal(url));

    // ── Network Probe ──────────────────────────────────────────────────────
    ipcMain.handle('probe:getSubnet', () => {
      console.log('[Main] probe:getSubnet requested');
      const { networkInterfaces } = require('os');
      const ifaces = networkInterfaces();
      for (const iface of Object.values(ifaces)) {
        for (const info of iface) {
          if (info.family === 'IPv4' && !info.internal) {
            const parts = info.address.split('.');
            const result = {
              ip: info.address,
              subnet: `${parts[0]}.${parts[1]}.${parts[2]}`,
            };
            console.log('[Main] Detected subnet:', result.subnet);
            return result;
          }
        }
      }
      return { ip: '127.0.0.1', subnet: '192.168.1' };
    });

    ipcMain.handle('probe:start', async (_, subnet) => {
      console.log(`[Main] probe:start requested for subnet: ${subnet}`);
      // Remove previous listeners to avoid duplicates on re-scan
      this.probeService.removeAllListeners();

      this.probeService.on('progress', (data) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('probe:progress', data);
        }
      });

      this.probeService.on('found', (result) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('probe:found', result);
        }
      });

      this.probeService.on('done', (summary) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('probe:done', summary);
        }
      });

      this.probeService.on('cancelled', () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('probe:cancelled', {});
        }
      });

      // Run scan asynchronously — result also comes via events above
      this.probeService.scan(subnet).catch((err) => {
        console.error('[ProbeService] Scan error:', err.message);
      });

      return { started: true };
    });

    ipcMain.handle('probe:cancel', () => {
      this.probeService.cancel();
      return { cancelled: true };
    });

    // ── Web Server ─────────────────────────────────────────────────────────
    ipcMain.handle('webserver:status', () => this.httpService.getStatus());
    ipcMain.handle('webserver:start', async (_, port) => {
      const url = await this.httpService.start(port || 2323);
      // Persist state in settings
      const settings = this.databaseService.getSettings();
      settings.webServerEnabled = true;
      settings.webServerPort = port || 2323;
      await this.databaseService.saveSettings(settings);
      return { url };
    });
    ipcMain.handle('webserver:stop', async () => {
      await this.httpService.stop();
      const settings = this.databaseService.getSettings();
      settings.webServerEnabled = false;
      await this.databaseService.saveSettings(settings);
      return { stopped: true };
    });

    // ── Database / Maintenance ───────────────────────────────────────────
    ipcMain.handle('storage:getSettings', () => this.databaseService.getSettings());
    ipcMain.handle('storage:saveSettings', (_, settings) => this.databaseService.saveSettings(settings));

    ipcMain.handle('app:exportSettings', async () => {
      const { filePath } = await dialog.showSaveDialog(this.mainWindow, {
        title: 'Export Settings',
        defaultPath: 'opencams_settings.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (filePath) return await this.databaseService.exportDump(filePath);
      return null;
    });

    ipcMain.handle('app:importSettings', async () => {
      const { filePaths } = await dialog.showOpenDialog(this.mainWindow, {
        title: 'Import Settings',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      });
      if (filePaths && filePaths[0]) {
        await this.databaseService.importDump(filePaths[0]);
        // Update local state and notify UI
        const cameras = this.databaseService.getAllCameras();
        this.cameraService.setAll(cameras);
        this.httpService.setCameras(cameras);
        return { success: true };
      }
      return null;
    });

    ipcMain.handle('app:resetSettings', async () => {
      const { response } = await dialog.showMessageBox(this.mainWindow, {
        type: 'warning',
        title: 'Confirm Reset',
        message: 'This will delete ALL cameras and settings. Are you sure?',
        buttons: ['Cancel', 'Reset Everything'],
        defaultId: 0
      });

      if (response === 1) {
        await this.databaseService.reset();
        const cameras = this.databaseService.getAllCameras();
        this.cameraService.setAll(cameras);
        this.httpService.setCameras(cameras);
        return { success: true };
      }
      return { success: false };
    });
  }

  /**
   * Initializes services and loads persisted cameras.
   */
  async initialize() {
    // Initial camera load
    this.cameraService.setAll(this.databaseService.getAllCameras());

    // Wire up camera persistence on changes
    this.cameraService.on('change', () => {
      const cameras = this.cameraService.getAll();
      cameras.forEach(cam => this.databaseService.saveCamera(cam));
      this.httpService.setCameras(cameras);
    });

    this.cameraService.on('delete', (id) => {
      this.databaseService.deleteCamera(id);
    });

    // Relay frames to BOTH local UI and Web Server
    this.streamService.on('frame', (cameraId, frame) => {
      // 1. To Web Server (Binary JPEG)
      this.httpService.broadcastFrame(cameraId, frame);

      // 2. To Local Renderer (Base64)
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        try {
          this.mainWindow.webContents.send('stream:frame', cameraId, frame.toString('base64'));
        } catch (err) {
          if (!err.message.includes('disposed')) {
            console.error('[Main] Error relaying frame:', err.message);
          }
        }
      }
    });

    // Auto-start web server if enabled in settings
    const settings = this.databaseService.getSettings();
    this.httpService.setCameras(this.cameraService.getAll());
    if (settings.webServerEnabled) {
      this.httpService.start(settings.webServerPort || 2323).catch(err => {
        console.error('[Main] Failed to start auto-server:', err.message);
      });
    }
  }

  /**
   * Bootstraps the Electron application.
   */
  async start() {
    await this.initialize();
    this.createWindow();
    this.registerIpcHandlers();
  }
}

const appInstance = new Application();

app.whenReady().then(() => appInstance.start());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) appInstance.start();
});

app.on('before-quit', () => {
  appInstance.streamService.stopAll();
  appInstance.audioStreamService.stopAll();
});
