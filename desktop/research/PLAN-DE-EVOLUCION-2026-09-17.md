# Plan de evolución de NEXUS

Fecha: 17 de septiembre de 2026. Estado: propuesta, no implementación. Orden basado en el código y las verificaciones locales disponibles, no en una auditoría exhaustiva nueva de todos los módulos o aplicaciones competidoras.

Actualización posterior: entregada la ronda A delimitada en «Orden de las próximas tres rondas»: selector rápido, búsqueda de historial, panel de resultados y medición inicial de búsqueda. [Informe de entrega](RONDA-A-2026-09-17.md). El resto sigue siendo planificación; no se considera completada toda la fase 1 por esta primera ronda.

18 de septiembre: entregada B1, suscripciones de interfaz con detalle sólo del chat abierto y medición sintética de reducción de datos. [Informe](RONDA-B1-2026-09-18.md). Entregada también B2: SQLite opcional, transacciones incrementales, migración verificada, copias y exportación compatible. [Informe B2](RONDA-B2-2026-09-18.md). Siguen pendientes I/O fuera del proceso principal, carga parcial desde disco y restauración visual; no está completada toda la fase B.

## Objetivo

Ampliación aprobada por el usuario: [seguimiento de las siete líneas](HOJA-DE-RUTA-APROBADA-2026-09-19.md). La primera entrega incorpora inspector de contexto/gasto y afinidad experimental, además de corregir la compresión repetida tras una compresión manual. [Informe](CONTEXTO-COSTE-2026-09-19.md). No supone haber completado todas las fases ni haber demostrado ahorro con tráfico real.

19 de septiembre, ampliación posterior: entregado el primer importador OpenAPI local con revisión, selección, contratos de parámetros y descubrimiento bajo demanda. [Alcance](OPENAPI-2026-09-19.md). Es un subconjunto JSON 3.0/3.1; siguen pendientes YAML, OAuth, serializaciones complejas y pruebas manuales guiadas de cada operación. No completa toda la fase 6.

19 de septiembre: a petición del usuario se adelantó una ronda de UI y biblioteca extensible: skills, funciones de una herramienta, catálogos paginados, navegación rápida y preferencias visuales. [Informe](UI-BIBLIOTECA-2026-09-19.md). No completa las fases de integraciones ni agentes coordinados; paquetes, OAuth y editor multipaso siguen pendientes. El primer subconjunto OpenAPI se entregó después, como se indica arriba. La fase de caché/contexto continúa en el plan.

Actualización B3: entregada la revisión y recuperación guiada de estado en carpeta independiente, sin activación automática ni binarios. El asistente trabaja fuera del proceso principal y se han corregido lecturas inconsistentes entre revisiones SQLite. [Informe B3](RONDA-B3-2026-09-18.md). La restauración integral y el I/O asíncrono del motor siguen pendientes.

Un agente personal de escritorio capaz de terminar tareas largas, fácil de supervisar y económico de usar. La interfaz principal conserva chat, proyectos y editor; las funciones avanzadas aparecen en paneles contextuales. La medida principal será el coste por tarea correctamente terminada, no el número de funciones ni el porcentaje de caché aislado.

Se mantienen OpenRouter, instrucciones editables, techo de contexto de 50k, trigger configurable, autonomía configurable y ausencia de tope de salida propio en conversación normal. Los límites nativos del proveedor siguen existiendo. Las nuevas alertas de gasto o estancamiento no detendrán por defecto una tarea.

## Punto de partida verificado

Ya existen proyectos/chats, fijados, modelos y thinking configurables, catálogo dinámico, telemetría, búsqueda web, herramientas locales, REST/MCP, tareas paralelas en carpetas distintas, dependencias, compresión con checkpoints, imágenes/texto adjuntos, borradores persistentes y recuperación del último stream. La ronda anterior registró 105 pruebas automáticas y 67 comprobaciones Electron; esos números no equivalen a cobertura total.

Las propuestas siguientes amplían esas funciones; no las presentan como ausentes. La evidencia de algunas capacidades sigue siendo parcial: escritorio integral con modelo real, multimodalidad avanzada, rendimiento a gran escala y saldo real de cuenta.

Hallazgos comprobados para priorizar:

