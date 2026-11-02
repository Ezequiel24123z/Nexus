# NEXUS — investigación y decisiones de producto
Fecha de revisión: 12 de septiembre de 2026.

## Resultado y alcance

Se han clonado trece bases públicas para inspeccionar módulos concretos y sus licencias, sin instalar ni ejecutar esas aplicaciones. Las copias están en D:/Agents/desktop/research/sources y no entran en el ejecutable ni en Git del producto. inventory.json fija los commits consultados.

La selección cubre asistentes locales, agentes de programación, automatización del navegador, memoria, orquestación y clientes de chat. No es una auditoría exhaustiva de todo su código ni una prueba comparativa de rendimiento. «El mejor» debe comprobarse con tareas del usuario, no deducirse del número de botones.

Se interpreta la referencia del usuario «Verdant» como **Verdent**, por su descripción de agentes de programación paralelos. No se presupone que otro producto de nombre similar sea el mismo.

## Bases públicas inspeccionadas

| Proyecto y licencia raíz observada | Módulo consultado | Decisión para NEXUS |
| --- | --- | --- |
| [Codex](https://github.com/openai/codex), Apache-2.0 | codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams.ts y TurnStartParams.ts | Integración oficial de motor separada de nuestra UI. Cuenta ChatGPT aplazada, no simulada con una API key. |
| [OpenCode](https://github.com/anomalyco/opencode), MIT | packages/opencode/src/session/compaction.ts | Separar historial original de contexto activo y respetar los turnos al compactar. NEXUS conserva originales y reinyecta la última instrucción. El podado avanzado por presupuesto sigue pendiente. |
| [Cline](https://github.com/cline/cline), Apache-2.0 | apps/cli/src/utils/usage-cost-display.ts | Separar coste monetario de consumo cubierto por suscripción; nunca inventar precio de ChatGPT. La inspección de este módulo fue limitada, no de todo su motor. |
| [Roo Code](https://github.com/RooCodeInc/Roo-Code), Apache-2.0 | src/shared/modes.ts | Perfiles configurables de agentes como siguiente capa. El repositorio está archivado; sirve como referencia histórica, no como dependencia mantenida. |
| [Goose](https://github.com/block/goose), Apache-2.0 | crates/goose/src/context_mgmt/mod.rs y agents/extension_manager.rs | Contabilizar la llamada de compresión y diferenciar contexto retenido de tokens consumidos. Herramientas MCP descubiertas bajo demanda; no volcar todos los esquemas al prompt inicial. |
| [Continue](https://github.com/continuedev/continue), Apache-2.0 | core/llm/rules/getSystemMessageWithRules.ts | Instrucciones globales y por proyecto. Reglas por ruta/glob quedan pendientes; no se afirma haberlas incorporado. |
| [OpenHands](https://github.com/OpenHands/OpenHands), MIT en raíz | src/routes/condenser-settings.tsx y src/utils/sdk-settings-schema.ts | Configuración accesible desde UI, con separación básica/avanzada. No reutilizar automáticamente componentes con licencias distintas en otros subdirectorios. |
| [Aider](https://github.com/Aider-AI/aider), Apache-2.0 | aider/history.py | Compresión con continuidad verificable. La selección de otro modelo para resumir y resumen recursivo de historiales enormes quedan pendientes. |
| [Open Interpreter](https://github.com/OpenInterpreter/open-interpreter), Apache-2.0 en este snapshot | README.md, secciones Harness Emulation, ACP y Computer Use | En esta revisión es un fork de Codex orientado a distintos motores, no el antiguo diseño que podría recordarse de versiones previas. Priorizar formatos portables y adaptadores frente a fusionar motores enteros. |
| [Browser Use](https://github.com/browser-use/browser-use), MIT | browser_use/tokens/service.py | Registro de uso por llamada y separación de coste conocido frente a estimaciones. Automatización DOM específica pendiente; MCP permite conectar herramientas compatibles sin afirmar que ya exista un navegador integrado. |
| [LibreChat](https://github.com/danny-avila/LibreChat), MIT | api/server/routes/projects.js y client/src/Providers/BookmarkContext.tsx | Proyectos con chats propios, fijados y gestión visual. Implementación local propia, sin introducir su servidor multiusuario. |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent), MIT | tools/session_search_tool.py y tools/memory_tool_store.py | Recuperar mensajes originales, no depender solo de resúmenes. NEXUS añade búsqueda literal del historial actual; búsqueda semántica entre sesiones y memoria curada todavía pendientes. |
| [OpenClaw](https://github.com/openclaw/openclaw), MIT | src/hooks/bundled/compaction-notifier/handler.ts y src/cron/service.ts | Mostrar contexto anterior/posterior a la compresión y distinguir cola interactiva de trabajos programados. El servicio de programación con app cerrada aún no está implementado. |

No se ha transplantado código de estos trece motores a NEXUS: se han copiado sus repositorios para análisis y se han implementado las funciones locales de forma propia. La reutilización directa de una dependencia sí se hace mediante el SDK oficial MCP y eventsource-parser; sus licencias y las de las demás dependencias permanecen en los paquetes.

Las licencias citadas son las encontradas en la raíz del commit, no una autorización genérica sobre marcas, recursos gráficos, servicios hospedados o cualquier submódulo. Si se incorpora un fragmento externo en el futuro, registrar archivo, commit, licencia, atribución y cambios en un archivo de avisos. Que el uso sea personal no sustituye revisar la licencia.

## Productos cerrados: documentación, no código inventado

- [Verdent](https://www.verdent.ai/): interesa su organización por objetivos y trabajo paralelo. La página oficial describe estas capacidades; no se ha localizado ni copiado un motor público completo. Sus afirmaciones comerciales no se usan como resultado de una prueba propia.
- [Cursor: agentes en segundo plano](https://prod.cursor.com/help/ai-features/background-agents): referencia para trabajos prolongados y seguimiento. Su ejecución remota aislada no equivale a nuestra ejecución local.
- [Cursor: checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints): inspiración para recuperar cambios. Las copias de NEXUS cubren escrituras de sus herramientas, no todos los efectos de comandos o APIs.
- [Windsurf: Memories y Rules](https://docs.windsurf.com/es/windsurf/cascade/memories): separación entre instrucciones duraderas y recuerdos automáticos.
- [Claude Code: funcionamiento](https://code.claude.com/docs/en/how-claude-code-works): revisar cambios y recuperar archivos es distinto de controlar permisos. No se copia una implementación privada.

## Cuenta de ChatGPT frente a OpenRouter

La solicitud del usuario es utilizar la cuenta y su consumo de suscripción, no una clave API de OpenAI.

La documentación oficial de [Codex App Server](https://learn.chatgpt.com/docs/app-server) ofrece comunicación JSON-RPC, inicio de sesión con ChatGPT y operaciones de tareas/turnos. La [documentación de autenticación](https://learn.chatgpt.com/docs/auth) distingue los modos de autenticación. Esto permitiría un adaptador de Codex, sujeto a cuenta, plan, modelos y límites compatibles; no convierte ChatGPT en una API genérica para todos sus modelos.

**Decisión actual:** centrarse en OpenRouter. No extraer cookies ni tokens de sesiones, no simular autenticación, no prometer que ChatGPT está conectado. La integración de suscripción requiere desarrollo y pruebas propios y está marcada como pendiente dentro de Configuración.

## Telemetría: qué significa cada número

Según [OpenRouter Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), las respuestas aportan uso y coste cuando están disponibles. NEXUS registra cada intento y conserva los datos reportados, incluidos los resúmenes:

- Coste de sesión: suma conocida de llamadas de ese chat.
- Último turno: llamadas desde la última ejecución de una instrucción, incluyendo pasos de herramientas y compresión.
- Última llamada: una única petición al modelo.
- Cache hit: tokens leídos de caché divididos por tokens de entrada de las llamadas que informan ambos valores; ponderado por tokens, no promedio de porcentajes.
- Cobertura de caché: proporción de llamadas con información suficiente para calcular esa tasa.
- Contexto actual y anterior/posterior a compresión: estimaciones locales, diferenciadas del uso acumulado.
- Entrada, salida, llamadas, compresiones y tiempo acumulado de espera.
- Una llamada fallida o interrumpida sin facturación reportada queda con coste desconocido. El total se etiqueta parcial; no se presenta como gratuito.

El [endpoint de créditos](https://openrouter.ai/docs/api/api-reference/credits/get-credits) necesita una clave de administración. El saldo es créditos totales menos uso total. El [endpoint de la clave actual](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key) devuelve el límite disponible de esa clave: es otro concepto y la UI no lo sustituye por el saldo global.

El [streaming de OpenRouter](https://openrouter.ai/docs/api_reference/streaming) puede terminar con un error después de HTTP 200 y entrega el uso al final. NEXUS procesa ambos casos, espera a completar las llamadas antes de ejecutarlas y conserva texto interrumpido como parcial. Cancelar localmente no garantiza detener la facturación en todos los proveedores.

## Implementado en esta revisión

- App de escritorio Electron, interfaz blanca local, sin depender de la web publicada.
- Autonomía predeterminada sin confirmación por acción; pasos ilimitados por defecto.
- Lectura y edición de archivos, reemplazo exacto, copias previas, PowerShell, capturas y teclado/ratón.
- Proyectos, instrucciones propias, chats asociados, búsqueda de chats, fijar chats y mensajes.
- Renombrar chats, mover su asociación de proyecto y elegir su modelo desde la UI.
- Instrucciones globales editables; slider 10–95%; reserva de contexto para respuesta.
- Diario, historial original, checkpoints, búsqueda literal del historial y última instrucción retenida.
- Cola, lotes paralelos o secuenciales, dependencias, pausa y reanudación.
- Telemetría real reportada, costes parciales explícitos y panel de saldo.
- Conectores REST y almacén cifrado de secretos.
- Extensiones MCP stdio y Streamable HTTP, catálogo bajo demanda, conexión/desconexión desde UI. Prueba local de protocolo con proceso real. No se ha probado cada servidor externo ni OAuth.
- Respuestas de texto en tiempo real, reconstrucción de herramientas fragmentadas y detección de interrupciones.

## Prioridades pendientes para una app de uso diario sólida

1. Ampliar la validación real ya realizada con DS4.1 Flash (herramientas, caché, compresión y cola) a tareas visuales, imágenes, otros modelos y APIs concretas elegidas por el usuario.
2. Git worktrees por tarea y revisión/recuperación visual de cambios: permitir agentes sobre el mismo repositorio sin pisarse.
3. Planes editables, roles y recetas reutilizables, memoria compartida por proyecto con referencias a las fuentes.
4. Navegador automatizado con DOM/accesibilidad, adjuntos y documentos; soporte multimodal completo de resultados MCP.
5. Conectores con OAuth, cabeceras/esquemas de autenticación adicionales e importación OpenAPI.
6. Servicios programados, ejecución con app cerrada, actualización e instalador firmados.
7. Adaptador de suscripción de Codex, si sigue interesando después de consolidar OpenRouter.

## Cómo verificar la aspiración de “mejor”

Proponer una batería reproducible de tareas personales: reparación de un proyecto con tests, organización de archivos, conector API, flujo visual de escritorio, cadena de tres tareas y conversación larga forzada a comprimir. Medir resultado correcto, regresiones, coste, tiempo, intervenciones, recuperación después de interrupción y conservación de decisiones. Usar los mismos modelos y condiciones donde sea posible.

Esta revisión no contiene un benchmark comparativo de otros productos ni puede garantizar ausencia absoluta de pérdida semántica. El diseño prioriza evidencia recuperable, control del usuario y ampliación por conectores.
