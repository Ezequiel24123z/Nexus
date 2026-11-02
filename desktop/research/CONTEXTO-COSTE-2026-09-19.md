# Inspector de contexto y coste — 19 de septiembre de 2026

Primera entrega de la [hoja de ruta aprobada](HOJA-DE-RUTA-APROBADA-2026-09-19.md). No completa las líneas de conectores guiados, memoria de proyecto, carga parcial desde disco, paquetes o navegador/documentos.

## Uso

Desde un chat, el botón **Contexto, caché y gasto** (icono de actividad) abre un inspector con tres vistas:

1. **Contexto.** Estimación actual, umbral y techo; instrucciones/objetivo, fijados, dependencias, continuidad comprimida, última instrucción restaurada, historial y herramientas. Cada categoría explica por qué se incluye. El contenido se consulta por fragmentos de 6.000 caracteres, sólo al abrirlo.
2. **Gasto y caché.** Coste reportado separado por generación y compresión; reintentos identificados como subconjunto, sin sumarlos dos veces. Cobertura de caché, entrada no cacheada calculable, fallos/interrupciones y llamadas pendientes. Registro paginado del historial completo, no sólo las últimas 80 llamadas del snapshot de interfaz.
3. **Compresiones.** Últimos 15 checkpoints registrados, estimaciones antes/después y coste cuando constan. Permite contrastar resumen y originales sin abrir archivos externos. Las compresiones antiguas pueden carecer de métricas; se muestran como no reportadas, no como cero.

El inspector es una fotografía local con fecha; no se refresca en cada token. Actualizar vuelve a leer los datos. Si el contexto o registro de gasto cambia entre páginas, se solicita refrescar en lugar de mostrar una página como si perteneciera a la fotografía anterior.

No se consulta el vault ni se llama al modelo al inspeccionar. Las referencias a imágenes no se hidratan y las vistas previas omiten binarios y `reasoning_details`. Los textos propios del usuario pueden contener información privada y se muestran bajo petición; no son un sistema de anonimización.

## Estimación y contabilidad

La composición se obtiene de `buildContext`, la misma construcción que utiliza el motor. La selección de herramientas ahora es compartida entre peticiones, estimación y calibración: se excluye escritorio cuando está desactivado y se incluye la definición web cuando procede. La calibración de una llamada usa los esquemas que realmente se enviaron, aunque se cambien ajustes mientras llega la respuesta.

Las cifras son estimaciones locales, no tokenización exacta del proveedor. Las categorías tienen envoltorios/redondeos diferentes y no se presentan como una suma exacta. El último input reportado es histórico: no equivale al tamaño actual después de cambios o compresión. Seguimientos en cola y compresiones previas a la siguiente generación pueden cambiar la petición futura.

Costes desconocidos siguen siendo desconocidos. El coste parcial no es una factura total. La entrada no cacheada se calcula sólo donde existen ambos contadores y son coherentes. Un valor de caché superior al de entrada o negativo no cuenta como cobertura válida ni genera un porcentaje engañoso. El gasto de búsqueda web continúa dependiendo de lo informado por el proveedor; no se inventa un desglose monetario cuando falta.

## Afinidad experimental

Configuración → Compresión de contexto incluye **Afinidad de proveedor por conversación (experimental)**, desactivada por defecto. Envía `session_id` opaco derivado del identificador del chat; no contiene rutas, prompts, títulos ni credenciales. Generación y compresión utilizan identificadores separados. Sobrevive al reinicio y se conserva en los reintentos de una llamada.

OpenRouter documenta el uso de `session_id` para afinidad de enrutado en tareas de varios turnos. Es una oportunidad que debe medirse, no una garantía de cache hit o reducción de factura: [documentación de caché y afinidad](https://openrouter.ai/docs/guides/best-practices/prompt-caching).

Se ha probado el payload con respuestas simuladas. No se ha medido esta opción con DS4.1 Flash real en esta ronda y no se cambia el comportamiento por defecto de las sesiones existentes. Tampoco cambia el modelo, el trigger, el techo de 50k o el máximo de salida nativo.

## Bugs encontrados y corregidos

- Una compresión manual conservaba el contador de entrada anterior; al reanudar podía provocar otra compresión inmediata aunque el contexto ya fuese pequeño. Ahora se invalida al guardar la nueva continuidad, también en el flujo manual.
- El conteo de herramientas no reflejaba siempre escritorio desactivado o búsqueda web habilitada. Se utiliza una selección compartida.
- El cálculo de cobertura aceptaba pares incoherentes de entrada/caché. Ahora se excluyen del porcentaje comparable.
- El selector genérico de diálogos abría un lote de tareas sobre el nuevo inspector. Se sustituyó la condición genérica por tipos explícitos y se añadió una comprobación de diálogo único y controles no tapados. La revisión de capturas detectó el fallo que las primeras interacciones programáticas no vieron.

## Límites y continuación

La lectura de checkpoints es asíncrona, con un máximo de 32 MB por archivo para esta vista. El parseo, construcción del contexto y agregación siguen en el proceso principal; la fase de rendimiento debe medir y sacar trabajo pesado de él. El historial aún reside en memoria. No se ha completado una migración de carga parcial desde disco.

La siguiente entrega planificada es el laboratorio visual de conectores: formularios según contrato, revisión de petición y prueba explícita con diagnóstico. Después, memoria editable de proyecto con fuente/revisión y pruebas de continuidad. Las demás líneas aprobadas permanecen pendientes en la hoja de ruta; no se consideran entregadas por este inspector.

No se genera instalador ni se reinicia la aplicación del usuario. Pruebas con perfiles temporales, sin control de escritorio ni inferencia de pago.
