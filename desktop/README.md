# NEXUS Desktop — revisión local

> Incorporación a GitHub (2 de noviembre de 2026): este manual conserva el detalle histórico. El motor actual admite **OpenRouter y Arli.ai**. Consulta [la guía VM/Copilot](../docs/VM-Y-COPILOT.md), [el estado actual](../docs/ESTADO-Y-ROADMAP.md) y [la validación](../docs/VALIDACION.md). Las rutas y evidencias locales citadas pertenecen al entorno original. Antes de abrir por primera vez, ejecuta dentro de `desktop/`: `npm ci`, `npm run build`, `npm start`.

Aplicación Windows con motor local y modelos de OpenRouter. No necesita la web publicada ni un servidor web abierto.

## Abrir esta revisión

Haz doble clic en **Abrir NEXUS.cmd**, dentro de esta carpeta. Es una vista previa de desarrollo que utiliza las dependencias ya instaladas. La carpeta release puede contener un ejecutable de la versión anterior: **no se ha vuelto a empaquetar el instalador final** durante esta revisión.

1. En Configuración, guarda la clave de OpenRouter y elige un modelo. Las herramientas necesitan un modelo que admita llamadas de función; la pantalla requiere visión. La clave se guarda cifrada en el almacén local de Windows, no dentro del ejecutable.
2. Crea un proyecto y asocia una carpeta. Sus instrucciones se aplican a sus chats.
3. Escribe en Nuevo chat. Los controles de pausa, fijados, exportación y ajustes están en la cabecera del chat.
4. En Tareas, crea lotes paralelos o secuenciales. Las tareas de la misma carpeta esperan su turno; las carpetas distintas pueden avanzar simultáneamente.

Los borradores de cada chat y de cada nuevo chat de proyecto se guardan en este equipo, incluidos los adjuntos preparados y la carpeta seleccionada. El compositor muestra el estado de guardado y permite reintentarlo si falla. El cierre normal espera los guardados pendientes; un mensaje aceptado limpia únicamente la versión del borrador enviada.

Durante una compresión manual puedes usar **Pausar compresión** en los ajustes del chat. La cancelación conserva el contexto original; cualquier seguimiento enviado durante la compresión queda en cola. Cancelar una petición no garantiza que el proveedor deje de facturarla.

## Accesos rápidos del chat — ronda A

El icono de actividad **Contexto, caché y gasto** abre el nuevo inspector local: composición del contexto con detalles bajo demanda, gasto separado por generación/compresión, reintentos, registro paginado y comparación de resúmenes con originales. No consume API y distingue cifras estimadas de datos reportados. **Actualizar** captura los cambios mientras el chat trabaja. [Guía y limitaciones](research/CONTEXTO-COSTE-2026-09-19.md).

En Configuración → Compresión de contexto puedes activar **Afinidad de proveedor por conversación (experimental)**. Está desactivada por defecto; su ahorro real aún no está medido. No altera el techo de contexto, el trigger o el modelo.

- Encima del editor, pulsa el nombre del modelo para abrir el selector, filtrar el catálogo, guardar favoritos y ajustar thinking y preferencia de proveedor. En un chat existente los ajustes son propios de ese chat; en Nuevo chat cambias los valores globales: el modelo se usa en nuevos chats y thinking/proveedor también afectan a chats que todavía los hereden. Pausa la tarea y espera a que termine la llamada para modificarlos. No se altera el techo de contexto ni se envía una llamada sólo por cambiar la selección.
- La lupa o **Ctrl+F** busca texto literal en todo el historial visible de mensajes del chat, incluidos los mensajes antiguos que no están cargados. Cada coincidencia permite saltar al mensaje con un tramo acotado de contexto; puedes cargar mensajes anteriores/posteriores y volver al presente. No busca en contenido oculto de razonamiento ni en archivos adjuntos.
- **Resultados** abre un panel con archivos modificados mediante herramientas registradas, resultados grandes guardados, citas estructuradas y notas de progreso. Permite previsualizar contenido sin abrir programas externos. La vista del archivo muestra su contenido actual, no un diff ni una versión histórica. Las notas del agente se distinguen de verificaciones independientes. Usa Actualizar resultados para consultar nuevos registros.
- Las vistas previas son parciales y de texto; no ejecutan HTML. Archivos binarios y documentos que requieren extracción se identifican sin fingir que se han leído. Los archivos creados por comandos arbitrarios no se descubren automáticamente en el panel.

