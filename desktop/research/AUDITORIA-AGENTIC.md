# Auditoría comparativa y hoja de ruta de NEXUS

## Diagnóstico

NEXUS es una aplicación local de Electron con un motor propio pequeño y legible: ejecución de herramientas, cola con dependencias, MCP, conectores REST, control visual de Windows, persistencia local, compresión y telemetría de OpenRouter. No deriva ni incorpora código de los productos comparados. La revisión cubre todos los módulos productivos actuales (`main.cjs`, `preload.cjs`, `core/*` y `src/*`) y las pruebas.

La base es adecuada para un agente personal autónomo. Sin embargo, hoy es un **runtime de tareas** más que una plataforma de agentes de larga duración: el modelo recibe un único conjunto amplio de herramientas, la memoria activa se reconstruye de forma monolítica, no hay plan durable ni presupuesto de tokens por herramienta, y una ejecución externa que se interrumpe no tiene un protocolo de conciliación.

## Lo que ya está bien resuelto

| Área | Evidencia en NEXUS | Valor práctico |
| --- | --- | --- |
| Autonomía local | `runtime.mjs` no solicita aprobación en modo autónomo; PowerShell, archivos, MCP y escritorio usan los permisos de Windows | Se ajusta al uso personal sin fricción pedido para NEXUS. |
| Durabilidad básica | Transcript, diario JSONL, checkpoints de compresión, backups de escritura y tareas pausadas al reiniciar | Se puede inspeccionar qué ocurrió y retomar sin repetir automáticamente una llamada de herramienta incompleta. |
| Contexto | Techo operativo editable, slider 10–95%, compresión por bloques, última petición y mensajes fijados reinyectados | Las pruebas reales con DS4.1 Flash mantuvieron las solicitudes por debajo de 50k. |
| Coste | Coste, caché, razonamiento, latencia, cobertura de datos y saldo distinguen `desconocido` de cero | El cache hit medido supera el 99% tras estabilizar un prefijo. |
| Paralelismo | Cola de hasta 64 tareas, dependencias y exclusión por carpeta/escritorio | Dos tareas reales independientes comenzaron prácticamente a la vez. |
| Extensibilidad | MCP stdio/HTTP y conectores REST con secretos cifrados y referencias, no valores en prompts | Buen punto de partida para ampliar capacidades sin acoplarlas al núcleo. |

## Brechas del código actual

| Prioridad | Hallazgo concreto | Riesgo o coste | Mejora propuesta |
| --- | --- | --- | --- |
| P0 | El estado completo de cada chat, conversación y eventos viaja al renderer en cada `snapshot`; el historial sólo se oculta en `messages`, no en `conversation`. | Chats largos consumen memoria/IPC y degradan la UI, aunque estén compactados para el modelo. | **Aplicado:** snapshot limitado a 120 mensajes/80 eventos y API paginada para recuperar rangos anteriores. Pendiente: índice de disco para no mantener todo el transcript en memoria. |
| P0 | Los resultados de MCP, REST y comandos pueden devolverse enteros al modelo; sólo stdout/stderr tiene una retención de 48k. | Un JSON grande destruye el presupuesto de contexto y reduce el cache hit. | Materializador de resultados: vista previa tokenizada, artefacto local completo con hash, referencias recuperables y reglas por tipo. |
| P0 | La recuperación sólo marca la tarea pausada y evita repetir tool calls. No hay estados `intent → dispatched → observed → committed` ni claves de idempotencia. | Tras un corte no se sabe si una API o un comando externo se ejecutó. | **Aplicado parcialmente:** libro mayor durable con `intended → dispatched → observed` e `uncertain` al pausar/reiniciar, más conciliación documentada con evidencia. Pendiente: claves de idempotencia y comprobadores específicos por conector. |
| P0 | La estimación de tokens es global (bytes/3) y no conoce el tokenizer/modelo. | Compresión temprana o tardía, especialmente con código, JSON, imágenes y modelos distintos. | Presupuesto híbrido: tokens reales de la última llamada, tokenizer opcional por modelo y margen adaptativo medido por error. |
| P1 | No hay reintento con backoff, clasificación de 429/5xx, ni planificación por límite de proveedor. | Una ráfaga paralela puede fallar pese a tener saldo; se desperdician reanudaciones manuales. | Scheduler con cuota por proveedor/modelo, backoff exponencial con jitter, reintentos de sólo-lectura y visibilidad de la causa. |
| P1 | `compact` usa el mismo modelo y una petición de resumen cuyo prefijo es muy distinto a la conversación. | La compresión puede costar más de lo necesario y no reutilizar caché. | Perfil independiente de compresión: modelo barato configurable, plantilla estable primero, cache key/segmento propio y evaluación de fidelidad. |
| P1 | El agente sólo tiene un modo. Herramientas, instrucciones y salida cambian poco según intención. | Menos precisión para planificación, revisión y ejecución; más llamadas innecesarias. | Perfiles `Explorar`, `Planificar`, `Ejecutar`, `Revisar`, `Navegador` y `Automatización`, con herramientas/contexto estrictamente necesarios. |
| P1 | Falta navegador con DOM/accesibilidad, adjuntos y artefactos de gran tamaño. El escritorio depende de píxeles. | El control de web es frágil y caro en visión. | Navegador Chromium separado por tarea, acciones DOM/ARIA, capturas como fallback, descargas y adjuntos materializados. |
| P1 | No hay cambios atómicos multiarquivo, diff, worktree ni validación de repositorio. | Un agente puede dejar una modificación amplia difícil de revisar o revertir. | Workspace aislado por tarea, transacción de archivos, diff previo/posterior, checkpoints Git y vista de revisión. |
| P2 | El scheduler sólo conoce número de tareas y bloqueo por carpeta. | No prioriza la conversación activa, dependencias críticas, coste ni exclusividad de recursos. | Grafo de ejecución con prioridad, pools (CPU, red, desktop, navegador), cancelación propagada y reordenamiento visual. |
| P2 | Los conectores REST cubren un subconjunto fijo y MCP no tiene OAuth ni políticas/capacidades declaradas. | Integraciones modernas exigen OAuth, OpenAPI, paginación, websockets y resultados multimodales. | Importador OpenAPI, OAuth PKCE/device flow, plantillas de autenticación y catálogo de capacidades por conector. |
| P2 | La UI no ofrece tablero de plan, diff, artefactos, comparador de modelos ni evaluaciones. | La autonomía existe, pero es menos manejable en tareas largas. | Panel de plan vivo, timeline, archivos/diffs, artefactos, trazas por llamada y laboratorio de modelos. |

