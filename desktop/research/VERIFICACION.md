# Verificación de la revisión local

Última revisión: 19 de septiembre de 2026. Plataforma: Windows, Electron 44.3.0, React 19.2.6, Vite 8.3.0.

## Resultados

Última ampliación: importador OpenAPI local con selección y contratos bajo demanda, más correcciones de respuestas REST vacías/UTF-8. [Informe y límites](OPENAPI-2026-09-19.md). Evidencia actual: `test-results/openapi-2026-09-19/smoke/`. Esta ronda no gastó saldo ni usó control de escritorio.

| Comprobación | Resultado |
| --- | --- |
| Pruebas automatizadas del motor, memoria, telemetría, streaming, adjuntos, biblioteca, OpenAPI, borradores, almacenamiento, lanzador y MCP | 171 aprobadas, 0 fallos |
| Construcción del cliente local | Correcta |
| Interfaz Electron con datos aislados y renderizado fuera de pantalla | 149 comprobaciones aprobadas |
| Desbordamiento horizontal | No observado a 1500 px ni a 940 px de contenido en esta ronda |
| Auditoría de dependencias de producción | 0 vulnerabilidades reportadas en la revisión anterior; no repetida el 17 de septiembre |
| Auditoría incluyendo desarrollo | 0 vulnerabilidades reportadas en la revisión anterior; no repetida el 17 de septiembre |
| MCP stdio con proceso local real de prueba | Conecta, descubre, invoca y cierra correctamente |
| Peticiones reales a DeepSeek V4.1 Flash mediante OpenRouter | Aprobadas: herramientas, streaming, caché, compresión y cola |
| Techo operativo de contexto real | Compresión validada con máximo de 39.777 tokens de entrada por llamada, bajo el límite configurado de 50.000 |
| Caché de prefijo real | Tras añadir el catálogo de artefactos: 98,93–99,20% en cuatro reutilizaciones; 96,09% ponderado en cinco llamadas |
| Planificador real | Dos tareas independientes comenzaron con 32 ms de diferencia; una tercera esperó la dependencia (8,38 s) |
| Salida nativa real de DS4.1 Flash | Aprobada: llamada sin `max_tokens`, 2.894 tokens de entrada, 9 de salida y 0,000879 USD |
| Compresión refinada real de DS4.1 Flash | Aprobada: 72.561 → 4.167 tokens estimados, continuidad correcta, 4 llamadas, 40,4% cache hit y 0,012787 USD |
| Búsqueda web real de DS4.1 Flash | Aprobada: una llamada completada con fuentes Markdown; 8.907 tokens de entrada, 348 de salida, 0,008961 USD. El proveedor no reportó el contador de búsquedas en el stream. |
| Saldo real de OpenRouter | No verificado; endpoints probados con respuestas simuladas |
| Control visual completo de Windows por un modelo | Pendiente |
| Instalador final de esta revisión | No empaquetado; se mantiene la revisión previa al empaquetado |

## Cobertura relevante

19 de septiembre: biblioteca local de skills y funciones con revisiones, edición visual y descubrimiento bajo demanda; catálogos REST/MCP paginados, snapshots de REST sin definiciones completas, navegación Ctrl+K, movimiento reducido y densidad persistente. Corregidos foco inicial de diálogos, recorrido de textareas y acceso permanente a Configuración en la barra lateral. Pruebas sintéticas con 10.000 metadatos y ejecución de funciones con aprobación/denegación; no se hicieron llamadas reales al modelo. [Informe y límites](UI-BIBLIOTECA-2026-09-19.md).

Ronda B3: asistente de revisión y recuperación de estado JSON/SQLite en carpeta independiente, ejecutado en un trabajador. No activa la copia ni modifica el almacén abierto. Valida estructura/hash, bloquea destinos internos, pausa tareas interrumpidas y verifica lo escrito. Corregidas lecturas SQLite que podían mezclar revisiones y el arranque sobre un candidato de recuperación incompleta. Cero inferencia de pago. [Informe y límites](RONDA-B3-2026-09-18.md); evidencia en `test-results/ronda-b3-2026-09-18/smoke/`.

Ronda B2: SQLite opcional con migración verificada y conservación de originales, transacciones, copias consistentes y exportación actual. Probados caída de proceso durante una transacción, fallos de activación, escritor obsoleto, historial posterior a la migración e importación con respaldo del estado correcto. Continúa siendo síncrono y cargando todo el historial en memoria. Cero inferencia de pago; no se migraron datos reales. [Informe y límites](RONDA-B2-2026-09-18.md). Evidencia de interfaz: `test-results/ronda-b2-2026-09-18/smoke/`.

Ronda B1: suscripción al chat visible; las demás tareas sólo envían metadatos de navegación y cola. En vistas generales no se envían historiales. Pruebas de cambio de chat y de no acceso al historial de segundo plano. En el fixture de 100 chats, el JSON bajó de 10.809.212 a 123.053 bytes con un chat abierto (98,86%); no es una medida del rendimiento total de la app. [Informe y límites](RONDA-B1-2026-09-18.md).