Detalles y pruebas: [ronda A](research/RONDA-A-2026-09-17.md).

La ventana recibe el historial detallado sólo del chat abierto; los chats en segundo plano mantienen título, estado y datos de cola sin reenviar sus conversaciones. Al volver a uno se recupera su detalle actualizado. [Optimización B1 y mediciones](research/RONDA-B1-2026-09-18.md). El almacenamiento incremental opcional se activa por separado, como se explica abajo.

## Biblioteca y experiencia visual — 19 de septiembre

**Biblioteca** reúne skills (procedimientos) y funciones (herramientas con argumentos reutilizables). Puedes crearlas, editarlas, buscarlas y desactivarlas desde la app, o pedir al agente que las guarde durante una tarea. Se cargan bajo demanda, no se envía la biblioteca completa en cada mensaje. Las funciones usan los permisos, aprobaciones y diario de su herramienta original; guardarlas no las ejecuta. Los conectores REST ahora admiten búsqueda, paginación y edición; MCP permite buscar herramientas sin enviar todos sus esquemas al modelo.

**Ctrl+K** abre navegación rápida. En **Configuración → Aspecto** puedes elegir densidad y reducir el movimiento, también para el streaming. La barra lateral mantiene Configuración accesible mientras se desplazan proyectos y chats.

No hay un máximo fijo de entradas de biblioteca, pero sí límites por definición/página y límites prácticos del equipo. No es todavía un importador universal de skills, OpenAPI o plugins. Conserva también `capabilities/` y su historial en tus copias: no van dentro de la exportación JSON del estado. [Alcance y pruebas](research/UI-BIBLIOTECA-2026-09-19.md).

## Autonomía de las tareas

El modo autónomo está activo por defecto, sin confirmaciones por acción y sin un máximo de pasos. Las herramientas de archivos admiten rutas fuera del proyecto. PowerShell y servidores MCP locales tienen los permisos de tu cuenta de Windows: no son un contenedor aislado.

Puedes desactivar autonomía o escritorio desde Configuración y pausar una tarea desde el chat. Las validaciones de argumentos, la detección de respuestas incompletas y los límites técnicos de contexto no son una política de rechazo de contenido. Los proveedores y Windows conservan sus propias restricciones.

Las copias previas cubren write_file y replace_text. **No deshacen operaciones remotas ni efectos arbitrarios de comandos.** Las escrituras UTF-8 no son un editor de archivos binarios.

## Memoria y contexto

- Slider entre 10% y 95% de la ventana configurada, con reserva para la salida.
- Instrucciones globales completamente visibles y editables, más instrucciones por proyecto.
- Diario de llamadas, resultados, cambios y notas de decisiones; resultados grandes como artefactos locales recuperables por fragmentos.
- El razonamiento guardado es historial local: no se reenvía al proveedor en cada paso. Los resultados de más de 12 KB se sustituyen por una referencia de artefacto con vista previa corta.
- «Compactar contexto ahora» (Ajustes del chat, con la tarea pausada) resume el historial bajo demanda; tanto la compresión automática como la manual resumen con razonamiento desactivado para ahorrar coste. Escribe seguimientos mientras la tarea trabaja: se incorporan al siguiente paso y la vista sigue los mensajes nuevos salvo que subas a leer. La actividad muestra el trabajo en curso y, cuando el proveedor lo ofrece, un resumen de reasoning plegado; nunca reenvía razonamiento literal al siguiente paso. Los cortes transitorios del proveedor antes de emitir texto se reintentan una vez.
- La compresión conserva un tramo reciente válido de trabajo, convierte el resto en una cápsula estructurada de continuidad y guarda el original íntegro en checkpoints locales. El prefijo de instrucciones se mantiene estable para favorecer la caché del proveedor. Consulta [el diseño de compresión](research/COMPRESION-CONTEXTO.md).
- Historial original y checkpoints conservados fuera del contexto activo.
- La interfaz carga los últimos 120 mensajes y 80 eventos; «Cargar mensajes anteriores» y «Cargar actividad anterior» recuperan el resto sin bloquear un chat largo.
- Resumen de continuidad con decisiones, rutas, verificaciones y próximos pasos.
- Última instrucción del usuario y mensajes fijados incluidos explícitamente tras comprimir.
- Herramientas search_journal y search_history para recuperar detalles originales.
- Compresión fallida: la tarea se detiene sin eliminar el historial.
- Los resúmenes no garantizan memoria semántica perfecta.

