# Guia de Build e Distribuição - OpenCams

Este documento descreve como gerar os executáveis (build) do OpenCams para diferentes sistemas operacionais (Windows, macOS e Linux) utilizando o `electron-builder`.

## Pré-requisitos

Antes de iniciar, certifique-se de ter as seguintes ferramentas instaladas:

- **Node.js**: Versão 18.x ou superior (Recomendado 20.x LTS).
- **npm**: Instalado juntamente com o Node.js.
- **FFmpeg**: O OpenCams depende das bibliotecas do FFmpeg para decodificação de áudio e vídeo RTSP. Certifique-se de que o binário `ffmpeg` esteja no seu PATH ou definido na variável de ambiente `FFMPEG_PATH`.

## Preparação

1. Instale as dependências do projeto:
   ```bash
   npm install
   ```

2. Reconstrua dependências nativas (necessário para o SQLite):
   Como o projeto utiliza o `better-sqlite3`, é necessário garantir que ele seja compilado para a versão do Electron sendo utilizada:
   ```bash
   npm run rebuild
   ```
   *(Nota: O comando `@electron/rebuild` é configurado automaticamente pelo electron-builder, mas pode ser executado manualmente para testes).*

## Gerando a Build

O projeto utiliza o `electron-builder` para empacotar o aplicativo. Utilize o comando abaixo para gerar a build padrão para o seu sistema operacional atual:

```bash
npm run build
```

### Comandos Específicos por Plataforma

Se você estiver em um ambiente que suporte cross-compilation ou queira especificar o alvo:

#### Windows
```bash
npx electron-builder --win nsis
```
O instalador será gerado na pasta `dist/` no formato `.exe`.

#### macOS
```bash
npx electron-builder --mac
```
Gera um arquivo `.dmg` ou `.app` na pasta `dist/`.

#### Linux
```bash
npx electron-builder --linux AppImage
```
Gera um arquivo `.AppImage` pronto para execução.

## Estrutura da Build

As configurações de build estão localizadas no `package.json` sob a chave `"build"`:

- **appId**: `com.jaccon.rtsp-manager`
- **productName**: `RTSP Camera Manager`
- **directories/output**: `dist` (Pasta onde os executáveis serão salvos).

## Solução de Problemas

### Erros no better-sqlite3
Se a build falhar com erros de "Native module", tente limpar e reinstalar:
```bash
rm -rf node_modules
npm install
```

### Binário FFmpeg não encontrado
O `electron-builder` por padrão não empacota o binário do FFmpeg do sistema. Para distribuição em larga escala, recomenda-se baixar um binário estático e incluí-lo na pasta `assets` ou especificar no `package.json` para ser copiado durante a build. Atualmente, o aplicativo busca o `ffmpeg` instalado no sistema do usuário.

---
© 2026 Jaccon Lab - Todos os direitos reservados.
