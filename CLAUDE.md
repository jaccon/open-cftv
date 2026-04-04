# CLAUDE.md: OpenCams Agent Directives

Este arquivo segue os padrões de **Spec-Driven Development (SDD)**, servindo como a diretriz central para Agentes de IA que operam nesta base de código.

## 1. Fonte da Verdade (SDD Specs)
- **Especificação Funcional e de Domínio**: [PROJECT_SPEC.md](documentations/PROJECT_SPEC.md)
- **Especificação Técnica e Contratos**: [ARCHITECTURE_SPEC.md](documentations/ARCHITECTURE_SPEC.md)
- **Guia de Operação e Build**: [BUILD.md](documentations/BUILD.md)

## 2. Comandos de Operação
- **Desenvolvimento**: `npm run dev`
- **Build de Produção**: `npm run build`
- **Reconstrução de Nativos**: `npm run rebuild`
- **Lint**: `npm run lint` (se configurado)

## 3. Diretrizes de Desenvolvimento (Guiding Principles)
- **Agentic-First**: O código deve ser modular e bem documentado para facilitar o trabalho de outros agentes.
- **Spec-Driven**: Qualquer alteração funcional **DEVE** ser atualizada primeiro no `PROJECT_SPEC.md` ou `ARCHITECTURE_SPEC.md` antes de ser implementada.
- **Aesthetic Excellence**: O design da interface deve seguir o padrão **Glassmorphism**, utilizando variáveis de tokens definidas no `main.css`.
- **FFmpeg Handling**: Toda manipulação de áudio ou vídeo deve ser feita via processos secundários `spawn` para evitar bloqueio da Loop de Eventos do Node.js.
- **Mac Support**: Sempre considerar o suporte a Apple Silicon (M1/M2/M3) ao lidar com caminhos de binários do sistema (`/opt/homebrew/bin`).

## 4. Regras de Estilo e Padrões
- **Naming**: `camelCase` para variáveis e métodos, `PascalCase` para classes, `kebab-case` para classes CSS.
- **Arquitetura**: Separação clara entre `Main` (Node.js/Electron) e `Renderer` (HTML/JS Browser).
- **Segurança**: Nunca habilitar `nodeIntegration` no Renderer. Sempre usar a API exposta via `preload.js`.
- **Logs**: Utilizar prefixos nos logs: `[Main]`, `[Renderer]`, `[StreamService]`, `[ProbeService]`.
- **SVG**: Fornecer arquivos SVG limpos e otimizados para logos e ícones da interface.

## 5. Checkpoints de Verificação
- [ ] O ícone da aplicação está disponível em `assets/images/icon.png` com 512x512+?
- [ ] O banco de dados está apontando para `app.getPath('userData')`?
- [ ] O FFmpeg está sendo tratado como dependência externa configurável ou via PATH corrigido?
- [ ] O áudio é independente do vídeo?
- [ ] Os scripts de build foram testados e estão com os metadados corretos no `package.json`?