## Uso, caché y saldo

Abre el panel desplegable bajo el chat para consultar costes de sesión, último turno y última llamada; tokens de entrada/salida, caché, contexto y compresión.

El coste del turno incluye las llamadas intermedias y el resumen. Se usan los datos reportados por OpenRouter en USD. Ausente significa desconocido, no cero; si faltan costes, la suma se etiqueta parcial. Las interrupciones también se registran como intentos sin coste confirmado cuando corresponde.

El contexto local es una estimación. Los tokens de uso acumulados no representan el tamaño actual de la ventana. Cache hit pondera tokens de entrada con información reportada, y su cobertura aparece aparte.

En Configuración, `Tope de salida por llamada = 0` (valor inicial) deja que el modelo/proveedor decida su máximo nativo: NEXUS no envía `max_tokens` en la conversación normal. Los resúmenes de continuidad conservan un límite técnico independiente para que puedan terminar y caber en contexto.

El catálogo de modelos se consulta dinámicamente en OpenRouter y puede ordenarse por capacidad, coste, velocidad, latencia, contexto o popularidad. Puedes dejar el proveedor en automático o darle preferencia por precio, throughput o latencia; la ruta que finalmente utilizó OpenRouter aparece por llamada cuando el proveedor la informa.

Activa **Web en tiempo real** para ofrecer al modelo la búsqueda web de OpenRouter. El agente decide cuándo usarla; puedes elegir motor, detalle, resultados y búsquedas por llamada. Las fuentes se muestran como enlaces Markdown y, cuando el proveedor las entrega como citas estructuradas, también como una lista verificable bajo la respuesta. La telemetría registra las búsquedas cuando el proveedor las informa.

Para el saldo global, añade una clave de administración opcional de OpenRouter. La clave de inferencia solo aporta su límite disponible: no se presenta como saldo de cuenta. Las claves se cifran con safeStorage de Electron y la protección de Windows; no se devuelven al renderer ni se insertan en prompts por la aplicación. Un proceso local con tus mismos permisos no constituye un aislamiento frente a otros procesos.

Las respuestas pueden mostrarse en streaming. Si se corta el flujo, no se ejecutan llamadas parciales y el texto recibido queda marcado como incompleto. La generación no usa un tope fijo de 180 segundos: se aborta si el proveedor deja de enviar datos durante 120 s (solo streaming) o si se superan 30 minutos en streaming y 15 sin streaming; el texto parcial se conserva y la tarea puede reanudarse. Cancelar NEXUS no garantiza que todos los proveedores detengan la facturación.

## Conectores REST y MCP

En Conectores puedes añadir endpoints HTTPS GET, POST, PUT, PATCH y DELETE con referencias Bearer CONNECTOR_...; las claves se gestionan en Configuración. El agente puede crear y descubrir estas definiciones.

En Extensiones MCP puedes configurar:

- Programas locales con comando, argumentos, carpeta y referencias de secretos para variables de entorno.
- Servidores Streamable HTTP por HTTPS; HTTP permitido para localhost.
- Conectar, listar herramientas, editar configuración, desconectar y retirar.
- Descubrimiento bajo demanda por el agente mediante list_mcp_servers/list_mcp_tools e invocación mediante invoke_mcp.

