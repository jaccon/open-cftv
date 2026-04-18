'use strict';

/* ══════════════════════════════════════════════════════════════════════════
   RTSP Camera Manager — Renderer Application
   Clean MVC-style architecture: Store → Controller → UI Components
   ══════════════════════════════════════════════════════════════════════════ */

// ─── Store (single source of truth) ────────────────────────────────────────
const store = {
  cameras: [],
  settings: {},
  streamStatuses: {}, // cameraId → StreamStatus
  activeView: 'grid',
  gridCols: 2,
  onlineCount: 0,
  activeListenIds: new Set(), // Set of camera IDs with active audio listening
};

// ─── Selectors (DOM refs) ───────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const el = {
  // Nav
  navGrid: $('nav-grid'),
  navCameras: $('nav-cameras'),
  navSettings: $('nav-settings'),
  navProbe: $('nav-probe'),
  // Views
  viewGrid: $('view-grid'),
  viewCameras: $('view-cameras'),
  viewSettings: $('view-settings'),
  viewProbe: $('view-probe'),
  viewTitle: $('view-title'),
  viewSubtitle: $('view-subtitle'),
  // Grid
  cameraGrid: $('camera-grid'),
  emptyState: $('empty-state'),
  gridControls: $('grid-controls'),
  // Camera list
  cameraList: $('camera-list'),
  // Stats
  statOnline: $('stat-online'),
  statTotal: $('stat-total'),
  // Topbar buttons
  btnAddCamera: $('btn-add-camera'),
  btnEmptyAdd: $('btn-empty-add'),
  // Grid size buttons
  btnGrid1: $('btn-grid-1'),
  btnGrid2: $('btn-grid-2'),
  btnGrid3: $('btn-grid-3'),
  btnGrid4: $('btn-grid-4'),
  // Modal
  modalBackdrop: $('modal-backdrop'),
  modalTitle: $('modal-title'),
  modalSubmit: $('modal-submit'),
  modalClose: $('modal-close'),
  modalCancel: $('modal-cancel'),
  cameraForm: $('camera-form'),
  formError: $('form-error'),
  // Logs View
  navLogs: $('nav-logs'),
  viewLogs: $('view-logs'),
  logsCameraSelect: $('logs-camera-select'),
  logsPageOutput: $('logs-page-output'),
  // Form fields
  fieldId: $('field-id'),
  fieldName: $('field-name'),
  fieldGroup: $('field-group'),
  fieldRtsp: $('field-rtsp'),
  fieldUsername: $('field-username'),
  fieldPassword: $('field-password'),
  fieldTransport: $('field-transport'),
  fieldReconnect: $('field-reconnect'),
  fieldEnabled: $('field-enabled'),
  fieldAudio: $('field-audio'),
  fieldPtz: $('field-ptz'),
  fieldTalk: $('field-talk'),
  // Settings
  settingColumns: $('setting-columns'),
  settingSnapdir: $('setting-snapdir'),
  btnSnapdir: $('btn-snapdir'),
  btnSaveSettings: $('btn-save-settings'),
  // Toast
  toastContainer: $('toast-container'),
};

// ══════════════════════════════════════════════════════════════════════════
// NAVIGATION CONTROLLER
// ══════════════════════════════════════════════════════════════════════════
const navController = {
  views: {
    grid: {
      view: () => el.viewGrid,
      nav: () => el.navGrid,
      title: 'Camera Grid',
      subtitle: 'Live View',
      showGridControls: true,
    },
    cameras: {
      view: () => el.viewCameras,
      nav: () => el.navCameras,
      title: 'Camera Management',
      subtitle: 'Configure & Monitor',
      showGridControls: false,
    },
    settings: {
      view: () => el.viewSettings,
      nav: () => el.navSettings,
      title: 'Settings',
      subtitle: 'Application Preferences',
      showGridControls: false,
    },
    probe: {
      view: () => el.viewProbe,
      nav: () => el.navProbe,
      title: 'Probe Camera',
      subtitle: 'Discover RTSP Cameras on Local Network',
      showGridControls: false,
    },
    logs: {
      view: () => el.viewLogs,
      nav: () => el.navLogs,
      title: 'Stream Logs',
      subtitle: 'Debug FFmpeg streaming issues',
      showGridControls: false,
    },
  },

  navigate(viewName) {
    if (store.activeView === viewName) return;
    store.activeView = viewName;

    Object.entries(this.views).forEach(([name, cfg]) => {
      const isActive = name === viewName;
      cfg.view().classList.toggle('view--hidden', !isActive);
      if (cfg.nav) {
        cfg.nav().classList.toggle('nav-item--active', isActive);
        if (isActive) cfg.nav().setAttribute('aria-current', 'page');
        else cfg.nav().removeAttribute('aria-current');
      }
    });

    const cfg = this.views[viewName];
    el.viewTitle.textContent = cfg.title;
    el.viewSubtitle.textContent = cfg.subtitle;
    el.gridControls.style.display = cfg.showGridControls ? 'flex' : 'none';

    if (viewName === 'cameras') cameraListUI.render();
    if (viewName === 'settings') settingsController.load();
    if (viewName === 'probe') probeController.refreshSubnet();
    if (viewName === 'logs') logsController.onViewDidAppear();
    else logsController.onViewDidDisappear();
  },

  init() {
    el.navGrid.addEventListener('click', () => this.navigate('grid'));
    el.navCameras.addEventListener('click', () => this.navigate('cameras'));
    el.navSettings.addEventListener('click', () => this.navigate('settings'));
    el.navProbe.addEventListener('click', () => this.navigate('probe'));
    el.navLogs.addEventListener('click', () => this.navigate('logs'));
    this.navigate('grid');
  },
};

