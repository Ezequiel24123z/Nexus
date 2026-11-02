# Web y adjuntos: estado y ruta de entrega

## Web integrado

NEXUS usa `openrouter:web_search`, una herramienta de servidor: el modelo decide cuándo buscar, OpenRouter ejecuta la consulta y devuelve URL, título y fragmentos para que el modelo cite sus fuentes. La interfaz permite elegir motor, detalle, resultados y búsquedas por llamada. El modo `auto` usa búsqueda nativa cuando el proveedor la admite y Exa como respaldo.

La prueba real con DS4.1 Flash devolvió fuentes en Markdown. Ese stream no incluyó `server_tool_use.web_search_requests`, por lo que la interfaz no inventa un contador y lo deja como no reportado. Los costes de modelo sí quedan en la telemetría.

Fuente: [OpenRouter Web Search Server Tool](https://openrouter.ai/docs/guides/features/server-tools/web-search).

## Adjuntos: entrega por modalidades verificables

| Tipo | Ruta propuesta | Estado |
| --- | --- | --- |
| Imágenes PNG/JPEG/WebP/GIF | Copia local, vista previa y `image_url` al enviar; comprobación de visión con catálogo | Implementado; probado con peticiones simuladas y vista previa real Electron |
| PDF | `file` con data URL; conservar anotaciones para no reprocesar | Siguiente implementación |
| Audio | `input_audio` con base64 y formato | Siguiente implementación |
| Vídeo | `video_url`, sujeto al proveedor | Siguiente implementación |
| Texto UTF-8, código, CSV, JSON | Copia local, vista previa y lectura por fragmentos de hasta 24.000 bytes | Implementado; probado en bucle de herramientas, compresión y reinicio |
| DOCX, XLSX, PPTX y formatos propietarios | Extracción local por tipo + adjunto original cuando el proveedor lo admita | Requiere validación por formato |

OpenRouter documenta contenido multimodal para imágenes, PDF, audio y vídeo, pero no afirma que cualquier formato de oficina binario se interprete de forma universal. NEXUS implementará cada adaptador con pruebas y una vista de lo que se envía, en lugar de prometer soporte ficticio de “todos los archivos”.

### Entrega de adjuntos del 13 de septiembre

El botón «Adjuntar archivos» permite seleccionar varios originales. La interfaz muestra nombre, tamaño y tratamiento: visión, lectura por partes o archivo local que requiere extracción. Cada archivo se copia con ID y SHA-256 bajo `uploads/<id>/`; los mensajes sólo conservan metadatos y referencias. La selección por sí sola no hace una llamada de inferencia.

El agente puede listar y recuperar los adjuntos mediante `list_attachments` y `read_attachment`, incluso después de una compresión. Los chats sin proyecto reciben una carpeta de trabajo propia. Los archivos genéricos se conservan y se pueden procesar mediante herramientas locales; adjuntar un PDF, Office, audio o vídeo no equivale todavía a extraer automáticamente su contenido.

Desde la revisión del 17 de septiembre, los borradores de texto, referencias a archivos y carpeta se guardan por chat y por nuevo chat de proyecto bajo `drafts/`, sin reescribir el historial al teclear. Se recuperan al abrir la aplicación; el estado de guardado es visible y los fallos permiten reintentar. El cierre normal espera los guardados pendientes. Quitar un adjunto del borrador lo desvincula del próximo envío; la copia local se conserva. No hay todavía limpieza automática de adjuntos huérfanos.

La compatibilidad de visión se comprueba en el catálogo antes de enviar. Si falta o el modelo sólo admite texto, la operación explica el problema y conserva el borrador. El envío sigue el formato documentado por [OpenRouter Image Inputs](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding). La comprobación de catálogo no garantiza que todo proveedor concreto acepte cualquier tamaño o cantidad de imágenes.

Validación: 76 pruebas automatizadas totales y 38 comprobaciones Electron; cero llamadas de inferencia de pago en esta ronda. El selector nativo se simula en el smoke, pero la copia, las vistas previas, el puente de Electron, el envío, los cambios de chat y el historial usan los componentes reales. La validación de visión contra un proveedor real sigue pendiente.

Fuente: [OpenRouter Multimodal Capabilities](https://openrouter.ai/docs/guides/overview/multimodal/overview), [OpenRouter PDF Inputs](https://openrouter.ai/docs/guides/overview/multimodal/pdfs).
