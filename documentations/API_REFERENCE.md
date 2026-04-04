# API Reference — RTSP Camera Manager

## `window.api` (Renderer Context Bridge)

All renderer-side operations go through the `window.api` object exported by the preload script.

---

### `window.api.camera`

#### `camera.getAll(): Promise<Camera[]>`
Returns all registered cameras.

#### `camera.add(data: CameraInput): Promise<Camera>`
Creates and persists a new camera.

```typescript
interface CameraInput {
  name: string;           // required
  rtspUrl: string;        // required, must start with rtsp:// or rtsps://
  username?: string;
  password?: string;
  group?: string;         // default: "Default"
  enabled?: boolean;      // default: true
  transport?: 'tcp'|'udp'; // default: 'tcp'
  reconnect?: number;     // seconds, default: 5
}
```

**Throws:** `Error` if name or rtspUrl are invalid.

#### `camera.update(id: string, data: Partial<CameraInput>): Promise<Camera>`
Updates fields of an existing camera. Returns the updated object.

**Throws:** `Error` if camera not found.

#### `camera.delete(id: string): Promise<boolean>`
Removes camera and stops any active stream. Returns `true` on success.

---

### `window.api.stream`

#### `stream.start(id: string): Promise<{ status: StreamStatus }>`
Starts the FFmpeg process for the given camera. Frames are delivered via `window.api.on('stream:frame', ...)`.

```typescript
type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'error' | 'stopped';
```

#### `stream.stop(id: string): Promise<void>`
Kills the FFmpeg process for the camera. Sets status to `stopped`.

#### `stream.stopAll(): Promise<void>`
Kills all active FFmpeg processes.

#### `stream.status(id: string): Promise<StreamInfo>`
Returns current stream state.

```typescript
interface StreamInfo {
  status: StreamStatus;
  frames: number;
  uptimeMs: number;
  lastError: string | null;
}
```

#### `stream.snapshot(id: string): Promise<string>`
Captures a single frame and returns a `data:image/jpeg;base64,...` string.

**Throws:** `Error` if FFmpeg fails or times out (10s).

---

### `window.api.storage`

#### `storage.getSettings(): Promise<AppSettings>`
```typescript
interface AppSettings {
  theme: 'dark';
  gridColumns: number;
  snapshotDir: string;
  recordingsDir: string;
  maxConnectedCameras: number;
}
```

#### `storage.saveSettings(settings: Partial<AppSettings>): Promise<void>`
Merges provided settings with existing and persists.

---

### `window.api.app`

#### `app.selectDirectory(): Promise<string | null>`
Opens a native OS directory picker. Returns selected path or `null` if cancelled.

#### `app.openExternal(url: string): Promise<void>`
Opens a URL in the system default browser.

---

### `window.api.on(channel, callback)`

Subscribe to events pushed from the main process.

| Channel | Callback Signature | Description |
|---------|-------------------|-------------|
| `stream:frame` | `(cameraId: string, base64: string) => void` | JPEG frame data |
| `stream:status` | `(cameraId: string, status: StreamStatus) => void` | Status change |
| `stream:error` | `(cameraId: string, message: string) => void` | FFmpeg error output |
| `stream:stats` | `(cameraId: string, stats: object) => void` | Reserved for future use |

### `window.api.off(channel, callback)`
Unsubscribes a listener.

---

## IPC Channels (Main Process)

| Handle | Args | Returns |
|--------|------|---------|
| `camera:getAll` | none | `Camera[]` |
| `camera:add` | `CameraInput` | `Camera` |
| `camera:update` | `id, CameraInput` | `Camera` |
| `camera:delete` | `id` | `boolean` |
| `stream:start` | `id` | `{ status }` |
| `stream:stop` | `id` | `void` |
| `stream:stopAll` | none | `void` |
| `stream:status` | `id` | `StreamInfo` |
| `stream:snapshot` | `id` | `base64 string` |
| `storage:getSettings` | none | `AppSettings` |
| `storage:saveSettings` | `settings` | `void` |
| `app:selectDirectory` | none | `string \| null` |
| `app:openExternal` | `url` | `void` |

---

## Error Handling Patterns

All `ipcMain.handle` callbacks propagate thrown errors to the renderer as rejected Promises. In the renderer, catch them with:

```javascript
try {
  const camera = await window.api.camera.add(data);
} catch (err) {
  // err.message contains the server-side error
  console.error(err.message);
}
```

---

## Service Constructor Signatures

```javascript
new CameraService()    // no args
new StreamService()    // no args, uses FFMPEG_PATH env or 'ffmpeg' default
new StorageService()   // no args, uses app.getPath('userData')
```