Guardar un servidor no lo inicia. Conectarlo o utilizarlo sí. Usa servidores de confianza: sus programas se ejecutan como tu usuario y sus llamadas pueden tener efectos externos. No se ofrece todavía OAuth automático, transporte SSE legado ni representación multimodal completa de resultados MCP. La implementación usa el SDK oficial MCP 1.30.0, rama mantenida de compatibilidad v1.

## Adjuntar archivos al chat

Usa el botón «Adjuntar archivos» junto al cuadro de mensaje. Puedes previsualizar texto e imágenes y quitar archivos del próximo envío. Texto UTF-8, código, CSV y JSON se leen por fragmentos; las imágenes se entregan a modelos con visión. El modelo se comprueba antes de enviar para evitar una llamada incompatible. Otros formatos se conservan como archivos locales para procesarlos con herramientas; los lectores integrados de PDF/Office/audio/vídeo siguen pendientes.

Los originales se copian bajo `uploads/<id>/` y siguen accesibles después de comprimir mediante `list_attachments` y `read_attachment`. Sin proyecto, el chat crea una carpeta de trabajo local. Los borradores se conservan al cambiar de chat y entre cierres de la app; una edición que aún no haya llegado al proceso principal puede perderse si se termina el proceso forzosamente. Seleccionar o previsualizar archivos no usa inferencia de pago.

## Control del escritorio

El controlador implementa capturas de la pantalla principal, clics, doble clic, escritura, teclas y scroll. Solo un agente puede reservar el escritorio simultáneamente. NEXUS se minimiza durante la acción y vuelve después. Las capturas se guardan como adjuntos locales de la tarea, no como base64 dentro del historial o los checkpoints; se rehidratan únicamente al enviarlas a un modelo de visión.

No cambies de ventana mientras el agente actúa. Ventanas elevadas/UAC pueden no aceptar entradas desde una app sin elevación. No se ha validado aún una misión visual completa con un proveedor real: las pruebas actuales verifican código y partes del controlador, no todos los flujos de Windows.

## Cuenta de ChatGPT

Esta revisión usa **OpenRouter**. Utilizar cuenta/suscripción de ChatGPT es distinto de utilizar una API key de OpenAI. Se investigó el App Server oficial de Codex como posible adaptador, pero no se presenta como una conexión ya implementada.

## Persistencia

Bajo la carpeta de datos NEXUS de la cuenta de Windows (fijada a %USERPROFILE%\AppData\Roaming\NEXUS aunque el lanzador redirija %APPDATA%, por ejemplo desde entornos empaquetados con LocalCache; puede cambiarse con NEXUS_DATA_DIR):

- workspace.json: chats, proyectos, servidores, conectores y ajustes mientras se usa el formato JSON; queda congelado tras activar SQLite.
- storage-engine.json y workspace-v1-<uuid>.sqlite: selección y almacén principal después de la activación opcional.
- vault.bin: secretos cifrados.
- tasks/<id>/transcript.jsonl: historial original.
- tasks/<id>/journal.jsonl: eventos y documentación.
- tasks/<id>/checkpoint-*.json: contexto original y resumen.
- tasks/<id>/backup-*.txt: versiones previas de archivos.

En **Configuración → Almacenamiento local** puedes preparar y confirmar SQLite, con todas las tareas pausadas. Crea una copia previa y verifica la migración antes de activarla. Reduce escrituras a registros modificados, pero el historial sigue en memoria y las operaciones son síncronas. No se ha activado en tus datos por las pruebas. Después usa este lanzador actualizado, no el ejecutable antiguo de `release`.

Desde ese panel puedes exportar el estado actual a JSON. No incluye archivos adjuntos ni claves cifradas y puede contener información privada. Si hay problemas con SQLite no se recupera automáticamente el JSON congelado, que carece del trabajo posterior: conserva todos los archivos. [Detalles y pruebas B2](research/RONDA-B2-2026-09-18.md).