- B2 pasa el ámbito de tarea a `Store.save()` y permite transacciones de registros modificados en SQLite; el modo JSON conserva reescrituras completas y ambos mantienen historial en memoria.
- B1 limita el detalle del `snapshot()` de interfaz al chat visible; falta transporte de diferencias por revisión y lectura paginada desde disco.
- El paralelismo protege carpetas compartidas mediante espera; no hay espacios Git independientes por tarea.
- El catálogo se descubre dinámicamente, pero no hay evaluación propia que justifique cuál funciona mejor en tus tareas.
- Los informes antiguos y README tienen afirmaciones desactualizadas, por ejemplo sobre borradores y adjuntos; actualizar documentación será parte de cada entrega.

## Fase 1 — Uso diario y observabilidad

Esfuerzo relativo: medio. Puede empezar sin migrar todos los datos.

1. **Selector de modelo en el chat.** Favoritos, recientes, búsqueda, proveedor y thinking junto al editor. Mostrar qué se aplicará a la próxima llamada. Cambios durante ejecución sólo en límites claros entre pasos, sin modificar la llamada en curso.
2. **Búsqueda dentro del historial.** Ctrl+F, resultados con fragmento y salto al mensaje, búsqueda por proyecto y filtros por archivos/herramientas. Incluir páginas antiguas, no sólo los mensajes cargados.
3. **Panel lateral de resultados.** Archivos producidos, vistas previas, fuentes, pruebas y cambios; cada elemento enlazado al mensaje o acción de origen.
4. **Actividad comprensible.** Paso actual, herramienta, tiempo transcurrido, espera del proveedor y objetivo inmediato. Usar eventos del motor; no gastar una llamada por cada actualización ni inventar razonamiento privado. Resúmenes del proveedor sólo cuando estén disponibles.
5. **Cola de seguimientos editable.** Ver, reordenar o retirar instrucciones aún no consumidas, con reglas claras cuando ya empieza un paso.
6. **Comodidad visual.** Arrastrar archivos, pegar imágenes, zoom/tamaño de letra, densidad cómoda/compacta, navegación por teclado y foco de diálogos. Temas adicionales después de asegurar contraste del tema blanco.

Criterio de cierre: recorridos de teclado, búsqueda de un mensaje antiguo, cambio de modelo sin carreras, adjuntos sin perder borradores y streaming sin saltos al abrir/cerrar paneles. Las vistas de documentos no ejecutan contenido activo por defecto.

## Fase 2 — Base duradera y fluidez con muchos chats

Esfuerzo relativo: alto. Prioridad técnica máxima; precede a una expansión importante de agentes.

1. **Persistencia incremental completa.** Separar tareas, turnos, mensajes, llamadas y efectos. Comparar registro indexado frente a SQLite en un prototipo medido; no adoptar ambos como fuentes de verdad. Migración versionada con backup, comprobación y recuperación.
2. **Actualizaciones por tarea.** Estado ligero para la barra lateral y eventos incrementales del chat activo, con revisiones y re-sincronización si se pierde un evento.
3. **Trabajo pesado fuera de la interfaz.** Extraer/indexar documentos y realizar escrituras ordenadas sin congelar el proceso principal. Mantener confirmación durable para operaciones críticas: diferir un guardado no debe degradar recuperación.
4. **Entregas y cancelaciones robustas.** Identificador de envío, deduplicación tras reinicio, estado explícito de petición cancelada y conciliación de acciones externas inciertas. No prometer ejecución exactamente una vez en APIs arbitrarias.
5. **Copia y restauración comprobables.** Exportación completa de datos, restauración de prueba y limpieza de adjuntos huérfanos con vista previa y recuperación. No borrar automáticamente por antigüedad sin política elegida.

Criterio de cierre: ensayos locales sintéticos de 100 chats, una conversación de 10.000 mensajes y 4 streams simultáneos. Medir tiempos p50/p95, memoria, pausas y bytes escritos. Objetivo provisional: interacción habitual por debajo de 100 ms p95 y apertura de chat por debajo de 500 ms en el equipo de referencia; son metas a contrastar, no prestaciones actuales. Probar muerte del proceso durante migración, envío y guardado.

## Fase 3 — Coste, caché y memoria verificable

Esfuerzo relativo: medio/alto. Las primeras mediciones pueden adelantarse a la fase 2.

