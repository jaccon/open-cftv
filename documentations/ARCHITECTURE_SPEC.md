# Architecture Specification: OpenCams (Technical Spec)

Este documento define os **Contratos Técnicos e de Infraestrutura (Architecture Spec)** da aplicação OpenCams conforme a metodologia **Spec-Driven Development (SDD)**.

## 1. Stack Tecnológico (Core Components)
- **Framework Electron**: 28.3.3+ (Node.js 18+).
- **Frontend (Renderer)**: Vanilla JavaScript ES6+, HTML5, CSS3 Moderno (Glassmorphism).
- **Backend (Main)**: Node.js standard libraries, `child_process` (spawn), `net`, `http`, `events`.
- **Banco de Dados (Persistence)**: SQLite3 (biblioteca `better-sqlite3`).
- **Processamento de Mídia**: FFmpeg (binário externo).

## 2. Contratos de Comunicação (IPC Contracts)

As especificações abaixo definem os contratos **API-First** entre o Processo Principal (Main) e o Processo de Renderização (Renderer).

### API: Camera Management (camera:*)
| Evento | Input/ID | Descrição |
|--------|----------|-----------|
| `camera:getAll` | - | Retorna lista de todas as câmeras (Promise<Camera[]>) |
| `camera:add` | cameraData | Adiciona nova câmera e retorna o objeto gerado |
| `camera:update` | id, data | Atualiza câmera existente |
| `camera:delete` | id | Remove do banco e para streams ativos |

### API: Stream Control (stream:*)
| Evento | Input/ID | Descrição |
|--------|----------|-----------|
| `stream:start` | id | Inicia pipe MJPEG de vídeo |
| `stream:stop` | id | Encerra processo FFmpeg de vídeo |
| `stream:startAudio` | id | Inicia extração de áudio PCM (s16le, 16kHz) |
| `stream:stopAudio` | id | Encerra extração de áudio |
| `stream:snapshot` | id | Captura frame e salva em disco como JPEG |

## 3. Fluxo de Dados (Data Flow Spec)

### Vídeo (MJPEG Over Pipe)
- Main: `spawn ffmpeg` -> Extração MJPEG -> Envio de chunk `Buffer` via IPC `stream:frame`.
- Renderer: Recebe `Buffer` -> Gera `URL.createObjectURL(new Blob([buffer]))` -> Atualiza `src` da `<img>`.

### Áudio (PCM Over Pipe)
- Main: `spawn ffmpeg` -> Extração PCM raw (s16le) -> Envio via IPC `stream:audio`.
- Renderer: Recebe `Buffer` -> Enfileira em `AudioContext` -> Playback contínuo.

## 4. Segurança e Isolamento
- `contextIsolation: true`: Obrigatório para proteção do processo principal.
- `nodeIntegration: false`: Restrito ao Preload.
- `Content-Security-Policy`: Restritivo, permitindo apenas `self`, `blob:` e as fontes Google Fonts configuradas.

## 5. Build & Distribuição (Operacional)
- **Gerenciador**: `electron-builder`.
- **Saídas**: macOS (DMG/ZIP), Windows (NSIS), Linux (AppImage).
- **Ícone Requirido**: 512x512+ PNG em `assets/images/icon.png`.
- **Binário Externo**: O aplicativo depende do `ffmpeg` já instalado no sistema do usuário.