Ronda A: selector de modelo/thinking y preferencia de proveedor por chat, favoritos persistidos, búsqueda paginada en todo el historial y panel de resultados registrados con vistas previas acotadas. Probados por IPC y controles reales: búsqueda de mensajes fuera del snapshot, navegación al origen, envío desde historial, aislamiento de ajustes, foco al cerrar y actualización del payload del proveedor con peticiones simuladas. **Cero inferencia de pago** y sin control de escritorio. Véanse [alcance, limitaciones y medición](RONDA-A-2026-09-17.md) y `test-results/ronda-a-2026-09-17/smoke/`.

Ronda de UI/streaming: suavizado acotado de fragmentos, Markdown memoizado con componentes estables, desplazamiento horizontal de tablas conservado, seguimiento del final sin interrumpir la lectura, editor multilínea autoajustable y pausa junto al envío. Se verificaron fragmentos cortos y grandes, retorno al final, crecimiento del editor, etiqueta de respuesta recuperada y avisos de compresión. Capturas revisadas a 940 px; comprobación de ancho también a 1500 px. Evidencia: `test-results/revision-ui-2026-09-17/smoke/`; [informe de la ronda](UI-Y-CALIDAD-2026-09-17.md).

Recuperación de respuesta en curso: diario incremental por tarea para texto e identificador/uso reportado por el proveedor. Una prueba termina forzosamente un proceso hijo real durante un stream simulado y verifica recuperación sin ejecutar argumentos de herramientas incompletos ni duplicar la respuesta al volver a abrir. Prueba adicional real con DS4.1 Flash: 1 llamada, 3.049 tokens de entrada, 8 de salida, **0,00046215 USD**; sin `max_tokens`, identificador preservado y respuesta final no duplicada. Informe: `test-results/revision-stream-recovery-2026-09-17/live.json`. Ese coste es adicional a la ronda real anterior detallada debajo. Las pruebas de UI no consumieron inferencia ni usaron control de escritorio.

Tras autorizar pruebas con saldo se ejecutó una ronda real en segundo plano con DS4.1 Flash: recuperación/adjuntos/cola (14 llamadas) y compresión automática (4 llamadas). Pasó de 72.801 a 4.681 tokens estimados; máximo de entrada por petición: 34.626. Total confirmado, incluyendo el intento previo interrumpido: 0,0272046568 USD más una llamada de coste no reportado. Detalles y evidencias en [Pruebas reales del 17 de septiembre](PRUEBAS-REALES-2026-09-17.md). Las cifras anteriores de DS4.1 en la tabla identifican ensayos históricos.

Ronda local del 17 de septiembre, anterior a la autorización de pruebas con saldo: **cero llamadas de inferencia de pago**. Borradores persistentes de texto, adjuntos y carpeta; protección frente a escrituras tardías; recuperación de copia local; error de guardado/reintento y barrera de cierre. La suite verifica que teclear no modifica `workspace.json`. La prueba Electron recarga la ventana antes y después del envío y comprueba texto y referencias, no sólo su aspecto.

Se verifican cola de seguimientos persistida tras cada consumo, restitución en memoria si falla el guardado, orden válido de resultados de herramientas/imágenes/instrucciones al reanudar, pausa/cierre durante compresión, respuesta tardía tras cancelar y seguimiento recibido durante el checkpoint. El botón «Pausar compresión» se ejerce contra un proveedor simulado abortable a través del puente real de Electron. Una tarea fallida antes de contactar con el proveedor deja de mostrar actividad de trabajo. Las respuestas de generación recibidas después de pausar se conservan como interrumpidas, no como tareas completadas.

Evidencia de esta ronda: `test-results/revision-recovery-2026-09-17/`. Las capturas usan el renderer Electron fuera de pantalla para evitar imágenes antiguas de una ventana oculta; la aplicación normal conserva su ventana nativa. Se comprueba también el tamaño completo de cada captura. El proceso de prueba termina correctamente mediante el cierre normal. No se ha probado una caída del sistema operativo ni la durabilidad ante corte eléctrico; el envío y el borrado del borrador no son una transacción única.

Ronda de adjuntos: selección múltiple, copia local con SHA-256, previsualización de imágenes/texto, lectura paginada UTF-8, recuperación tras compresión/reinicio y borradores separados por chat. Se verificó también que `openExternal` atraviesa realmente el preload y llega a la validación del proceso principal; faltaba incluirlo en la lista del puente. Evidencia reciente: `test-results/revision-attachments-2026-09-13/`. El diálogo de selección se sustituye durante la prueba por rutas de archivos sintéticos; el resto del flujo es real. Las imágenes se verificaron localmente, sin inferencia visual pagada.

La ronda del 13 de septiembre tampoco usó llamadas de inferencia de pago. Las cifras históricas de DS4.1 de la tabla corresponden a pruebas anteriores; la nueva ronda de pago del 17 de septiembre se detalla arriba y en su informe propio. Los resultados de estabilidad anteriores están en `test-results/revision-stability-2026-09-13/`.

