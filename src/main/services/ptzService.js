'use strict';
const onvif = require('node-onvif');

class PtzService {
  constructor() {
    this.devices = new Map();
  }

  async _getDevice(camera) {
    if (this.devices.has(camera.id)) {
      return this.devices.get(camera.id);
    }
    
    let url;
    try {
      url = new URL(camera.rtspUrl);
    } catch {
      throw new Error('Invalid RTSP URL');
    }
    
    // Try default port 80 or 8080 or port from RTSP URL
    const device = new onvif.OnvifDevice({
      xaddr: `http://${url.hostname}:80/onvif/device_service`,
      user: camera.username || 'admin',
      pass: camera.password || ''
    });

    try {
      await device.init();
      this.devices.set(camera.id, device);
      return device;
    } catch (err) {
      this.devices.delete(camera.id);
      throw new Error(`ONVIF init failed: ${err.message}`);
    }
  }

  /**
   * Continuous move
   */
  async move(camera, direction) {
    const device = await this._getDevice(camera);
    if (!device.services.ptz) throw new Error('PTZ not supported by this camera');
    
    const profile = device.getCurrentProfile();
    const speed = { x: 0, y: 0, z: 0 };
    
    if (direction === 'up') speed.y = 1.0;
    if (direction === 'down') speed.y = -1.0;
    if (direction === 'left') speed.x = -1.0;
    if (direction === 'right') speed.x = 1.0;
    
    await device.services.ptz.continuousMove({
      ProfileToken: profile.token,
      Velocity: speed,
      Timeout: 1 // Moves for 1 second max then stops automatically (fail-safe)
    });
  }
  
  /**
   * Stop PTZ
   */
  async stop(camera) {
    const device = await this._getDevice(camera);
    if (!device.services.ptz) return;
    
    const profile = device.getCurrentProfile();
    await device.services.ptz.stop({
      ProfileToken: profile.token,
      PanTilt: true,
      Zoom: true
    });
  }
}

module.exports = { PtzService };
