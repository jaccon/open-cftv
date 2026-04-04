# Quick Start Guide

## Prerequisites

- **Node.js** 18+
- **npm** 10+
- **FFmpeg** installed and available in PATH

### Install FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt install ffmpeg
```

**Windows:**
Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH.

---

## Setup

```bash
# 1. Clone or navigate to the project
cd /path/to/rtsp-manager

# 2. Install dependencies
npm install

# 3. Launch the application
npm start
```

---

## Adding Your First Camera

1. Click **"Add Camera"** in the top-right corner
2. Fill in the required fields:
   - **Camera Name** — any descriptive label
   - **RTSP URL** — e.g., `rtsp://192.168.1.100:554/stream`
3. Optionally fill in credentials and transport settings
4. Click **"Add Camera"** to save
5. Click **"Start"** on the camera card to begin streaming

---

## RTSP URL Formats

| Camera Brand | Example URL |
|-------------|-------------|
| Generic ONVIF | `rtsp://admin:password@192.168.1.100:554/stream1` |
| Hikvision | `rtsp://admin:password@192.168.1.100:554/h264/ch1/main/av_stream` |
| Dahua | `rtsp://admin:password@192.168.1.100:554/cam/realmonitor?channel=1&subtype=0` |
| Axis | `rtsp://192.168.1.100/axis-media/media.amp` |
| Reolink | `rtsp://admin:password@192.168.1.100:554/h264Preview_01_main` |

---

## Grid Layouts

Use the **1×1 / 2×2 / 3×3 / 4×4** buttons in the top bar to choose how many cameras are displayed simultaneously.

---

## Transport Protocol

- **TCP** (recommended): more reliable, handles packet loss better
- **UDP**: lower latency, but may drop frames on lossy networks

---

## Troubleshooting

### Black screen after connecting
- Verify the RTSP URL is reachable: `ffplay rtsp://your-url`
- Try switching transport from `tcp` to `udp`
- Check camera firewall / ONVIF service is enabled

### "Connection error" status
- Check your network route to the camera
- Verify credentials
- Ensure port 554 (or custom port) is open

### High CPU usage
- Reduce the number of simultaneously streaming cameras
- Use a lower quality RTSP substream if camera supports it

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FFMPEG_PATH` | `ffmpeg` | Override path to FFmpeg binary |

```bash
FFMPEG_PATH=/usr/local/bin/ffmpeg npm start
```