**Recuperar una copia** permite revisar un JSON o SQLite y recuperar su estado en una subcarpeta nueva, con verificación y tareas interrumpidas pausadas. No sustituye la sesión abierta ni copia adjuntos, archivos de proyecto, borradores o credenciales. Conserva las rutas originales: revísalas antes de utilizar la recuperación. La activación de esa carpeta no es automática; todavía no es una restauración integral con un clic. [Guía, alcance y pruebas B3](research/RONDA-B3-2026-09-18.md).

Al iniciar, si existen datos JSON de contextos anteriores (por ejemplo, %LOCALAPPDATA%\Packages\*\LocalCache\Roaming\NEXUS), se importan sin borrar nada: primero se crea backup-legacy-<fecha>/ con el estado actual y archivos heredados, después se copian tareas y archivos, y los secretos se unen (los actuales tienen prioridad en caso de colisión). Los orígenes con marcador SQLite se omiten porque su JSON no está actualizado. Las claves heredadas se descifran con un proceso auxiliar que arranca en su contexto original. El origen queda intacto y una importación ya registrada (recoveredFrom) no se repite.

Al cerrar se cancelan las tareas. Al reiniciar, las ejecuciones interrumpidas aparecen pausadas. No se repiten automáticamente herramientas que quedaron pendientes. Retirar un proyecto conserva chats y archivos.

## Investigación y pendientes

### Importación de conectores OpenAPI

En **Conectores → Importar OpenAPI** puedes elegir un archivo JSON local o pegar una definición OpenAPI 3.0/3.1, revisar destinos y seleccionar operaciones. La importación no llama a la API, no lee secretos ni sobrescribe definiciones. Admite inicialmente acceso público/Bearer, parámetros simples de ruta/consulta y cuerpos JSON; los casos no soportados se explican en la vista previa. Límite de cada documento: 2 MB y 500 operaciones, no del catálogo acumulado. [Alcance y guía](research/OPENAPI-2026-09-19.md).

Los contratos importados se consultan por nombre cuando el agente los necesita, sin enviarlos todos en cada turno. Ruta y método se mantienen vinculados al contrato; para cambiarlos, reimporta con otro prefijo. Los conectores manuales siguen funcionando con su formato anterior.

Consulta [el informe de investigación](research/INFORME.md), la [auditoría comparativa](research/AUDITORIA-AGENTIC.md), la [auditoría agregada de sesiones](research/AUDITORIA-SESIONES-LOCAL.md) y [los commits de referencia](research/inventory.json). Se inspeccionaron módulos de trece repositorios públicos; no se ha auditado todo su código ni demostrado superioridad frente a esos productos.

La validación real ya cubre DS4.1 Flash, streaming, herramientas, compresión bajo el techo operativo de 50k, caché de prefijo y tareas dependientes/paralelas. Pendientes relevantes: una misión visual completa con un modelo de visión, worktrees y revisión visual Git, roles/recetas, memoria compartida, navegador DOM, adjuntos, OAuth, programación con app cerrada, actualizador e instalador firmados.

## Desarrollo y verificación

Desde D:/Agents/desktop:

    npm ci
    npm test
    npm run build
    npm start

El empaquetado final se hace con npm run package cuando se cierre la revisión de funciones. Las pruebas unitarias usan respuestas simuladas sin gastar saldo; la integración MCP lanza un proceso local de prueba real. Las pruebas `npm run test:live-*` usan exclusivamente el vault cifrado local y nunca muestran la clave. El smoke test abre Electron con datos aislados y prueba navegación, proyectos, fijados, instrucciones, telemetría, MCP y tamaño de ventana.

Los resultados de la última comprobación se documentan en research/VERIFICACION.md.

Revisión del 13 de septiembre: enlaces del chat operativos, tablas con desplazamiento horizontal, copia de código, snapshots con llamadas paginadas y actualización correcta de mensajes existentes. La compresión manual evita operaciones simultáneas; los reintentos conservan costes desconocidos y el streaming reconoce actividad de herramientas. `npm start -- --smoke-test` usa siempre un almacén temporal nuevo, sin importar chats ni credenciales. Esta ronda pasó 67 pruebas locales y 28 comprobaciones de interfaz sin llamadas de inferencia de pago.