- Un chat no puede compactarse dos veces a la vez; el planificador espera si existe una compresión manual en curso.
- Heartbeats, argumentos de herramientas y reasoning mantienen vivo el temporizador del stream. Una respuesta que ya empezó a generar no se reintenta automáticamente tras un corte.
- Cada reintento tiene registro de uso y latencia separado; un coste desconocido no desaparece detrás de una llamada exitosa. Uso recibido en varias tramas se combina sin borrar costes previos.
- Los adjuntos cuentan como imágenes al estimar la cola reciente; sus bytes no calibran el ratio de texto. Las estimaciones no leen archivos binarios y la compresión de capturas heredadas excluye base64.
- La recuperación consulta temporales y copias cuando falta el archivo principal o su JSON tiene estructura inválida.
- Actualizaciones de ajustes inválidas no aplican cambios parciales. Los snapshots incluyen hasta 80 llamadas, con total y recuperación paginada.
- Enlaces HTTP/HTTPS se abren mediante el sistema; tablas GFM tienen desplazamiento local, el código tiene botón de copia y los mensajes cargados aceptan actualizaciones posteriores.
- `--smoke-test` crea automáticamente un almacén temporal nuevo e impide importar historial y credenciales del usuario, incluso si se omite la variable de entorno de pruebas.

- Autonomía predeterminada, sin máximo de pasos y escritura fuera de la carpeta con copia previa.
- Modo opcional con confirmaciones, si el operador lo activa.
- Instrucciones globales/proyecto, fijados y última instrucción conservados después de compresión y reinicio.
- Resúmenes contabilizados como llamadas; costes conocidos separados de los no reportados.
- Cache hit ponderado por tokens, con cobertura explícita.
- Clave de administración separada de clave de inferencia para consultar saldo.
- Pausa de procesos, reanudación sin repetir llamadas incompletas y cola con dependencias/exclusión por carpeta.
- Unicode y JSON fragmentados en streaming, comentarios SSE, uso final e interrupciones.
- Respuesta truncada por el proveedor retenida como parcial, nunca declarada terminada.
- Conexión MCP real de prueba y validación de parámetros/referencias a secretos.
- DS4.1 Flash probado con `reasoning: none`: cero tokens de razonamiento informados en las ejecuciones de coste bajo.
- La compresión por bloques conserva el transcript/checkpoint original y obtuvo un contexto posterior estimado de 4.107 tokens tras partir de 71.667.
- Resultados externos grandes se guardan como artefactos locales con hash y lectura paginada; no se reinyectan íntegros en la conversación ni el diario visible.
- Los snapshots del interfaz se acotan a 120 mensajes y 80 eventos por tarea; el historial completo se carga en páginas bajo demanda.
- Los efectos externos tienen ciclo durable (`intended`, `dispatched`, `observed`, `uncertain` y conciliación con evidencia); al reiniciar, los no observados pasan a inciertos.
- Los conectores declarados idempotentes reusan su `Idempotency-Key` al reintentar; una URL de conciliación puede confirmar o marcar ausente el efecto.
- Con `maxOutput = 0`, las llamadas normales omiten `max_tokens`; Markdown GFM, tablas y enlaces se renderizan con el parser GFM.
- La prioridad de proveedor se valida y se envía como preferencia opcional de precio, throughput o latencia; en modo automático no se fija una preferencia artificial.
- El smoke test usa datos realmente aislados y no registra contenido de chats heredados.
- La compresión separa prefijo estable y estado mutable, conserva una cola reciente válida y no reenvía `reasoning_details` ni siquiera durante una compresión fragmentada.
- Las capturas de escritorio pasan a adjuntos binarios locales por tarea: ni `workspace.json`, ni transcript, ni checkpoint conservan base64; se rehidratan sólo para la llamada de visión y el efecto de escritorio queda observado.
- Las anotaciones de URL del stream se normalizan, eliminan enlaces no HTTP/HTTPS y se muestran como fuentes verificables; son metadatos de interfaz, no campos reenviados al modelo.

## Evidencia local

Los resultados de ventana están en D:/Agents/desktop/test-results/revision-final/smoke:

- smoke.json
- desktop.png
- settings.png
- task.png

Se inspeccionaron capturas de la interfaz blanca. El smoke test usa una carpeta aislada sin credenciales; no modifica datos de una cuenta ni ejecuta una misión de pago.

Las pruebas reales emplean la clave cifrada local de la cuenta y no la incluyen en esta documentación ni en sus salidas. El proveedor no devolvió metadatos de ruta en esas respuestas, por lo que esa parte de la telemetría se muestra como no reportada. Las pruebas no demuestran que cualquier API, modelo o servidor MCP funcione. Tampoco equivalen a una auditoría de seguridad independiente ni a superioridad comparativa frente a otros agentes.

## Próxima validación recomendada

Validar una misión visual completa de Windows con un modelo de visión y una carpeta de prueba: crear un archivo, editarlo, ejecutar una prueba y comprobar diario/coste. Después probar un conector API elegido por el usuario. La configuración actual conserva el techo de 50k incluso cuando se cambia de modelo.
