# RTSP Camera Manager — Implementation Documentation

## Overview

This document describes the full architecture of the RTSP Camera Manager, an Electron-based desktop application for monitoring multiple RTSP camera streams in real time.

---

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime   | Electron 28 (Node.js 18) |
| UI        | Vanilla HTML + CSS + JavaScript (ES6+) |
| Video     | FFmpeg (system binary) via `child_process.spawn` |
| Storage   | JSON files in Electron `userData` directory |
| IDs       | UUID v4 via `uuid` package |

---

## Project Structure

```
rtsp-manager/
├── package.json
├── assets/
│   └── icon.png
├── src/
│   └── main/                   # Main (Node) process
│       ├── main.js              # App bootstrap & IPC registration
│       ├── preload.js           # contextBridge API surface
│       └── services/
│           ├── cameraService.js # Camera CRUD + EventEmitter
│           ├── streamService.js # FFmpeg process management
│           └── storageService.js# JSON persistence
└── renderer/                   # Renderer (browser) process
    ├── index.html
    ├── styles/
    │   └── main.css             # Token-based dark mode design system
    └── scripts/
        └── app.js               # Renderer MVC logic
```

---

## Main Process (`src/main/`)

### `main.js` — Application Bootstrap

**Responsibilities:**
- Creates and configures the `BrowserWindow`
- Wires all IPC handlers via `ipcMain.handle`
- Coordinates service initialization on startup
- Handles app lifecycle (ready, closed, activate)

**Key Decisions:**
- `contextIsolation: true` + `nodeIntegration: false` for security (no raw Node access in renderer)
- `titleBarStyle: 'hiddenInset'` for macOS native look
- All services are instantiated as class instances (DI-friendly)

### `preload.js` — Context Bridge

Exposes a strictly typed `window.api` object to the renderer:
```js
window.api.camera.add(data)
window.api.stream.start(id)
window.api.on('stream:frame', callback)
```

Only whitelisted IPC channels are exposed.

---

## Services

### `CameraService` (EventEmitter)

**Pattern:** Domain model + event bus  
**Persistence:** Fires `'change'` → `StorageService.saveCameras()`

```
add(data) → validates → creates UUID → emits 'change'
update(id, data) → merges → emits 'change'
delete(id) → removes → emits 'change'
```

**Validation rules:**
- `name`: required, non-empty
- `rtspUrl`: required, must start with `rtsp://` or `rtsps://`

### `StreamService`

**Pattern:** Process Manager  
**Core flow:**

```
start(camera, win)
  → buildRtspUrl (inject credentials)
  → spawn ffmpeg -i <url> -f mjpeg pipe:1
  → stdout: extract JPEG frames (SOI/EOI markers)
  → win.webContents.send('stream:frame', id, base64)
  → on close: schedule reconnect via camera.reconnect interval
```

**Frame extraction:**  
JPEG frames are identified by their binary markers:
- Start of Image (SOI): `0xFF 0xD8`
- End of Image (EOI): `0xFF 0xD9`

Buffer accumulates until a full frame is found, then sends to renderer.

**Error handling:**
- FFmpeg stderr → `stream:error` IPC event
- Process exit → sets status to `error`, schedules auto-reconnect
- `stopAll()` called on app quit to kill all children

### `StorageService`

**Storage location:** `app.getPath('userData')`  
**Files:**
- `cameras.json` — array of Camera objects
- `settings.json` — application preferences

Reads/writes are synchronous (`fs.readFileSync/writeFileSync`) to keep logic simple.

---

## Renderer Process (`renderer/`)

### Architecture: Store → Controller → UI

```
┌─────────────────────────────────────┐
│  store (plain object, single source)│
│  cameras[], streamStatuses{}, ...   │
└────────────────┬────────────────────┘
                 │ read/write
    ┌────────────┼────────────┐
    │            │            │
cameraController │     navController
streamManager    │     gridController
settingsController│    statsController
    │            │
    └────────────┴───→ UI Components
                   cameraGridUI
                   cameraListUI
                   modalController
                   toast
```

**No framework** — plain ES6 classes and functions. This keeps the bundle zero-overhead and fully inspectable.

### `streamManager`

- Calls `window.api.stream.start/stop`
- Listens to `stream:frame` IPC events → renders JPEG data URLs on `<canvas>`
- Maintains per-camera FPS counters (samples every 1 second)
- Calls `cameraGridUI.updateCardStatus` on status changes

