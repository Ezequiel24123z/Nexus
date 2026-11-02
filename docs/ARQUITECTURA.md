# Arquitectura de NEXUS

Desktop es la aplicación principal y no depende de tener la web publicada. El prototipo web se conserva en la raíz como antecedente funcional, con sus propias dependencias y almacenamiento.

| Área | Archivos dentro de desktop/ | Responsabilidad |
| --- | --- | --- |
| Proceso principal Electron | `main.cjs` | Ventanas, IPC, vault, archivos, modelos y acciones nativas |
| Puente renderer | `preload.cjs` | Lista permitida de métodos `nexus:invoke` |
| Interfaz | `src/main.jsx`, componentes JSX y CSS | Chats, proyectos, configuración, conectores y paneles |
| Ejecución | `core/runtime.mjs` | Ciclo del agente, cola, dependencias, pausa y compresión |
| Proveedores | `core/providers.mjs`, `model-request.mjs`, `provider-errors.mjs`, `stream.mjs` | Routing, payloads, errores y parsing incremental |
| Herramientas | `core/tools.mjs`, `mcp.mjs`, `openapi.mjs`, `capabilities.mjs` | Archivos, comandos, REST, MCP, contratos y capacidades |
| Persistencia | `core/store.mjs`, `sqlite-workspace.mjs`, `storage-migration.mjs` | JSON inicial, SQLite opcional y migración explícita |
| Recuperación | `core/storage-recovery*.mjs`, `recovery-jobs.mjs`, `response-journal.mjs`, `migrate.mjs` | Recuperación de estado, respuestas interrumpidas y perfiles heredados |
| Contexto y uso | `core/context-inspector.mjs`, `chat-workspace.mjs`, `telemetry.mjs`, `artifacts.mjs` | Paginación, costes, estimaciones e inspección |
| Adjuntos/borradores | `core/attachments.mjs`, `drafts.mjs` y componentes en `src/` | Referencias locales y guardado por conversación |
| Windows | `native/desktop.ps1` | Entrada nativa de ratón y teclado, coordinada desde Electron |
| Pruebas Node | `tests/*.test.mjs` y `tests/fixtures/` | Respuestas simuladas, procesos reales de prueba y datos temporales |
| Pruebas Electron | `core/*smoke.mjs` | Navegación y flujos del renderer con almacenes aislados |

Los nombres abreviados de módulos de motor de la tabla están bajo `desktop/core/`. El prototipo web usa `app/api/`, `lib/runtime.ts`, `db/` y `app/page.tsx`.

## Flujo principal

1. El renderer solicita una operación por preload; el proceso principal valida métodos y argumentos.
2. El runtime aplica instrucciones, construye contexto y ofrece herramientas al modelo.
3. El ID determina el proveedor: `arliai/<id>` selecciona Arli.ai y retira el prefijo en la petición; los demás IDs siguen OpenRouter.
4. El parser recibe texto, uso y llamadas de herramientas. No ejecuta argumentos parciales de un stream interrumpido.
5. Se conservan conversación, diario, efectos y telemetría; los resultados extensos pueden almacenarse como artefactos consultables por fragmentos.
6. La UI recibe historial paginado del chat visible y metadatos de navegación de los demás.

## Invariantes

- Conservar originales y checkpoints al comprimir. El reasoning literal no se reenvía en cada paso.
- No reintentar automáticamente generaciones con salida previa ni repetir herramientas incompletas.
- Al reiniciar, pausar tareas interrumpidas y conciliar efectos externos no confirmados.
- Coste desconocido no significa cero. Contexto estimado y tokens acumulados son métricas distintas.
- Conservar adjuntos como referencias locales, sin base64 permanente dentro del historial.
- Después de activar SQLite, el JSON anterior queda congelado y no es un fallback actualizado.
- Probar SQLite con un runtime compatible con `node:sqlite`: esta entrega usa Node 24.12.0 y Electron fijado en el lockfile.

Mantener ESM `.mjs` en el motor y CommonJS `.cjs` en los puntos de entrada de Electron. Vite compila JSX a `ui/`. No existe script de lint de Desktop; el lint de la raíz pertenece a la web.

Las utilidades de vault y pruebas con proveedor real no forman parte del flujo normal ni de CI. `npm run package` genera un directorio Windows con electron-builder; no produce por sí mismo un instalador firmado ni un actualizador.
