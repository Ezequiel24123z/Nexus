# Estado y próximos pasos

Incorporación a GitHub: 2 de noviembre de 2026. Estado reconstruido a partir del código y los informes locales. Las comprobaciones actuales figuran en [VALIDACION.md](VALIDACION.md).

## Implementado en Desktop

- Chats/proyectos, instrucciones globales y por proyecto, tareas con dependencias y exclusión por carpeta.
- OpenRouter y Arli.ai; catálogo, configuración por chat, streaming y reasoning cuando el proveedor lo entrega.
- Diagnóstico de transporte y reintento acotado antes de producir salida; conservación de respuestas parciales.
- Archivos, comandos, herramientas Windows, REST, MCP e importación parcial de OpenAPI 3.0/3.1.
- Adjuntos de texto/imágenes, referencias recuperables y borradores persistentes.
- Compresión, checkpoints, búsqueda de historial, artefactos y recuperación de respuestas interrumpidas.
- Telemetría, inspector de contexto/caché/coste y suscripción paginada al chat visible.
- JSON, SQLite opcional, exportación y recuperación a carpeta independiente.
- Biblioteca local de capacidades y funciones con carga bajo demanda.

## Límites vigentes

Validar una clave o consultar el catálogo no prueba disponibilidad de generación. Los parámetros y capacidades dependen del proveedor: la búsqueda nativa de OpenRouter no se envía a Arli.ai.

El control nativo requiere Windows y sigue pendiente validar una misión visual completa con un modelo real. SQLite reduce escrituras, pero mantiene operaciones síncronas y carga del historial en memoria. La recuperación de estado no restaura automáticamente adjuntos, proyectos, credenciales y borradores como un paquete integral.

OpenAPI tiene compatibilidad limitada de autenticación, esquemas y serialización; importar no ejecuta peticiones. MCP todavía no incluye OAuth automático, SSE legado ni representación multimodal completa. No se ha implementado un adaptador de sesión/suscripción de ChatGPT, actualizador firmado ni ejecución programada garantizada con la app cerrada.

Los informes históricos pueden mencionar adjuntos o skills como pendientes de versiones anteriores: contrastar con el código actual y el alcance real de esas entregas. Sus pruebas y catálogos corresponden a fechas concretas.

## Próximas entregas

Conservar los criterios de la [hoja de ruta aprobada](../desktop/research/HOJA-DE-RUTA-APROBADA-2026-09-19.md), comprobando primero qué partes ya están implementadas.

| Línea | Siguiente resultado verificable |
| --- | --- |
| Contexto, caché y gasto | Cerrar verificación y medir coste por tarea antes de afirmar ahorro por afinidad |
| Conectores visuales | Formularios por contrato, previsualización y prueba explícita de peticiones |
| Memoria de proyecto | Entradas editables con origen, fecha, ámbito y recuperación tras compresiones |
| Escala | Historial parcial desde disco, I/O fuera del proceso principal y medidas concurrentes |
| Skills y recetas | Importación/exportación versionada con revisión de cambios |
| Interfaz | Regresiones de teclado, foco, lectura de streaming y estados de recuperación |
| Navegador/documentos | Navegación por tarea y adaptadores PDF/Office con referencias reutilizables |

Worktrees, revisión de diffs, planes durables y comparación de modelos aparecen también en las auditorías: son propuestas, no funciones terminadas.

Primera tarea sugerida: reproducir instalación/pruebas/compilación, comparar este estado con la hoja original y elegir una mejora pequeña con un criterio de aceptación. La exportación no modifica el comportamiento del agente.
