'use strict';

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * @typedef {Object} Camera
 * @property {string} id          - Unique identifier (UUID v4)
 * @property {string} name        - Display name
 * @property {string} rtspUrl     - Full RTSP stream URL
 * @property {string} username    - Optional auth username
 * @property {string} password    - Optional auth password
 * @property {string} group       - Logical group label
 * @property {boolean} enabled    - Whether the camera is active
 * @property {string} transport   - RTSP transport: 'tcp' | 'udp'
 * @property {string} codec       - Video codec hint: 'auto' | 'h264' | 'hevc'
 * @property {number} reconnectInterval   - Reconnect interval in seconds
 * @property {string} createdAt   - ISO timestamp
 * @property {string} updatedAt   - ISO timestamp
 */

/**
 * CameraService manages the in-memory registry of cameras.
 * Emits 'change' after every mutation so the main process
 * can persist data to disk.
 */
class CameraService extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, Camera>} */
    this._cameras = new Map();
  }

  /**
   * Populates registry from persisted data on startup.
   * @param {Camera[]} cameras
   */
  loadFromStorage(cameras = []) {
    cameras.forEach((cam) => this._cameras.set(cam.id, cam));
  }

  /**
   * Replaces entire registry with new data.
   * @param {Camera[]} cameras
   */
  setAll(cameras = []) {
    this._cameras.clear();
    cameras.forEach((cam) => this._cameras.set(cam.id, cam));
    this.emit('change');
  }

  /**
   * Returns all cameras as an ordered array.
   * @returns {Camera[]}
   */
  getAll() {
    return Array.from(this._cameras.values());
  }

  /**
   * Finds a camera by its unique ID.
   * @param {string} id
   * @returns {Camera|undefined}
   */
  getById(id) {
    return this._cameras.get(id);
  }

  /**
   * Adds a new camera to the registry.
   * @param {Omit<Camera, 'id'|'createdAt'|'updatedAt'>} data
   * @returns {Camera}
   */
  add(data) {
    this._validate(data);
    const now = new Date().toISOString();
    const camera = {
      id: uuidv4(),
      name: data.name.trim(),
      rtspUrl: data.rtspUrl.trim(),
      username: data.username || '',
      password: data.password || '',
      group: data.group || 'Default',
      enabled: data.enabled !== false,
      audioEnabled: data.audioEnabled === true,
      ptzEnabled: data.ptzEnabled === true,
      transport: data.transport || 'tcp',
      codec: data.codec || 'auto',
      reconnectInterval: data.reconnectInterval ?? 5,
      createdAt: now,
      updatedAt: now,
    };
    this._cameras.set(camera.id, camera);
    this.emit('change');
    return camera;
  }

  /**
   * Updates mutable fields of an existing camera.
   * @param {string} id
   * @param {Partial<Camera>} data
   * @returns {Camera}
   */
  update(id, data) {
    const existing = this._cameras.get(id);
    if (!existing) throw new Error(`Camera not found: ${id}`);

    const updated = {
      ...existing,
      ...data,
      id,
      updatedAt: new Date().toISOString(),
    };
    this._cameras.set(id, updated);
    this.emit('change');
    return updated;
  }

  /**
   * Removes a camera from the registry.
   * @param {string} id
   * @returns {boolean}
   */
  delete(id) {
    const deleted = this._cameras.delete(id);
    if (deleted) {
      this.emit('delete', id);
      this.emit('change');
    }
    return deleted;
  }

  /**
   * Validates required camera fields before insertion.
   * @param {Partial<Camera>} data
   * @throws {Error} if validation fails
   */
  _validate(data) {
    if (!data.name || !data.name.trim()) throw new Error('Camera name is required');
    if (!data.rtspUrl || !data.rtspUrl.trim()) throw new Error('RTSP URL is required');
    if (!data.rtspUrl.startsWith('rtsp://') && !data.rtspUrl.startsWith('rtsps://')) {
      throw new Error('RTSP URL must start with rtsp:// or rtsps://');
    }
  }
}

module.exports = { CameraService };
