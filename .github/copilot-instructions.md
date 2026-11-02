# NEXUS: contexto de desarrollo

NEXUS es un workspace de agentes. La aplicación principal está en `desktop/`: Electron + React/JSX + Vite, motor ESM `.mjs` y entradas CommonJS `.cjs`. La raíz contiene un prototipo web independiente Vinext/Workers/D1. No mezcles comandos, secretos ni almacenamiento.

Lee `docs/ARQUITECTURA.md`, `docs/ESTADO-Y-ROADMAP.md` y `docs/VALIDACION.md`. Los informes de `desktop/research/` son históricos; no asumas vigencia de catálogos, precios o disponibilidad.

## Instalar y verificar

Usa Windows y Node 24.12.0 (`.node-version`). Desde `desktop/`:

```text
npm ci
npm test
npm run build
```

Después `npm start` carga la UI compilada en `ui/`. Usa `npm.cmd` si PowerShell bloquea `npm.ps1`. No existe lint específico de Desktop. CI instala, prueba y compila Desktop en Windows.

`npm test` usa datos sintéticos y no requiere API keys. No ejecutes `test:live*`, `tests/provision-vault.cjs`, `tools/vault-inspect.cjs` ni puentes de vault durante tareas normales. No publiques credenciales, perfiles ni logs privados.

Para abrir la app en desarrollo fija `NEXUS_TEST_DATA` a una carpeta temporal nueva: también impide importar perfiles heredados. `NEXUS_DATA_DIR` por sí sola no desactiva esa importación.

## Mapa del código (relativo a desktop/)

- Ventanas/IPC/vault: `main.cjs`; lista del puente: `preload.cjs`.
- Ciclo del agente/cola/compresión: `core/runtime.mjs`.
- Modelos/peticiones/red: `core/providers.mjs`, `model-request.mjs`, `provider-errors.mjs`, `stream.mjs`.
- Herramientas: `core/tools.mjs`, `mcp.mjs`, `openapi.mjs`, `capabilities.mjs`.
- Persistencia/recuperación: `core/store.mjs`, `sqlite-workspace.mjs`, `storage-*`, `response-journal.mjs`.
- Interfaz: `src/`; pruebas Node: `tests/*.test.mjs`.

## Reglas de continuidad

Conserva formatos persistidos y verifica migraciones si cambian. No borres originales/checkpoints al comprimir ni reenvíes reasoning literal. No repitas herramientas incompletas o efectos externos inciertos. No reintentes una generación que ya emitió salida. Mantén coste desconocido distinto de cero y tokens de ventana distintos de uso acumulado.

Los IDs `arliai/<modelo>` conservan el proveedor por conversación. No envíes extensiones exclusivas de OpenRouter a Arli.ai. Validar una clave no prueba disponibilidad de generación.

Mantén secretos en el proceso principal/vault; no los devuelvas al renderer ni los insertes en prompts. Conserva validación IPC y de rutas. Usa datos temporales y prueba fallos si alteras durabilidad o reintentos.

Prioriza cambios pequeños de la hoja de ruta, UI en español y pruebas de comportamiento. Ejecuta suite y compilación al cambiar código Desktop. Para UI revisa también Electron en Windows con perfil aislado. No afirmes validación visual o con proveedor real si sólo ejecutaste pruebas sintéticas.
