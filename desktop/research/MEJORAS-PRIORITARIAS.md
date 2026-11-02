# Mejoras prioritarias tras la auditoría de septiembre de 2026

## Correcciones aplicadas en esta revisión

1. **Capturas de escritorio sin inflación de estado.** Antes, una captura quedaba como una URL `data:` dentro de mensajes persistentes. Eso podía multiplicar el tamaño de `workspace.json`, transcript, checkpoints e IPC. Ahora el binario se conserva bajo `tasks/<id>/attachments/` y el historial sólo mantiene un descriptor. Se lee y se convierte en imagen únicamente en la llamada de visión que la necesita.
2. **Resultados de imagen correctamente registrados.** La ruta que recibe una imagen cierra el efecto cuando la herramienta tiene un efecto asociado. `desktop_screenshot` es una lectura y no crea por sí misma un efecto externo.
3. **Citas web estructuradas.** Las anotaciones de URL de streaming se convierten en fuentes seguras y visibles. No dependen exclusivamente de que el modelo haya escrito Markdown correcto; los enlaces no HTTP/HTTPS se descartan.

## Siguiente bloque recomendado

| Prioridad | Mejora | Motivo y criterio de aceptación |
| --- | --- | --- |
| P0 | I/O fuera del proceso principal y carga parcial | B1 limita el detalle al chat visible y B2 añade SQLite opcional con escrituras por registro. Queda evitar recorridos completos del chat activo, cargar páginas desde disco y trasladar escrituras/copias a un trabajador, conservando confirmación durable. El modo JSON sigue reescribiendo el estado. |
| P1 | Restauración integral y mediciones de carga | B2 verifica migración, copias, exportación, reinicio y caída durante una transacción. B3 recupera el estado en una carpeta aislada desde la interfaz, sin activarlo ni copiar binarios. Faltan recuperación integral/activación y medidas p95/memoria con streams simultáneos. No confundir recuperación tras caída del proceso con resistencia a cortes eléctricos. |
| P0 | Completar lectores de adjuntos | Selector, vista previa, hash, texto por partes, imágenes, comprobación de visión y borradores persistentes ya implementados. Pendientes: extractores PDF/Office, audio/vídeo y administración de copias huérfanas. Verificar capacidad y coste de cada adaptador antes de activarlo. |
| P1 | Navegador con DOM/ARIA por tarea | La automatización web por píxeles cuesta más y es frágil. Un navegador aislado con URL, selectores, árbol de accesibilidad, descargas y captura de respaldo hará la mayoría de tareas más verificables y baratas. |
| P1 | Catálogo de capacidades por modelo | Además de tools/visión/thinking, mostrar y validar entrada de PDF, audio, vídeo, tamaño de contexto efectivo y herramientas de servidor. El selector debe explicar incompatibilidades antes de iniciar una tarea, no fallar después. |
| P1 | Plan durable, diffs y worktrees | Cada tarea de código debe tener objetivo, criterios de aceptación, plan actual, `git status`, diff y prueba más reciente. Los worktrees permiten paralelismo real sobre el mismo repositorio sin la exclusión actual por carpeta. |
| P1 | Laboratorio de evaluaciones | Guardar tareas de referencia, modelo/proveedor, coste, caché, latencia, resultado y verificación. Así las sugerencias dinámicas se basan en tus propios trabajos, no sólo en rankings de catálogo. |
| P2 | Memoria con recuperación selectiva | Convertir los checkpoints, documentos de progreso y artefactos en un índice local por proyecto. Recuperar pocos fragmentos con fuente y fecha evita fijar mensajes grandes y protege el cache hit. |
| P2 | Alertas de coste, no bloqueos | El usuario no quiere límites obligatorios. Añadir previsión, aviso configurable y explicación de la causa de coste (input, cache, salida, web, thinking), sin detener una tarea por defecto. |
| P2 | Importador OpenAPI + OAuth | Generar conectores desde OpenAPI, con paginación, pruebas de conexión y OAuth PKCE/device flow almacenado en vault. Mantener idempotencia y conciliación de efectos. |