1. **Sesión estable de enrutado.** Evaluar identificador opaco estable por conversación y separación del flujo de compresión. Mantener esquema de herramientas/prefijo estables; medir efecto real antes de activar nuevos valores por defecto.
2. **Panel de explicación del gasto.** Entrada nueva/cacheada, salida, resúmenes, reintentos y herramientas web cuando se reporten. Coste desconocido separado del confirmado; estimación previa claramente etiquetada. Comparativa por proyecto, modelo y tarea terminada.
3. **Laboratorio de modelos.** Conjunto pequeño de tareas representativas, comprobadores automáticos, coste y latencia. Perfiles económicos/equilibrados/de máxima calidad configurables. Mostrar fecha, tamaño de muestra y capacidades; no llamar «mejor» al primero de un ranking externo.
4. **Inspector de contexto.** Qué instrucciones, fijados, documentos y memoria entrarán en la próxima llamada; estimación por categoría y explicación de por qué se recuperó cada fragmento.
5. **Compresión con pruebas de continuidad.** Casos con nombres, rutas, restricciones y decisiones verificables; medir recuperación tras varios resúmenes. Evitar compresiones repetidas sin ganancia útil y conservar siempre originales. Modelo de resumen independiente sólo tras demostrar fidelidad y ahorro total.
6. **Memoria de proyecto editable.** Decisiones y preferencias con fuente, fecha, ámbito, vigencia y corrección manual. Búsqueda local primero; recuperación semántica sólo si las pruebas muestran beneficio. No copiar memorias enteras a cada llamada.
7. **Menos pasos improductivos.** Aviso ante errores repetidos, exploración extensa o falta de avance. Proponer cambio de enfoque sin un máximo de pasos obligatorio. Descubrimiento de herramientas extensas sin variar continuamente el prefijo.

Criterio de cierre: comparar tareas equivalentes antes/después con la misma configuración; medir calidad, coste completo y caché con cobertura. No fijar un objetivo universal de cache hit ni cambiar de modelo en cada paso sólo por precio.

OpenRouter documenta afinidad de proveedor para reutilizar caché y un identificador explícito de sesión. Es una oportunidad de integración, no una garantía de aciertos ni ahorro para cualquier proveedor: [documentación de prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching).

## Fase 4 — Web y archivos como herramientas de primera clase

Esfuerzo relativo: alto. Entregar cada formato o capacidad por separado.

1. **Navegador integrado por tarea.** Pestañas, URL, DOM/accesibilidad, formularios, descargas y captura cuando haga falta. Perfil de prueba aislado; inicio de sesión controlado por ti. Separar claramente búsqueda de información y navegación interactiva.
2. **Lector web económico.** Extraer texto útil, citar fragmentos y reutilizar documentos ya leídos con fecha/hash. Consultar de nuevo cuando la frescura importe. Tratar las instrucciones encontradas en páginas como contenido, no como órdenes del usuario.
3. **PDF.** Texto con referencias de página, visor y OCR opcional para escaneados. Extracción local como primera opción; modalidades de proveedor cuando convengan y sean compatibles.
4. **Office.** DOCX, XLSX y PPTX mediante adaptadores específicos. Conservar tablas, fórmulas o estructura cuando corresponda; mostrar limitaciones de la extracción. Creación/edición con original preservado y verificación del archivo resultante.
5. **Audio y vídeo.** Transcripción con marcas de tiempo y análisis por segmentos/fotogramas. Modelo compatible y coste estimado antes de tratamientos extensos; no enviar archivos enteros repetidamente.
6. **Gestor de artefactos.** Buscar, previsualizar, exportar y ver versiones. Guardar extracción por hash y versión del adaptador para no reprocesar adjuntos idénticos.

Criterio de cierre: corpus con documentos normales, grandes, corruptos, escaneados y protegidos; nunca mostrar «leído» si sólo se almacenó el binario. Navegación probada primero contra sitios locales de prueba, sin controlar el escritorio.

## Fase 5 — Trabajo complejo y agentes coordinados

Esfuerzo relativo: alto. Depende de persistencia, efectos y observabilidad sólidos.

1. **Plan vivo y persistente.** Objetivo, pasos, criterios de éxito, pruebas y bloqueos visibles/editables. Un paso sólo se marca verificado con evidencia.
2. **Roles y recetas reutilizables.** Investigación, implementación y revisión, con instrucciones, modelo y herramientas configurables; se pueden usar en un único agente sin multiplicar llamadas.
3. **Subtareas delegadas.** Encargos acotados, contexto mínimo, archivos bajo responsabilidad de cada agente, coste agregado y resultados con fuentes. La coordinación no debe reenviar todos los historiales a todos los agentes.
4. **Worktrees y revisión de cambios.** Espacio Git separado cuando corresponda, diff por tarea, pruebas y resolución de conflictos antes de integrar. Para carpetas sin Git, conservar exclusión y copias; no simular aislamiento que no existe.
5. **Terminal por tarea.** Sesiones persistentes, procesos en segundo plano, salida incremental, cancelación y recuperación de estado.
6. **Cola visual avanzada.** Prioridad, dependencias, recursos exclusivos y tareas bloqueadas con explicación. Reintentos con espera progresiva según errores del proveedor, sin repetir ciegamente efectos externos.
7. **Auto-mejora en una versión candidata.** NEXUS puede proponer cambios en una copia/worktree, ejecutar regresión y preparar una versión. Activación separada del proceso en ejecución, con versión anterior recuperable y migraciones compatibles.