// ══════════════════════════════════════════════════════════════════════════
// GRID SIZE CONTROLLER
// ══════════════════════════════════════════════════════════════════════════
const gridController = {
  setColumns(cols) {
    store.gridCols = cols;
    el.cameraGrid.style.setProperty('--grid-cols', cols);
    [el.btnGrid1, el.btnGrid2, el.btnGrid3, el.btnGrid4].forEach((btn, i) => {
      btn.classList.toggle('icon-btn--active', i + 1 === cols);
    });
  },

  init() {
    el.btnGrid1.addEventListener('click', () => this.setColumns(1));
    el.btnGrid2.addEventListener('click', () => this.setColumns(2));
    el.btnGrid3.addEventListener('click', () => this.setColumns(3));
    el.btnGrid4.addEventListener('click', () => this.setColumns(4));
    this.setColumns(2);
  },
};

// ══════════════════════════════════════════════════════════════════════════
// STREAM MANAGER
// ══════════════════════════════════════════════════════════════════════════
const streamManager = {
  frameCounters: {}, // cameraId → { count, lastSec, fps }

  async startStream(cameraId) {
    this._updateStatus(cameraId, 'connecting');
    try {
      await window.api.stream.start(cameraId);
    } catch (err) {
      this._updateStatus(cameraId, 'error');
      toast.error(`Failed to start stream: ${err.message}`);
    }
  },

  async stopStream(cameraId) {
    try {
      await window.api.stream.stop(cameraId);
      this._updateStatus(cameraId, 'idle');
    } catch (err) {
      toast.error(`Failed to stop stream: ${err.message}`);
    }
  },

  async takeSnapshot(cameraId) {
    try {
      const dataUrl = await window.api.stream.snapshot(cameraId);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `snapshot_${cameraId}_${Date.now()}.jpg`;
      a.click();
      toast.success('Snapshot saved');
    } catch (err) {
      toast.error(`Snapshot failed: ${err.message}`);
    }
  },

  handleFrame(cameraId, base64) {
    const canvas = document.querySelector(`[data-camera-canvas="${cameraId}"]`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth || canvas.clientWidth;
      canvas.height = img.naturalHeight || canvas.clientHeight;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = `data:image/jpeg;base64,${base64}`;

    // FPS counter
    if (!this.frameCounters[cameraId]) {
      this.frameCounters[cameraId] = { count: 0, lastSec: Date.now(), fps: 0 };
    }
    const fc = this.frameCounters[cameraId];
    fc.count++;
    const now = Date.now();
    if (now - fc.lastSec >= 1000) {
      fc.fps = fc.count;
      fc.count = 0;
      fc.lastSec = now;
      const fpsEl = document.querySelector(`[data-camera-fps="${cameraId}"]`);
      if (fpsEl) fpsEl.textContent = `${fc.fps} fps`;
    }
  },

  _updateStatus(cameraId, status) {
    store.streamStatuses[cameraId] = status;
    cameraGridUI.updateCardStatus(cameraId, status);
    statsController.update();
  },

  bindIpcEvents() {
    window.api.on('stream:frame', (cameraId, base64) => this.handleFrame(cameraId, base64));
    window.api.on('stream:audio', (cameraId, buffer) => listenController.handleAudio(cameraId, buffer));
    window.api.on('stream:status', (cameraId, status) => this._updateStatus(cameraId, status));
    window.api.on('stream:error', (cameraId, err) => {
      console.warn(`[Stream ${cameraId}] ${err}`);
    });
  },
};

// ══════════════════════════════════════════════════════════════════════════
// CAMERA GRID UI
// ══════════════════════════════════════════════════════════════════════════
const cameraGridUI = {
  render() {
    const cameras = store.cameras;
    const hasCamera = cameras.length > 0;

    el.emptyState.style.display = hasCamera ? 'none' : 'flex';

    // Remove old cards (keep empty state)
    el.cameraGrid.querySelectorAll('.camera-card').forEach((c) => c.remove());

    cameras.forEach((cam) => {
      el.cameraGrid.appendChild(this.buildCard(cam));
    });
  },

  buildCard(camera) {
    const status = store.streamStatuses[camera.id] || 'idle';
    const card = document.createElement('div');
    card.className = `camera-card${status === 'streaming' ? ' camera-card--streaming' : ''}`;
    card.dataset.cameraId = camera.id;

    card.innerHTML = `
      <div class="camera-card__feed">
        <canvas class="camera-card__canvas" data-camera-canvas="${camera.id}"></canvas>
        <div class="camera-card__overlay" data-camera-overlay="${camera.id}">
          ${this._buildPlaceholder(status)}
        </div>
        <div class="camera-card__status-badge" data-camera-badge="${camera.id}">
          <span class="status-dot status-dot--${status}"></span>
          <span>${this._statusLabel(status)}</span>
        </div>
        <div class="camera-card__fps" data-camera-fps="${camera.id}"></div>
        <div class="camera-card__ptz-controls ${camera.ptzEnabled ? 'visible' : ''}" data-camera-ptz="${camera.id}">
          <button class="ptz-btn" data-action="ptz-up" data-id="${camera.id}" aria-label="PTZ Up">▲</button>
          <div style="display:flex;">
            <button class="ptz-btn" data-action="ptz-left" data-id="${camera.id}" aria-label="PTZ Left">◀</button>
            <button class="ptz-btn" data-action="ptz-right" data-id="${camera.id}" aria-label="PTZ Right">▶</button>
          </div>
          <button class="ptz-btn" data-action="ptz-down" data-id="${camera.id}" aria-label="PTZ Down">▼</button>
        </div>
        <div class="camera-card__actions">
          <button class="icon-btn" title="View Logs" data-action="logs" data-id="${camera.id}" aria-label="View Logs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
          </button>
          <button class="icon-btn" title="Snapshot" data-action="snapshot" data-id="${camera.id}" aria-label="Take snapshot">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
          </button>
          <button class="icon-btn ${camera.audioEnabled ? '' : 'hidden'}" title="Listen" data-action="listen" data-id="${camera.id}" aria-label="Listen to camera">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
          </button>
          <button class="icon-btn ${camera.talkEnabled ? '' : 'hidden'}" title="Toggle Mic" data-action="talk" data-id="${camera.id}" aria-label="Toggle talk">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          </button>
          <button class="icon-btn" title="Edit" data-action="edit" data-id="${camera.id}" aria-label="Edit camera">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
      </div>
      <div class="camera-card__footer">
        <div>
          <div class="camera-card__name">${this._esc(camera.name)}</div>
          <div class="camera-card__meta">${this._esc(camera.group || 'Default')}</div>
        </div>
        <button class="btn ${status === 'streaming' ? 'btn--danger' : 'btn--secondary'}"
                data-action="${status === 'streaming' ? 'stop' : 'start'}"
                data-id="${camera.id}"
                style="font-size:0.75rem;padding:4px 12px;">
          ${status === 'streaming' ? 'Stop' : 'Start'}
        </button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'start') streamManager.startStream(id);
      else if (action === 'stop') streamManager.stopStream(id);
      else if (action === 'snapshot') streamManager.takeSnapshot(id);
      else if (action === 'logs') logsController.open(id);
      else if (action === 'edit') modalController.open(id);
      else if (action === 'listen') listenController.toggleListen(id);
      else if (action === 'talk') talkController.toggleTalk(id, btn);
    });

    // PTZ continuous movement bindings
    card.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('[data-action^="ptz-"]');
      if (!btn) return;
      const id = btn.dataset.id;
      const dir = btn.dataset.action.split('-')[1]; // "up", "down", "left", "right"
      window.api.ptz.move(id, dir).catch(() => toast.error('PTZ Move Failed'));
    });

    card.addEventListener('mouseup', (e) => {
      const btn = e.target.closest('[data-action^="ptz-"]');
      if (!btn) return;
      const id = btn.dataset.id;
      window.api.ptz.stop(id).catch(() => {});
    });
    card.addEventListener('mouseleave', (e) => {
      // If mouse leaves while holding, stop PTZ
      const btn = e.target.closest('[data-action^="ptz-"]');
      if (btn) {
        const id = btn.dataset.id;
        window.api.ptz.stop(id).catch(() => {});
      }
    });



    return card;
  },

  updateCardStatus(cameraId, status) {
    const card = el.cameraGrid.querySelector(`[data-camera-id="${cameraId}"]`);
    if (!card) return;

    card.classList.toggle('camera-card--streaming', status === 'streaming');

    const badge = card.querySelector(`[data-camera-badge="${cameraId}"]`);
    if (badge) {
      badge.innerHTML = `<span class="status-dot status-dot--${status}"></span><span>${this._statusLabel(status)}</span>`;
    }

    const overlay = card.querySelector(`[data-camera-overlay="${cameraId}"]`);
    if (overlay) {
      overlay.innerHTML = this._buildPlaceholder(status);
      overlay.style.display = status === 'streaming' ? 'none' : 'flex';
    }

    const ptzPanel = card.querySelector(`[data-camera-ptz="${cameraId}"]`);
    if (ptzPanel) {
      const camera = store.cameras.find(c => c.id === cameraId);
      if (camera && camera.ptzEnabled) {
        ptzPanel.classList.add('visible');
      } else {
        ptzPanel.classList.remove('visible');
      }
    }

    const toggleBtn = card.querySelector('[data-action="start"], [data-action="stop"]');
    if (toggleBtn) {
      const isStreaming = status === 'streaming';
      toggleBtn.dataset.action = isStreaming ? 'stop' : 'start';
      toggleBtn.className = `btn ${isStreaming ? 'btn--danger' : 'btn--secondary'}`;
      toggleBtn.textContent = isStreaming ? 'Stop' : 'Start';
      toggleBtn.style.cssText = 'font-size:0.75rem;padding:4px 12px;';
    }
  },

  _buildPlaceholder(status) {
    if (status === 'streaming') return '';
    if (status === 'connecting') {
      return `<div class="feed-placeholder"><div class="feed-spinner"></div><span class="feed-placeholder__label">Connecting…</span></div>`;
    }
    if (status === 'error') {
      return `<div class="feed-placeholder">
        <svg class="feed-placeholder__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span class="feed-placeholder__label">Connection error</span>
      </div>`;
    }
    return `<div class="feed-placeholder">
      <svg class="feed-placeholder__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
      <span class="feed-placeholder__label">Stream idle</span>
    </div>`;
  },

  _statusLabel(status) {
    return { streaming: 'Live', connecting: 'Connecting', error: 'Error', idle: 'Idle', stopped: 'Stopped' }[status] || status;
  },

  _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
};

// ══════════════════════════════════════════════════════════════════════════
// CAMERA LIST UI
// ══════════════════════════════════════════════════════════════════════════
const cameraListUI = {
  render() {
    el.cameraList.innerHTML = '';
    if (!store.cameras.length) {
      el.cameraList.innerHTML = `<p style="color:var(--clr-text-muted);text-align:center;padding:3rem;">No cameras configured. Click "Add Camera" to start.</p>`;
      return;
    }
    store.cameras.forEach((cam) => {
      el.cameraList.appendChild(this.buildRow(cam));
    });
  },

  buildRow(camera) {
    const status = store.streamStatuses[camera.id] || 'idle';
    const row = document.createElement('div');
    row.className = 'camera-list-item';
    row.setAttribute('role', 'listitem');

    row.innerHTML = `
      <div class="camera-list-item__thumb">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
      </div>
      <div class="camera-list-item__info">
        <div class="camera-list-item__name">${this._esc(camera.name)}</div>
        <div class="camera-list-item__url">${this._esc(camera.rtspUrl)}</div>
        <div class="camera-list-item__group">${this._esc(camera.group || 'Default')}</div>
      </div>
      <div class="camera-list-item__actions">
        <span class="stat-chip">
          <span class="stat-chip__dot stat-chip__dot--${status === 'streaming' ? 'green' : 'gray'}"></span>
          ${status}
        </span>
        <button class="btn btn--secondary" style="font-size:0.75rem;padding:4px 12px;" data-action="edit" data-id="${camera.id}">Edit</button>
        <button class="btn btn--danger" style="font-size:0.75rem;padding:4px 12px;" data-action="delete" data-id="${camera.id}">Delete</button>
      </div>
    `;

    row.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'edit') modalController.open(btn.dataset.id);
      if (btn.dataset.action === 'delete') {
        if (confirm(`Delete camera "${camera.name}"?`)) {
          await cameraController.delete(camera.id);
        }
      }
    });

    return row;
  },

  _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
};

// ══════════════════════════════════════════════════════════════════════════
// MODAL CONTROLLER
// ══════════════════════════════════════════════════════════════════════════
const modalController = {
  isEditing: false,

  open(cameraId = null) {
    this.isEditing = !!cameraId;
    el.modalTitle.textContent = this.isEditing ? 'Edit Camera' : 'Add Camera';
    el.modalSubmit.textContent = this.isEditing ? 'Save Changes' : 'Add Camera';
    el.formError.hidden = true;

    if (cameraId) {
      const cam = store.cameras.find((c) => c.id === cameraId);
      if (cam) this._fillForm(cam);
    } else {
      this._resetForm();
    }

    el.modalBackdrop.hidden = false;
    el.fieldName.focus();
  },

  close() {
    el.modalBackdrop.hidden = true;
    this._resetForm();
  },

  _fillForm(camera) {
    el.fieldId.value = camera.id;
    el.fieldName.value = camera.name;
    el.fieldGroup.value = camera.group || '';
    el.fieldRtsp.value = camera.rtspUrl;
    el.fieldUsername.value = camera.username || '';
    el.fieldPassword.value = camera.password || '';
    el.fieldTransport.value = camera.transport || 'tcp';
    el.fieldReconnect.value = camera.reconnectInterval ?? 5;
    el.fieldEnabled.checked = camera.enabled !== false;
    el.fieldAudio.checked = camera.audioEnabled === true;
    if (el.fieldPtz) el.fieldPtz.checked = camera.ptzEnabled === true;
    if (el.fieldTalk) el.fieldTalk.checked = camera.talkEnabled === true;
  },

  _resetForm() {
    el.cameraForm.reset();
    el.fieldId.value = '';
    el.fieldTransport.value = 'tcp';
    el.fieldReconnect.value = '5';
    el.fieldEnabled.checked = true;
    el.fieldAudio.checked = false;
    if (el.fieldPtz) el.fieldPtz.checked = false;
    if (el.fieldTalk) el.fieldTalk.checked = false;
    el.formError.hidden = true;
  },

  showError(msg) {
    el.formError.textContent = msg;
    el.formError.hidden = false;
  },

  init() {
    el.modalClose.addEventListener('click', () => this.close());
    el.modalCancel.addEventListener('click', () => this.close());
    el.modalBackdrop.addEventListener('click', (e) => {
      if (e.target === el.modalBackdrop) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.modalBackdrop.hidden) this.close();
    });

    el.cameraForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        name: el.fieldName.value.trim(),
        group: el.fieldGroup.value.trim(),
        rtspUrl: el.fieldRtsp.value.trim(),
        username: el.fieldUsername.value.trim(),
        password: el.fieldPassword.value,
        transport: el.fieldTransport.value,
        reconnectInterval: parseInt(el.fieldReconnect.value, 10) || 5,
        enabled: el.fieldEnabled.checked,
        audioEnabled: el.fieldAudio.checked,
        ptzEnabled: el.fieldPtz ? el.fieldPtz.checked : false,
        talkEnabled: el.fieldTalk ? el.fieldTalk.checked : false,
      };

      const id = el.fieldId.value;
      if (id) await cameraController.update(id, data);
      else await cameraController.add(data);
    });

    el.btnAddCamera.addEventListener('click', () => this.open());
    el.btnEmptyAdd.addEventListener('click', () => this.open());
  },
};

// ══════════════════════════════════════════════════════════════════════════
// CAMERA CONTROLLER (CRUD)
// ══════════════════════════════════════════════════════════════════════════
const cameraController = {
  async add(data) {
    try {
      const camera = await window.api.camera.add(data);
      store.cameras.push(camera);
      modalController.close();
      cameraGridUI.render();
      if (store.activeView === 'cameras') cameraListUI.render();
      statsController.update();
      toast.success(`Camera "${camera.name}" added`);

      if (camera.enabled) {
        setTimeout(() => streamManager.startStream(camera.id), 500);
      }
    } catch (err) {
      modalController.showError(err.message);
    }
  },

  async update(id, data) {
    try {
      const camera = await window.api.camera.update(id, data);
      const idx = store.cameras.findIndex((c) => c.id === id);
      if (idx !== -1) store.cameras[idx] = camera;
      modalController.close();
      cameraGridUI.render();
      if (store.activeView === 'cameras') cameraListUI.render();
      toast.success(`Camera "${camera.name}" updated`);
    } catch (err) {
      modalController.showError(err.message);
    }
  },

  async delete(id) {
    try {
      await window.api.camera.delete(id);
      store.cameras = store.cameras.filter((c) => c.id !== id);
      delete store.streamStatuses[id];
      cameraGridUI.render();
      if (store.activeView === 'cameras') cameraListUI.render();
      statsController.update();
      toast.success('Camera deleted');
    } catch (err) {
      toast.error(`Delete failed: ${err.message}`);
    }
  },

  async loadAll() {
    try {
      store.cameras = await window.api.camera.getAll();
      cameraGridUI.render();
      statsController.update();

      // Auto-start enabled cameras
      store.cameras
        .filter((c) => c.enabled)
        .forEach((c) => setTimeout(() => streamManager.startStream(c.id), 100));
    } catch (err) {
      toast.error(`Failed to load cameras: ${err.message}`);
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════
// TALK CONTROLLER (TWO-WAY AUDIO)
// ══════════════════════════════════════════════════════════════════════════
const talkController = {
  activeTalks: new Map(), // cameraId -> stream

  async toggleTalk(id, btnElement) {
    if (this.activeTalks.has(id)) {
      this.stopTalk(id, btnElement);
    } else {
      await this.startTalk(id, btnElement);
    }
  },

  async startTalk(id, btnElement) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.activeTalks.set(id, stream);
      btnElement.classList.add('talk-active');
      btnElement.style.color = '#ff4d4f';
      toast.info('Microphone ATIVO e transmitindo para a câmera.', 5000);
    } catch (err) {
      toast.error('Acesso ao microfone negado ou não encontrado.');
    }
  },

  stopTalk(id, btnElement) {
    const stream = this.activeTalks.get(id);
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      this.activeTalks.delete(id);
    }
    if (btnElement) {
      btnElement.classList.remove('talk-active');
      btnElement.style.color = '';
    }
    toast.info('Transmissão de microfone encerrada.', 2000);
  }
};

// ══════════════════════════════════════════════════════════════════════════
// SETTINGS CONTROLLER
// ══════════════════════════════════════════════════════════════════════════
const settingsController = {
  async load() {
    try {
      store.settings = await window.api.storage.getSettings();
      el.settingColumns.value = store.settings.gridColumns || 2;
      el.settingSnapdir.value = store.settings.snapshotDir || '';
      $('setting-server-port').value = store.settings.webServerPort || 2323;
      $('setting-server-auto').checked = store.settings.webServerEnabled || false;
      if ($('setting-udp-buffer')) $('setting-udp-buffer').value = store.settings.udpBufferSize || 10485760;
    } catch (err) {
      toast.error('Failed to load settings');
    }
  },

  async save() {
    try {
      const settings = {
        gridColumns: parseInt(el.settingColumns.value, 10),
        snapshotDir: el.settingSnapdir.value,
        webServerPort: parseInt($('setting-server-port').value, 10) || 2323,
        webServerEnabled: $('setting-server-auto').checked,
        udpBufferSize: parseInt($('setting-udp-buffer').value, 10) || 10485760,
      };
      await window.api.storage.saveSettings(settings);
      store.settings = settings;
      toast.success('Settings saved');
    } catch (err) {
      toast.error('Failed to save settings');
    }
  },

  init() {
    el.btnSaveSettings.addEventListener('click', () => this.save());
    el.btnSnapdir.addEventListener('click', async () => {
      const dir = await window.api.app.selectDirectory();
      if (dir) el.settingSnapdir.value = dir;
    });

    $('btn-export-settings').addEventListener('click', () => this.export());
    $('btn-import-settings').addEventListener('click', () => this.import());
    $('btn-reset-settings').addEventListener('click', () => this.reset());
  },

  async export() {
    const path = await window.api.app.exportSettings();
    if (path) toast.success(`Settings exported to ${path}`);
  },

  async import() {
    const res = await window.api.app.importSettings();
    if (res && res.success) {
      toast.success('Settings imported successfully. Reloading...');
      setTimeout(() => window.location.reload(), 1500);
    }
  },

  async reset() {
    const res = await window.api.app.resetSettings();
    if (res && res.success) {
      toast.success('All data cleared. Restarting...');
      setTimeout(() => window.location.reload(), 1500);
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════
// SERVER CONTROLLER
// ══════════════════════════════════════════════════════════════════════════
const serverController = {
  async init() {
    this.updateStatus();
    $('server-toggle').addEventListener('change', (e) => this.toggle(e.target.checked));
    
    // Poll status occasionally to keep in sync
    setInterval(() => this.updateStatus(), 10000);
  },

  async toggle(enabled) {
    try {
      if (enabled) {
        const port = parseInt($('setting-server-port').value, 10) || 2323;
        const { url } = await window.api.webserver.start(port);
        toast.info(`Server started at ${url}`);
      } else {
        await window.api.webserver.stop();
        toast.info('Server stopped');
      }
      this.updateStatus();
    } catch (err) {
      toast.error(`Server error: ${err.message}`);
      $('server-toggle').checked = !enabled;
    }
  },

  async updateStatus() {
    const status = await window.api.webserver.getStatus();
    const urlEl = $('server-url');
    const toggleEl = $('server-toggle');
    const widgetEl = $('server-widget');
    
    toggleEl.checked = status.running;
    if (status.running) {
      urlEl.textContent = status.url;
      widgetEl.classList.add('server-status--active');
    } else {
      urlEl.textContent = 'Off-line';
      widgetEl.classList.remove('server-status--active');
    }
  }
};

// ══════════════════════════════════════════════════════════════════════════
// LOGS CONTROLLER
// ══════════════════════════════════════════════════════════════════════════
const logsController = {
  activeTimer: null,
  activeCameraId: null,

  init() {
    el.logsCameraSelect.addEventListener('change', (e) => {
      this.activeCameraId = e.target.value;
      el.logsPageOutput.textContent = 'Loading...';
      this.fetchLogs();
    });
  },

  open(cameraId) {
    this.activeCameraId = cameraId;
    navController.navigate('logs');
  },

  onViewDidAppear() {
    this.populateCameraSelect();
    if (this.activeCameraId) el.logsCameraSelect.value = this.activeCameraId;
    else {
      // Pick first camera if none selected
      if (store.cameras.length > 0) {
        this.activeCameraId = store.cameras[0].id;
        el.logsCameraSelect.value = this.activeCameraId;
      }
    }
    
    el.logsPageOutput.textContent = 'Loading...';
    this.fetchLogs();
    if (!this.activeTimer) {
      this.activeTimer = setInterval(() => this.fetchLogs(), 2000);
    }
  },

  populateCameraSelect() {
    el.logsCameraSelect.innerHTML = '<option value="" disabled selected>Select a camera</option>';
    store.cameras.forEach(cam => {
      const option = document.createElement('option');
      option.value = cam.id;
      option.textContent = cam.name;
      el.logsCameraSelect.appendChild(option);
    });
  },

  async fetchLogs() {
    if (!this.activeCameraId || store.activeView !== 'logs') return;
    try {
      const logs = await window.api.stream.getLogs(this.activeCameraId);
      if (logs && logs.length > 0) {
        el.logsPageOutput.textContent = logs.join('\n');
      } else {
        el.logsPageOutput.textContent = 'No logs available for this session. Is the stream running?';
      }
      // auto scroll to bottom
      el.logsPageOutput.parentElement.scrollTop = el.logsPageOutput.parentElement.scrollHeight;
    } catch (err) {
      console.error('Failed to get logs', err);
    }
  },

  onViewDidDisappear() {
    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
  }
};

// ══════════════════════════════════════════════════════════════════════════
// LISTEN CONTROLLER (ONE-WAY AUDIO)
// ══════════════════════════════════════════════════════════════════════════
const listenController = {
  activeContexts: new Map(), // cameraId → { context, player }

  async toggleListen(cameraId) {
    if (store.activeListenIds.has(cameraId)) {
      await this.stopListen(cameraId);
    } else {
      await this.startListen(cameraId);
    }
  },

  async startListen(cameraId) {
    try {
      // 1. Start audio stream in Main
      await window.api.stream.startAudio(cameraId);
      
      // 2. Setup Web Audio Context for this camera
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000 // Match FFmpeg output
      });
      
      this.activeContexts.set(cameraId, {
        context: audioCtx,
        startTime: 0
      });

      store.activeListenIds.add(cameraId);
      this._updateUI(cameraId, true);
      toast.success('Listening to camera');
    } catch (err) {
      console.error('[Listen] Failed to start:', err);
      toast.error(`Audio failed: ${err.message}`);
    }
  },

  async stopListen(cameraId) {
    try {
      await window.api.stream.stopAudio(cameraId);
      const session = this.activeContexts.get(cameraId);
      if (session) {
        await session.context.close();
        this.activeContexts.delete(cameraId);
      }
      store.activeListenIds.delete(cameraId);
      this._updateUI(cameraId, false);
    } catch (err) {
      console.error('[Listen] Error stopping:', err);
    }
  },

  handleAudio(cameraId, audioBuffer) {
    const session = this.activeContexts.get(cameraId);
    if (!session || !session.context) return;

    // audioBuffer is Int16 raw PCM (s16le)
    const int16 = new Int16Array(audioBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    const audioBufferObj = session.context.createBuffer(1, float32.length, session.context.sampleRate);
    audioBufferObj.getChannelData(0).set(float32);

    const source = session.context.createBufferSource();
    source.buffer = audioBufferObj;
    source.connect(session.context.destination);

    // Dynamic scheduling to avoid gaps
    const now = session.context.currentTime;
    if (session.startTime < now) {
      session.startTime = now + 0.1; // 100ms safety buffer
    }
    source.start(session.startTime);
    session.startTime += audioBufferObj.duration;
  },

  _updateUI(cameraId, isActive) {
    const card = el.cameraGrid.querySelector(`[data-camera-id="${cameraId}"]`);
    if (!card) return;
    const btn = card.querySelector('[data-action="listen"]');
    if (btn) {
      btn.classList.toggle('listen-btn--active', isActive);
      btn.setAttribute('aria-pressed', isActive);
    }
  }
};

// ══════════════════════════════════════════════════════════════════════════
// PROBE CONTROLLER
// ══════════════════════════════════════════════════════════════════════════
const probeController = {
  _results: [],       // ProbeResult[]
  _addedUrls: new Set(),
  _scanning: false,
  _openCount: 0,

  async init() {
    console.log('[Probe] Initializing controller...');
    
    // Attach listeners
    const scanBtn = $('btn-probe-start');
    const cancelBtn = $('btn-probe-cancel');
    const addAllBtn = $('btn-probe-add-all');

    if (scanBtn) scanBtn.addEventListener('click', () => this.startScan());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.cancelScan());
    if (addAllBtn) addAllBtn.addEventListener('click', () => this.addAll());

    window.api.on('probe:progress', (data) => this._onProgress(data));
    window.api.on('probe:found', (result) => this._onFound(result));
    window.api.on('probe:done', (summary) => this._onDone(summary));
    window.api.on('probe:cancelled', () => this._onCancelled());
    
    this.refreshSubnet();
    console.log('[Probe] Controller initialized.');
  },

  async refreshSubnet() {
    try {
      const response = await window.api.probe.getSubnet();
      if (response && response.subnet) {
        $('probe-subnet').value = response.subnet;
      }
    } catch (err) {
      console.warn('[Probe] Subnet discovery failed:', err);
    }
  },

  async startScan() {
    // Guard: ensure IPC bridge is available (requires Electron preload)
    if (!window.api || !window.api.probe) {
      toast.error('IPC bridge unavailable. Please restart the app.');
      console.error('[Probe] window.api.probe is undefined — preload may not have loaded.');
      return;
    }

    let subnet = $('probe-subnet').value.trim();
    if (!subnet) {
      toast.error('Enter a subnet (e.g. 192.168.1)');
      return;
    }
    
    // Sanitize: ensure no trailing dot
    if (subnet.endsWith('.')) {
      subnet = subnet.slice(0, -1);
    }

    // Reset state
    this._results = [];
    this._addedUrls.clear();
    this._scanning = true;
    this._openCount = 0;

    // Reset UI
    $('probe-progress-wrap').hidden = false;
    $('probe-stats-row').hidden = false;
    $('probe-results').hidden = true;
    $('probe-empty').style.display = 'none';
    $('probe-table-body').innerHTML = '';
    $('btn-probe-start').disabled = true;
    $('btn-probe-cancel').disabled = false;
    this._setStats(0, 0, 0, 0);
    this._setProgress(0, 'Scanning…');
    this._setLog('Starting scan...');

    // Show indeterminate pulse while waiting for first IPC event
    $('probe-progress-fill').classList.add('probe-progress-fill--pulse');

    try {
      await window.api.probe.start(subnet);
    } catch (err) {
      $('probe-progress-fill').classList.remove('probe-progress-fill--pulse');
      toast.error(`Scan failed: ${err.message}`);
      this._resetControls();
    }
  },

  async cancelScan() {
    await window.api.probe.cancel();
  },

  async addAll() {
    const unadded = this._results.filter((r) => !this._addedUrls.has(r.url));
    for (const result of unadded) {
      await this._addCamera(result);
    }
  },

  async _addCamera(result) {
    if (this._addedUrls.has(result.url)) return;
    try {
      const camera = await window.api.camera.add({
        name: `${result.ip} — Discovered`,
        rtspUrl: result.url,
        group: 'Discovered',
        transport: 'tcp',
        enabled: false,
      });
      store.cameras.push(camera);
      cameraGridUI.render();
      statsController.update();
      this._addedUrls.add(result.url);
      this._markRowAdded(result.url);
      this._setStats(null, null, null, this._addedUrls.size);
      toast.success(`Added ${result.ip}${result.path}`);
    } catch (err) {
      toast.error(`Failed to add: ${err.message}`);
    }
  },

  _onProgress(data) {
    const total = data.total || 1;
    const pct = total > 0 ? Math.round((data.scanned / total) * 100) : 0;
    const phase = data.phase === 'probing' ? 'Probing RTSP paths…' : 'Scanning port 554…';
    // Remove indeterminate pulse once we have real progress
    if (pct > 0) {
      $('probe-progress-fill').classList.remove('probe-progress-fill--pulse');
    }
    this._setProgress(pct, phase);

    if (data.message) this._setLog(data.message);

    if (data.phase === 'scanning') {
      this._setStats(data.scanned, data.status === 'open' ? ++this._openCount : this._openCount, this._results.length, this._addedUrls.size);
    } else {
      this._setStats(254, this._openCount, this._results.length, this._addedUrls.size);
    }
  },

  _onFound(result) {
    this._results.push(result);
    this._appendRow(result);
    $('probe-results').hidden = false;
    this._setStats(null, null, this._results.length, null);
  },

  _onDone(summary) {
    this._scanning = false;
    $('probe-progress-fill').classList.remove('probe-progress-fill--pulse');
    this._setProgress(100, `Done — ${this._results.length} path(s) discovered`);
    this._setLog(`Scan complete. Found ${this._results.length} RTSP path(s) on ${this._openCount} host(s).`);
    this._resetControls();
    if (this._results.length === 0) {
      $('probe-empty').style.display = 'flex';
      $('probe-empty').querySelector('.probe-empty__text').innerHTML =
        'No cameras found. Try a different subnet or check your network.';
    }
  },

  _onCancelled() {
    this._scanning = false;
    $('probe-progress-fill').classList.remove('probe-progress-fill--pulse');
    this._setProgress(null, 'Scan cancelled');
    this._resetControls();
    toast.info('Scan cancelled');
  },

  _appendRow(result) {
    const tbody = $('probe-table-body');
    const tr = document.createElement('tr');
    tr.dataset.url = result.url;
    tr.innerHTML = `
      <td class="probe-table__ip">${result.ip}</td>
      <td><span class="probe-table__url" title="${result.url}">${result.url}</span></td>
      <td class="probe-table__latency">${result.latencyMs}ms</td>
      <td>
        <button class="btn btn--primary" data-probe-add style="font-size:0.7rem;padding:3px 10px;">
          + Add
        </button>
      </td>
    `;
    tr.querySelector('[data-probe-add]').addEventListener('click', () => this._addCamera(result));
    tbody.appendChild(tr);
  },

  _markRowAdded(url) {
    const row = $('probe-table-body').querySelector(`[data-url="${CSS.escape(url)}"]`);
    if (!row) return;
    const btn = row.querySelector('[data-probe-add]');
    if (btn) {
      btn.outerHTML = `<span class="probe-table__added">✓ Added</span>`;
    }
  },

  _setProgress(pct, label) {
    if (pct !== null) {
      $('probe-progress-fill').style.width = `${pct}%`;
      $('probe-pct').textContent = `${pct}%`;
      $('probe-progress-bar').setAttribute('aria-valuenow', pct);
    }
    if (label) $('probe-phase').textContent = label;
  },

  _setLog(msg) {
    $('probe-progress-log').textContent = msg;
  },

  _setStats(scanned, open, found, added) {
    if (scanned !== null) $('probe-stat-scanned').textContent = scanned;
    if (open !== null) $('probe-stat-open').textContent = open;
    if (found !== null) $('probe-stat-found').textContent = found;
    if (added !== null) $('probe-stat-added').textContent = added;
  },

  _resetControls() {
    $('btn-probe-start').disabled = false;
    $('btn-probe-cancel').disabled = true;
  },
};

// ══════════════════════════════════════════════════════════════════════════
// STATS CONTROLLER
// ══════════════════════════════════════════════════════════════════════════
const statsController = {
  update() {
    const online = Object.values(store.streamStatuses).filter((s) => s === 'streaming').length;
    el.statOnline.textContent = `${online} online`;
    el.statTotal.textContent = `${store.cameras.length} total`;
  },
};

// ══════════════════════════════════════════════════════════════════════════
// TOAST SYSTEM
// ══════════════════════════════════════════════════════════════════════════
const toast = {
  _show(message, type) {
    const el_toast = document.createElement('div');
    el_toast.className = `toast toast--${type}`;
    el_toast.setAttribute('role', 'status');
    el_toast.innerHTML = `<span>${message}</span>`;
    el.toastContainer.appendChild(el_toast);

    setTimeout(() => {
      el_toast.classList.add('toast--out');
      el_toast.addEventListener('animationend', () => el_toast.remove(), { once: true });
    }, 3500);
  },
  success: (msg) => toast._show(msg, 'success'),
  error: (msg) => toast._show(msg, 'error'),
  info: (msg) => toast._show(msg, 'info'),
};

// ══════════════════════════════════════════════════════════════════════════
// APPLICATION BOOTSTRAP
// ══════════════════════════════════════════════════════════════════════════
async function init() {
  try {
    navController.init();
    gridController.init();
    modalController.init();
    logsController.init();
    settingsController.init();
    await serverController.init();
    
    // Don't await on startup if you don't want to block UI showing (optional)
    await probeController.init();
    
    streamManager.bindIpcEvents();
    await cameraController.loadAll();
    
    console.log('[App] System initialized successfully');
  } catch (err) {
    console.error('[App] Initialization error:', err);
    toast.error('System failed to initialize. Check dev console.');
  }
}

document.addEventListener('DOMContentLoaded', init);