## Riesgos que no conviene ocultar

### Ronda del 17 de septiembre: UI y streaming

Implementados: suavizado visual acotado con preferencia de movimiento reducido; Markdown memoizado y tablas sin remontaje en cada snapshot; copia de mensaje/código; lenguaje visible en bloques; editor autoajustable; pausa directa; seguimiento de lectura controlado con «Volver al final»; estética blanca más uniforme. Las respuestas recuperadas llevan marca de incompletas y no se reinyectan como instrucciones ni se reproducen sus herramientas.

La recuperación del último stream usa un registro incremental independiente de `workspace.json`. Probada con terminación forzada de un proceso hijo, cola truncada, reintentos, errores de disco y deduplicación. No persiste razonamiento interno ni credenciales. Se ha añadido información de compresión que distingue ahorro de tokens de crecimiento; en chats cortos informa sin bloquear la acción.

Verificación actual: 105 pruebas locales y 67 comprobaciones de interfaz. Una llamada adicional real de DS4.1 Flash costó 0,00046215 USD. Próxima prioridad visual: medir navegación y renderizado con historiales grandes antes de introducir virtualización, preservando selección de texto, anclas y búsqueda. Los cambios de esta ronda no prueban todavía ese rendimiento a gran escala.

### Ronda del 17 de septiembre: recuperación y pausa

Implementados: borradores persistentes independientes del historial; referencias a adjuntos y carpetas recuperables; revisiones para evitar sobrescrituras tardías; cierre normal que espera guardados; estado visual y reintento. Corregidas las colas de seguimientos e imágenes que podían persistirse como consumidas y pendientes a la vez. La reanudación completa los resultados de herramientas interrumpidas antes de incorporar imágenes y nuevas instrucciones, sin repetir la acción externa.

Las compresiones manuales admiten pausa y cancelación al cerrar. Una respuesta tardía no sustituye el contexto después de cancelar. Los seguimientos enviados mientras se comprime quedan en cola en lugar de entrar en el historial que va a sustituir el checkpoint.

Limitaciones: el cierre forzado puede perder una edición que aún no haya llegado al proceso principal. El envío y la limpieza del borrador son dos operaciones; no se promete entrega exactamente una vez si el proceso muere entre ellas. La migración del historial completo a persistencia incremental sigue pendiente; no se ha resuelto por guardar los borradores en archivos separados.

### Ronda del 13 de septiembre

Corregidos: enlaces de chat bloqueados por la navegación de Electron; actualizaciones descartadas por la caché de mensajes; tablas anchas sin contenedor; timeout por actividad no textual; reintentos que ocultaban intentos anteriores; costes borrados entre tramas; calibración contaminada por base64; recuperación ignorada si faltaba el archivo principal; ajustes parcialmente aplicados al fallar una validación; compresiones manuales simultáneas. Se añadieron copia de código, paginación de llamadas y aislamiento automático de las pruebas visuales.

Verificación: 67 pruebas locales y 28 comprobaciones de interfaz. Cero llamadas de inferencia de pago en esta ronda. La migración completa de persistencia, el navegador DOM y los adjuntos del usuario siguen pendientes.

- Un límite de salida de `0` es correcto como valor sin tope propio, pero cada proveedor conserva su propio máximo y puede terminar con `length`. La interfaz debe distinguir siempre ese corte de una tarea completada.
- La métrica de búsquedas web puede no venir en el stream del proveedor. Es mejor mostrar «no reportado» que estimar un número.
- Los modelos de visión, herramientas y razonamiento no son intercambiables. Una elección automática futura debe declarar por qué eligió modelo y proveedor, y permitir revertir la decisión.
- El modo autónomo elimina confirmaciones por acción, no la necesidad de diario de efectos, copias de archivos, idempotencia y conciliación. Esas protecciones permiten reanudar sin duplicar operaciones reales.
