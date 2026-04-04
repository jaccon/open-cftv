# Project Specification: OpenCams (RTSP Stream Manager)

Este documento serve como a **Fonte da Verdade (Source of Truth)** para a aplicação OpenCams, seguindo os princípios de **Spec-Driven Development (SDD)**.

## 1. Visão Geral (Contexto)
O OpenCams é um gerenciador de streams de vídeo RTSP profissional, permitindo monitoramento múltiplo, extração de áudio unidirecional e descoberta automática de câmeras em rede local.

## 2. Entidades Principais (Domain Spec)
### Camera
- **id**: UUID v4 (string)
- **name**: Nome amigável da câmera
- **group**: Agrupamento lógico (ex: "Escritório", "Entrada")
- **rtspUrl**: URL completa do stream (ex: `rtsp://ip:port/path`)
- **username**: Usuário para autenticação (se necessário)
- **password**: Senha para autenticação (se necessário)
- **transport**: Protocolo de rede (`tcp` ou `udp`)
- **codec**: Codec de vídeo (`h264`, `h265`, `auto`)
- **enabled**: Status de ativação da câmera no grid
- **audioEnabled**: Se a escuta de áudio está habilitada na configuração

## 3. Casos de Uso (Functional Spec)

### UC01: Visualização de Vídeo (Live View)
- **Input**: Camera ID
- **Ação**: Iniciar processo secundário FFmpeg para extrair frames MJPEG via pipe.
- **Regra**: Se transporte for `udp`, aplicar buffers extras para evitar corrupção de frames.
- **Output**: Stream de frames via IPC para o Renderer.

### UC02: Escuta de Áudio (Listen)
- **Input**: Camera ID
- **Ação**: Iniciar processo secundário FFmpeg exclusivo para extrair PCM (s16le, 16kHz, mono).
- **Regra**: O áudio deve ser independente do vídeo para garantir estabilidade.
- **Output**: Buffer de áudio via IPC processado pela Web Audio API no Renderer.

### UC03: Descoberta de Câmeras (Probe)
- **Input**: Prefixo da rede (Subnet)
- **Ação**: Scanner multi-thread de portas RTSP (554) em todo o range .1 a .254.
- **Regra**: Validar paths comuns (`/stream`, `/onvif1`, etc.) após encontrar porta aberta.
- **Output**: Lista de URLs válidas candidatas.

## 4. Regras de Negócio e Decisões (Decision Logic)
- **Reconexão Automática**: Se o processo FFmpeg fechar inesperadamente, aguardar o intervalo configurado e tentar reiniciar.
- **Persistência Local**: Todas as configurações devem ser salvas no SQLite (`app.getPath('userData')`).
- **Compatibilidade Mac (Silicon)**: O binário do FFmpeg deve ser buscado em `/opt/homebrew/bin` priorizando instalações Homebrew em Macs M1/M2/M3.

## 5. Especificação de Validação
- **RTSP URL**: Deve ser uma URL válida começando com `rtsp://`.
- **Credenciais**: Se preenchidas, devem ser injetadas na URL via codificação percentual (URL Encoding).
- **Porta do Servidor Web**: Deve estar entre 1024 e 65535.
