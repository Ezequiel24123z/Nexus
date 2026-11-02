# Pruebas reales en segundo plano — 17 de septiembre de 2026

Se usó la clave cifrada ya registrada, sin imprimirla ni incluirla en código. Modelo: `deepseek/deepseek-v4.1-flash`; streaming activo, reasoning `none`, techo operativo 50.000. Las llamadas normales del nuevo ensayo omiten `max_tokens`. No hubo control de escritorio, automatización de ventanas, escrituras en chats del usuario ni cambios de configuración de producción.

## Resultados

| Ensayo | Resultado | Coste reportado |
| --- | --- | --- |
| Archivos, adjuntos, seguimiento, compresión manual, reinicio, paralelismo y dependencias | 5 comprobaciones integradas, 14 llamadas completadas | 0,00568256 USD |
| Compresión automática con historial sintético largo | 4 llamadas; continuidad comprobada | 0,01826925 USD |
| Primera ejecución interrumpida sin informe final | 6 llamadas completadas; 1 compresión sin uso final reportado | 0,0032528468 USD conocidos + coste desconocido de esa llamada |
| Total confirmado | 24 llamadas completadas y 1 intento de coste desconocido | **0,0272046568 USD + importe no reportado** |

La recuperación crea un archivo JSON y comprueba los marcadores del archivo original y del adjunto; no acepta sólo la afirmación del modelo. Se verificó streaming, ausencia de tope de salida enviado, cero tokens de razonamiento reportados, entrega única del seguimiento durante compresión, lectura del adjunto después de reconstruir Store/Runtime y espera de la tarea dependiente.

La prueba larga pasó de **72.801 a 4.681 tokens estimados** (reducción del 93,57%). El historial inicial se dividió antes de enviarlo: la petición de mayor entrada tuvo **34.626 tokens reales**, por debajo de 50k. El checkpoint conservó el marcador de continuidad y la respuesta final fue `COMPACTION_OK`.

## Caché y eficiencia observadas

- Recuperación: **48,50% de cache hit ponderado** en 14 llamadas, incluyendo chats nuevos y compresión. Una llamada de reutilización alcanzó **97,73%** (4.096/4.191 tokens); no es una garantía para otras rutas o sesiones.
- Compresión larga: **0% de caché reportada** en este ensayo de bloques nuevos. Reducir contexto no equivale a mejorar la caché inmediatamente.
- Comprimir manualmente el chat corto sólo bajó de 4.231 a 4.185 tokens estimados (1,1%), con una llamada adicional de 0,0011115 USD. Mejora propuesta: advertirlo antes de compactar chats pequeños, sin bloquear la opción manual ni cambiar el trigger por esta única muestra.
- Los tiempos variaron; este lote no demuestra una clasificación estable de proveedores ni superioridad frente a otras aplicaciones.

## Interrupción y mejoras del banco de pruebas

El primer proceso acabó sin guardar el informe final durante una compresión. La causa no está confirmada; no se atribuye al modelo ni se cuenta su coste como cero. Se conservaron los datos parciales. La repetición, con el proceso enlazado a la consola de pruebas y sin interacción con el escritorio, pasó completa.

El nuevo ensayo guarda el informe antes de cada petición y después de cada comprobación. El lanzador ya no interpreta una salida sin código o una señal de terminación como éxito, y captura errores al iniciar el proceso hijo. Dos regresiones locales cubren ese comportamiento: **94 pruebas locales aprobadas** en total.

El ensayo de recuperación detiene nuevas peticiones al alcanzar 22 solicitudes, 0,08 USD reportados o un coste final desconocido. Es una guarda del banco de pruebas, no un límite añadido a la app ni un techo de facturación exacto: las peticiones en curso y los costes no reportados pueden quedar fuera de esa suma.

## Evidencia y reproducción

- `test-results/live-background-2026-09-17/recovery-retry.json`
- `test-results/live-background-2026-09-17/auto-compaction.json`
- `test-results/live-background-2026-09-17/interrupted.json`
- `npm run test:live-recovery` ejecuta el nuevo ensayo real y consume saldo. `NEXUS_LIVE_REPORT_PATH` permite elegir el destino del informe.

Los archivos sintéticos de recuperación permanecen en las carpetas temporales indicadas en los informes. El ensayo de compresión automática eliminó sólo su carpeta temporal generada al terminar; conserva su informe. No se verificaron visión, navegación web, conectores externos ni interacción visual en esta ronda.