Criterio de cierre: comparar dos tareas independientes y dos en conflicto, cancelar una subtarea, reiniciar durante una operación y comprobar que no se pierden cambios ni se duplican efectos. Comparar coste/calidad frente al agente único antes de activar equipos por defecto.

## Fase 6 — Integraciones y aplicación terminada

Esfuerzo relativo: alto y dividido en entregas independientes.

- Importar conectores desde OpenAPI con validación, paginación, prueba y edición visual.
- OAuth, renovación de credenciales y diagnóstico de MCP; secretos fuera del chat y registros de diagnóstico depurados.
- Recetas guardadas con variables: entradas, pasos, modelos y salidas esperadas.
- Tareas programadas, avisos y bandeja del sistema. Distinguir app minimizada, ventana cerrada y proceso detenido. Ejecutar con la app detenida requiere un componente de fondo explícito y una configuración visible.
- Escritorio más robusto: selección de monitor/ventana, coordenadas y DPI, reserva exclusiva, estado visible y parada inmediata. Validación visual real sólo si vuelves a querer ese tipo de pruebas; no es requisito para las pruebas actuales sin escritorio.
- Instalador, versiones, comprobación de actualizaciones, restauración y después firma de distribución, evaluando sus requisitos y costes.
- Diagnóstico exportable y limpieza del almacenamiento desde la propia app, con selección de qué información se comparte.

## Orden de las próximas tres rondas

| Ronda | Entrega principal | Verificación |
| --- | --- | --- |
| A | Selector rápido de modelos/thinking + búsqueda dentro del chat + panel de artefactos; instrumentar fluidez | Recorridos Electron, teclado, mensajes antiguos, modelos incompatibles, pérdida/cambio de foco |
| B | Reducir snapshots globales y diseñar/migrar persistencia incremental en una entrega propia | Carga sintética, reinicio, recuperación, migración reversible y comparación de tiempos |
| C | Afinidad de sesión/caché + inspector de contexto + evaluaciones de continuidad/coste | Reproducción local y muestra real pequeña con informe de coste y calidad |

Si las mediciones de A detectan bloqueos importantes, priorizar B antes de ampliar paneles. Después: PDF/Office básico y navegador DOM, seguidos de worktrees/delegación. La migración de datos no debe mezclarse con un rediseño grande en la misma entrega.

## Política de calidad y gasto del desarrollo

- Primero pruebas unitarias, integración local y Electron fuera de pantalla; sin usar tu escritorio.
- Pruebas de fallos: red cortada, respuestas parciales, cuota/saldo, disco lleno, archivo corrupto, cierres y eventos fuera de orden.
- Pruebas reales pequeñas y de propósito concreto; registrar llamadas y coste recibido. No lanzar baterías grandes para valorar cambios sólo visuales.
- Presupuesto de ensayo visible y configurable. Es una protección del laboratorio, no un límite obligatorio de las tareas personales. Un tope basado en costes aún no reportados no garantiza un gasto exacto.
- Capturas antes/después, contraste y teclado; no confundir una captura correcta con un flujo funcional correcto.
- Cada entrega incluye informe de cambios, métricas, limitaciones, recuperación y documentación actualizada.

La recomendación de medir y sacar operaciones pesadas del proceso principal se alinea con la [guía de rendimiento de Electron](https://www.electronjs.org/docs/latest/tutorial/performance). Las metas y fases de este documento son propuestas específicas para NEXUS, no garantías de rendimiento ni promesas de superioridad sobre otros productos.

## Qué posponer

Reescribir la app en otro framework, compatibilidad universal de archivos, equipos de agentes siempre activos, cambio automático de modelo en cada paso, sincronización cloud y nuevas vías de autenticación ajenas a OpenRouter. No son imposibles, pero ahora añaden complejidad antes de resolver necesidades comprobadas. Mantener la clave cifrada como está; incrustarla en el ejecutable no aporta funcionalidad.