## Comparación con patrones públicos

OpenCode separa el contexto duradero del contexto model-visible y, en su diseño actual, reconstruye un baseline después de una compresión terminada. También reserva el mayor entre la salida solicitada y un buffer absoluto antes de cada turno.^1 NEXUS ya conserva originales y checkpoints; debe adoptar el siguiente escalón: **fuentes de contexto tipadas**, presupuesto por fuente y carga diferida. Esto evita convertir una conversación larga en un objeto gigante en memoria.

La evidencia pública también muestra dos trampas que NEXUS debe evitar: conservar pares de herramienta incompletos alrededor de una compresión y compartir la partición de caché de conversación con un resumen de prefijo divergente.^2 La propuesta de segmentos de caché independientes, plantilla estable al principio y un test de transcript válido nace de esas lecciones.

Codex App Server modela explícitamente thread, turn, eventos, capacidades y backpressure en una interfaz JSON-RPC bidireccional.^3 NEXUS debería adoptar esa separación internamente, aunque siga siendo una app de una persona: `Task`, `Turn`, `Effect`, `Artifact`, `ContextSource` y `Run` como entidades persistentes en lugar de un único objeto `task` mutable.

Cline trata una tarea como sesión autocontenida con conversación, comandos, decisiones, coste, tiempo, checkpoint y continuación.^4 Su lección para NEXUS no es el UI, sino que el checkpoint de cambio debe representar el estado del proyecto, no sólo el contenido previo de un archivo.

Continue distingue modos y reduce el conjunto de herramientas por modo: planificación de sólo lectura frente a agente de ejecución.^5 NEXUS puede mantener la autonomía sin autorizaciones por acción y aun así reducir errores/coste: la ausencia de rechazos no exige presentar herramientas de escritura o escritorio a cada petición.

Browser Use combina DOM limpio, visión opcional, memoria de largo plazo y mediciones de coste/duración/éxito por ejecución.^6 Para NEXUS, la prioridad es un navegador con DOM/ARIA y una captura únicamente cuando el DOM no basta; es más fiable y barato que intentar resolver la web sólo con coordenadas.

## Arquitectura objetivo

```text
UI de escritorio
  ├─ chats paginados · plan · artefactos · diff · telemetría · cola
Runtime durable
  ├─ Scheduler de grafo ─ pools de recursos ─ reintentos/cuotas
  ├─ Context assembler ─ fuentes tipadas ─ presupuesto/caché
  ├─ Effect ledger ─ intents ─ observación ─ recuperación
  └─ Artifact store ─ blobs, hashes, previews, referencias
Capacidades
  ├─ archivos/Git/worktrees   ├─ terminal/PTy   ├─ navegador DOM/visión
  ├─ Windows desktop          ├─ MCP            └─ REST/OpenAPI/OAuth
Proveedores
  └─ OpenRouter: catálogo, routing, uso, caché, precio, fallback
```