### `cameraGridUI`

- Builds camera card DOM elements with inline `data-*` selectors
- Uses event delegation on the grid container (not per-button listeners)
- JPEG frames are decoded via `Image` and drawn to `<canvas>`

### `toast`

- Pure DOM, no dependencies
- Auto-dismisses after 3.5 seconds with CSS `toast-out` animation

---

## Security Model

| Layer | Measure |
|-------|---------|
| contextIsolation | Renderer cannot access Node.js directly |
| preload whitelist | Only specific IPC channels exposed |
| CSP header | `default-src 'self'` — no external scripts |
| No eval | No dynamic code execution paths |
| Credential handling | Passwords injected into URL at spawn time, never stored in base64-exposed memory |

---

## IPC Channel Reference

| Channel | Direction | Description |
|---------|-----------|-------------|
| `camera:getAll` | R→M | Returns all cameras |
| `camera:add` | R→M | Creates new camera |
| `camera:update` | R→M | Updates existing camera |
| `camera:delete` | R→M | Deletes camera + stops stream |
| `stream:start` | R→M | Starts FFmpeg for camera |
| `stream:stop` | R→M | Kills FFmpeg for camera |
| `stream:stopAll` | R→M | Kills all FFmpeg processes |
| `stream:status` | R→M | Returns current stream status |
| `stream:snapshot` | R→M | Returns base64 JPEG snapshot |
| `stream:frame` | M→R | JPEG frame data (continuous) |
| `stream:status` | M→R | Status change event |
| `stream:error` | M→R | Error message from FFmpeg stderr |
| `storage:getSettings` | R→M | Loads settings |
| `storage:saveSettings` | R→M | Persists settings |
| `app:selectDirectory` | R→M | Native directory picker |
| `app:openExternal` | R→M | Open URL in default browser |

---

## Camera Data Model

```typescript
interface Camera {
  id: string;          // UUID v4
  name: string;        // Display name
  rtspUrl: string;     // rtsp:// or rtsps:// URL
  username: string;    // Auth username (optional)
  password: string;    // Auth password (optional)
  group: string;       // Logical group label
  enabled: boolean;    // Auto-start on app launch
  transport: 'tcp' | 'udp';
  reconnect: number;   // Reconnect interval in seconds
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}
```

---

## FFmpeg Command Reference

### Live Stream (MJPEG pipe)
```bash
ffmpeg \
  -loglevel error \
  -rtsp_transport tcp \
  -i rtsp://user:pass@host:554/stream \
  -an \
  -f mjpeg \
  -q:v 5 \
  -r 15 \
  pipe:1
```

### Snapshot
```bash
ffmpeg \
  -rtsp_transport tcp \
  -i rtsp://user:pass@host:554/stream \
  -frames:v 1 \
  -q:v 2 \
  -y output.jpg
```

---

## CSS Design System

The UI uses a **token-based** CSS custom property system in `:root`:

- `--clr-*` — color palette (bg, surface layers, accent, status)
- `--font-*` — typography families
- `--text-*` — font size scale
- `--space-*` — spacing scale
- `--radius-*` — border radius scale
- `--shadow-*` — shadow presets
- `--transition-*` — animation durations

**Key visual patterns:**
- Cards: `glassmorphism`-lite with `border: 1px solid var(--clr-border)` + `backdrop-filter: blur`
- Accent: gradient `#6366f1 → #8b5cf6` (Indigo → Violet)
- Animations: `pulse-green` (live status), `spin` (connecting spinner), `toast-in/out`

---

## Extension Points

### Adding a new transport protocol
1. Add option to `<select id="field-transport">` in `index.html`
2. Pass value through `CameraService.add()` (already stored in `transport` field)
3. `StreamService._launchProcess()` uses `camera.transport` in `-rtsp_transport` flag

### Adding recording support
1. Add `RecordingService` in `src/main/services/`
2. Register `ipcMain.handle('recording:start', ...)` in `main.js`
3. Expose via `preload.js` under `window.api.recording`
4. Store recording output path in `storageService` settings

### Supporting HLS/DASH output
Replace `-f mjpeg pipe:1` with `-f hls output.m3u8` and load via `<video>` element with `src` pointing to local HLS file.
