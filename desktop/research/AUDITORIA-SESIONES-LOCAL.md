# Auditoría de sesiones locales y rendimiento

## Alcance

Se analizaron la sesión actual y cinco copias locales de recuperación. La revisión de los chats se hizo mediante metadatos y estructura agregada: estados, llamadas, tokens, coste, caché, eventos, compresiones, tipos de herramienta, tamaños y repetición de firmas con hash. No se incluyen mensajes, títulos, rutas, comandos, credenciales ni contenido de las conversaciones.

## Evidencia observada

| Punto de la sesión larga | Llamadas | Entrada | Caché | Coste USD | Compresiones | Tamaño del estado |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Primer backup observado | 266 | 20,0 M | 76,5% | 2,1745 | 3 | 5,4 MB |
| Backup final observado | 468 | 25,2 M | 75,4% | 2,9247 | 8 | 10,1 MB |

En el último backup, la tarea activa acumulaba 396 pasos, 422 llamadas y 639 intenciones de herramienta. Su solicitud más grande alcanzó 216.578 tokens. La caché redujo coste de forma material, pero no compensa repetir contexto ni una secuencia tan larga de herramientas. Otras dos tareas completas sumaban 46 llamadas y aproximadamente 0,26 USD.

La revisión estructural posterior registró 713 intenciones y 708 resultados de herramienta; 412 fueron comandos de PowerShell, 92 lecturas y 88 cambios de archivo con copia previa. En la tarea larga, 382 comandos tenían 382 firmas distintas y no apareció ninguna repetición dentro de las ocho ejecuciones anteriores: el problema observado no es un bucle de comando idéntico, sino una exploración extensa. Hubo 9 notas `document_progress` para 442 pasos entre las tres tareas y ningún efecto externo quedó incierto en ese backup.

## Diagnóstico

1. El coste dominante fue la **entrada reiterada**, no el texto final. El límite de salida no explica 25 M tokens de entrada.
2. La tarea larga documentó progreso con poca frecuencia frente al número de pasos. Eso empeora las compresiones y dificulta recuperar decisiones.
3. El estado JSON completo y sus backups crecieron a 10 MB porque se persisten telemetría, eventos y conversación en el mismo documento. La paginación ya protege la interfaz, pero el siguiente paso debe mover el histórico grande a un índice/registro append-only.
4. El último backup todavía usaba 75.000 tokens operativos, compresión al 70% y `max_tokens` de 15.998. Ya se migró al valor pedido: 50.000, trigger al 95% y salida nativa del proveedor. Esto ataca directamente el principal multiplicador de entrada futura. Los chats históricos que aún superan el nuevo techo se comprimirán antes de la siguiente llamada al reanudarlos; no se fuerza una llamada de pago sólo por migrar los datos.

## Cambios aplicados tras la auditoría

- `maxOutput = 0`: NEXUS omite `max_tokens` en llamadas normales. El proveedor determina la salida máxima. Las llamadas de compresión conservan su propio máximo técnico para completar el documento de continuidad.
- Descubridor de catálogo OpenRouter: ordena dinámicamente por capacidad, precio, throughput, latencia, contexto, popularidad o novedad; muestra capacidades, precio por millón, contexto y thinking publicado por cada modelo.
- Enrutado de proveedor configurable: OpenRouter puede decidir automáticamente o priorizar precio, throughput o latencia entre proveedores compatibles; la elección real queda en la telemetría.
- Thinking: se muestra actividad en vivo y únicamente el **resumen** de reasoning que el proveedor marque como resumen. No se reenvía ni se presenta razonamiento literal/cifrado.
- Markdown GFM: tablas, listas, enlaces, código y bloques se renderizan con un parser GFM en vez de un parser parcial propio.
- Efectos REST: `Idempotency-Key`, URL de conciliación, verificación y reintento con el mismo id para conectores que declaren soporte.
- Continuidad: tras 12 pasos sin nota de progreso, se añade un recordatorio no bloqueante para llamar `document_progress`; no limita pasos ni rechaza acciones.
- Privacidad de pruebas: el smoke test ya no importa sesiones heredadas ni registra títulos/contenido de chats en consola.

## Prioridades siguientes

| Prioridad | Mejora | Razón | Medida de aceptación |
| --- | --- | --- |
| P0 | Histórico append-only indexado | Evitar serializar y respaldar megabytes en cada cambio. | Una sesión de 500 pasos mantiene `workspace.json` compacto y carga páginas desde registros. |
| P1 | Detector de trabajo estancado | Señalar ausencia de un hito pese a muchos pasos y pedir al agente que revise su estrategia. No bloquea acciones. La evidencia actual no muestra comandos idénticos repetidos. | Baja la exploración sin progreso en una tarea de reparación reproducible. |
| P1 | Plan durable con criterios de terminado | Hace visible la estrategia, evita pasos de exploración indefinidos y permite reanudar mejor. | Cada tarea larga tiene plan, verificación y artefactos esperados. |
| P1 | Worktree/diff/Git checkpoint | Aísla tareas concurrentes y hace revisables cambios grandes. | Tres tareas sobre un repo no comparten árbol de trabajo. |
| P1 | Navegador DOM/ARIA | Reduce coste y fragilidad de control por píxeles. | Flujo web verificable con selectores, URL y captura sólo de respaldo. |
| P2 | Laboratorio de modelos | La etiqueta “mejor” debe validarse con tareas personales y coste real. | Compara resultado, coste, caché, latencia y herramientas correctas por modelo/proveedor. |

## Referencias de catálogo

OpenRouter publica en su API el contexto, precios, parámetros soportados y capacidades de reasoning de cada modelo; también permite ordenar el catálogo por precio, contexto, throughput, latencia, popularidad, novedad e índices de capacidad. [Models API](https://openrouter.ai/docs/api/api-reference/models/get-models). El esfuerzo de reasoning y sus opciones por modelo se describen en [Reasoning Tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