## Plan de implementación

### Fase 1 — Fiabilidad y coste (primero)

1. Crear `ArtifactStore` y normalizar toda salida de comando/MCP/REST: el modelo recibe una vista breve, hash, tamaño, origen y herramienta para recuperar fragmentos.
2. **Completado:** paginar `snapshot` y trasladar conversación/actividad grandes a lecturas bajo demanda; queda indexar el transcript en disco para sesiones extremas.
3. Añadir token budgeting por fuente, salida reservada absoluta y ajuste automático contra `prompt_tokens` reales.
4. Separar los perfiles de conversación y compresión; mostrar coste/fidelidad de cada compresión.
5. Introducir reintentos transparentes y métricas de 429, timeout, backoff y proveedor/ruta cuando OpenRouter lo informe.

### Fase 2 — Ejecución profesional

1. Añadir plan editable y durable: pasos, dependencias, definición de hecho terminado, verificación y artefactos esperados.
2. **Parcialmente completado:** crear effect ledger con conciliación al reanudar; falta que los conectores declaren idempotencia y su método de comprobación.
3. Añadir worktrees/diffs/checkpoints Git y transacciones multiarquivo recuperables.
4. Dar a la cola pools de recursos y prioridades; el chat activo debe poder adelantar trabajo no crítico.

### Fase 3 — Capacidades diferenciales

1. Navegador DOM/ARIA con perfil por tarea, descargas y adjuntos.
2. Importación OpenAPI, OAuth y conectores enriquecidos.
3. Roles/recetas, memoria de proyecto citada por artefactos y colaboración de subagentes con contratos de entrada/salida.
4. Laboratorio de modelos: misma tarea, coste, latencia, cache hit, tasa de herramientas correctas y evaluación del resultado.

## Pruebas de aceptación

| Escenario | Métrica de éxito |
| --- | --- |
| Conversación de 200k tokens con dos compresiones | La UI sigue fluida; cada solicitud queda bajo el techo; las rutas y la última instrucción se recuperan desde artefactos/checkpoints. |
| REST interrumpido | Al reanudar se ve si el efecto fue enviado, confirmado o incierto; no se reenvía sin una política idempotente. |
| Repositorio con tres tareas | Cada tarea usa su worktree; se presenta diff y pruebas; no hay cruces de cambios. |
| Web compleja | El agente usa DOM primero, captura sólo de fallback, y registra URL/selector/resultado verificable. |
| Presión de proveedor | Un 429 aplica backoff y libera el pool; el resto de tareas útiles continúa. |
| Optimización DS4.1 Flash | Se compara coste por tarea y tasa de cache hit antes/después; ninguna mejora se acepta sólo por intuición. |

## Decisión recomendada

No intentaría copiar cada función de Codex, Cline, OpenCode o Verdent. Construiría primero la capa de **artefactos + efectos + contexto tipado**, porque permite que cualquier capacidad futura (browser, OpenAPI, subagentes o Git) sea barata, auditable y recuperable. Después añadiría navegador DOM y worktrees; son las dos capacidades que más amplían el alcance práctico sin empeorar la interfaz limpia.

## Fuentes

1. anomalyco, [OpenCode Session V2 specification](https://github.com/anomalyco/opencode/blob/dev/specs/v2/session.md), consultada en septiembre de 2026; anomalyco, [compaction implementation](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/compaction.ts), consultada en septiembre de 2026.
2. anomalyco, [issue: pares de tool use/result tras compresión](https://github.com/anomalyco/opencode/issues/27594), 2026; anomalyco, [issue: cache key de compresión divergente](https://github.com/anomalyco/opencode/issues/43249), 2026. Son incidencias públicas, no hechos generales garantizados.
3. OpenAI, [Codex App Server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md), consultada en septiembre de 2026.
4. Cline, [Task management](https://github.com/cline/cline/blob/main/docs/core-workflows/task-management.mdx), consultada en septiembre de 2026.
5. Continue, [How Agent Mode Works](https://github.com/continuedev/continue/blob/main/docs/ide-extensions/agent/how-it-works.mdx), consultada en septiembre de 2026.
6. Browser Use, [agent service](https://github.com/browser-use/browser-use/blob/main/browser_use/agent/service.py), consultada en septiembre de 2026.
