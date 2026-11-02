# UI y biblioteca extensible — 19 de septiembre de 2026

## Entrega

Ronda solicitada de interfaz y capacidades reutilizables, sobre la revisión local existente. No se ha creado otro instalador, reiniciado la instancia del usuario ni modificado sus datos reales durante las pruebas.

### Interfaz

- Biblioteca con tarjetas, búsqueda por nombre/descripción/etiquetas, filtros de skills/funciones, páginas de 24 resultados y accesos a REST/MCP.
- Creación, edición y desactivación desde la aplicación. Desactivar conserva el registro; cada edición guarda la revisión anterior. Las revisiones obsoletas se rechazan para no pisar otra edición.
- Ctrl+K: navegación a secciones o chats, búsqueda, flechas y Enter; Escape cierra y restaura el foco. El menú muestra hasta 20 coincidencias; se puede afinar la búsqueda para encontrar otras.
- Configuración con accesos por sección, densidad cómoda/compacta y movimiento reducido persistente en este perfil de interfaz. Estas preferencias no alteran instrucciones ni consumen inferencia.
- Transiciones breves al abrir páginas, paneles y diálogos; sin animar de nuevo los mensajes con cada token. La preferencia de movimiento reducido de Windows o de NEXUS elimina esas animaciones y el suavizado del streaming.
- Fondo blanco, bordes suaves, acento discreto, tarjetas ajustadas y barra lateral con área propia para proyectos/chats: Configuración y saldo permanecen accesibles abajo.

Se corrigió un fallo de foco: el selector conjunto de campos y botones tomaba el botón de cerrar por su posición en el documento, aunque el selector enumerase inputs primero. Ahora prioriza realmente el campo de entrada; el recorrido de Tab incluye textareas.

### Skills y funciones

Una **skill** es un procedimiento textual reutilizable, con nombre, descripción, etiquetas, disponibilidad y revisión. El agente encuentra metadatos con `search_capabilities` y carga el contenido con `get_capability`. No se inyectan todas las instrucciones ni sus nombres en el prefijo global.

Una **función** es una herramienta existente con argumentos predeterminados. `invoke_function` resuelve la definición antes de la aprobación y de registrar efectos. El argumento aportado en la llamada sustituye al predeterminado con la misma clave. Se registra ID/revisión de función y el efecto real de su herramienta, de modo que no evita las aprobaciones ni oculta una escritura como una simple consulta.

Destinos iniciales: listar/leer/buscar/escribir/reemplazar archivos, ejecutar comandos, invocar REST/MCP, leer adjuntos y buscar diario/historial. No hay composición recursiva de funciones, un nuevo motor JavaScript ni un editor de flujos multipaso en esta entrega. Los comandos mantienen los permisos de Windows del usuario y no son un sandbox.

El agente puede crear/actualizar ambas mediante `save_capability`. Guardar no ejecuta la función. Las skills desactivadas no se descubren y las funciones desactivadas no se ejecutan. Para actualizar se necesita la revisión actual.

Ejemplo desde Biblioteca → Nueva función:

    Nombre: Leer instrucciones del proyecto
    Herramienta: read_file
    Argumentos: {"path":"README.md"}

Se utiliza dentro de una tarea con carpeta de proyecto. Una skill puede pedir revisar objetivos, ejecutar pruebas pertinentes y documentar resultados, sin convertir su texto en código ejecutado automáticamente.

## Catálogos grandes y coste

- Sin máximo fijo de número de entradas en la biblioteca. Hay límites por definición y por página para mantener resultados manejables: instrucciones hasta 60.000 caracteres, archivo UTF-8 hasta 160 KB; páginas del agente de 20 y de interfaz de 24.
- REST: lista buscable y paginada; definición completa al abrir; edición con comprobación de versión y retirada desde la interfaz. Los snapshots destinados a la ventana sólo incluyen el número de conectores, no todo el catálogo. El snapshot interno de diagnóstico mantiene el detalle por compatibilidad.
- MCP: descubrimiento paginado hacia el agente y carga del esquema de una herramienta por nombre. La interfaz permite buscar/paginar herramientas y los estados incluyen una vista previa de hasta 20 por servidor, con descripciones acotadas. El manager aún obtiene y mantiene el catálogo completo del servidor al conectar.
- Añadir skills/funciones no amplía el conjunto de herramientas enviado por cada definición: se usan cuatro operaciones genéricas estables. Esas cuatro operaciones sí tienen un coste fijo de contexto añadido. No se ha medido un ahorro real de facturación ni cache hit de esta ronda.

Prueba sintética: **10.000 metadatos en memoria**, búsqueda y página de 20 elementos. JSON devuelto: **2.826 bytes**; una ejecución dentro de la suite midió **10,12 ms**. No mide arranque con 10.000 archivos físicos, latencia del modelo, p95, RAM total ni toda la interfaz. La búsqueda es lineal y el índice de metadatos permanece en memoria; no equivale a escalabilidad infinita.

## Persistencia y límites

Las definiciones se almacenan en `capabilities/<uuid>.json`; revisiones anteriores bajo `capabilities/history/<uuid>/`. Se usa escritura temporal, sincronización y renombrado. Una publicación fallida conserva la revisión anterior. Los archivos dañados se mantienen y se informa de su número, sin ignorarlos silenciosamente. La aplicación usa una única instancia por carpeta de datos; no se promete coordinación transaccional entre editores externos independientes.

La biblioteca es propia de NEXUS: no importa todavía paquetes `SKILL.md`, plugins de otras aplicaciones ni especificaciones OpenAPI. Los conectores siguen siendo REST básico con referencia Bearer, idempotencia y conciliación opcionales, no un soporte universal de OAuth o de todos los esquemas de autenticación.

**Conservar la carpeta `capabilities` al respaldar.** La exportación/recuperación JSON del estado no incluye esa biblioteca, igual que no incluye adjuntos o vault; el asistente de recuperación lo advierte. No guardar secretos dentro de instrucciones, argumentos, URLs o descripciones. Los textos del usuario pueden contener datos privados aunque el vault no se copie.

El arranque de la biblioteca lee sus archivos para construir metadatos, y los guardados siguen siendo síncronos. Las definiciones REST siguen dentro del estado principal y su persistencia aún tiene coste proporcional al catálogo. La próxima fase de escala debe mover indexación/I/O fuera del proceso principal y medir carga real en disco, no sólo ampliar el número de tarjetas.

## Verificación

- **157 pruebas automáticas**, cero fallos. Incluyen persistencia/revisiones, error de publicación, archivos dañados, límites UTF-8, descubrimiento sin cargar cuerpos, catálogo de 10.000 metadatos, paginación MCP/REST y snapshots acotados.
- Bucle de agente simulado que crea una función y la ejecuta: pasa por la aprobación real de `write_file`, escribe en una carpeta temporal y deja el efecto observado. Otra prueba rechaza la aprobación y comprueba que no escribe. No se ha probado esta creación con un modelo real en esta ronda.
- **135 comprobaciones Electron** fuera de pantalla: CRUD de skills/funciones, búsqueda/paginación, revisión obsoleta, guardado sin ejecución, edición/retirada de REST, teclado/foco, preferencias tras recarga, navegación y regresiones anteriores.
- Construcción correcta; inspección de capturas a 940 px y comprobaciones de ancho también en el recorrido inicial a 1500 px. No sustituye una auditoría completa de accesibilidad o pruebas prolongadas de uso.
- Evidencia: `test-results/ui-biblioteca-2026-09-19/smoke/`, incluidas `library.png`, `skill-editor.png` y `appearance.png`.

Comandos: `npm test`, `npm run build`, `npm start -- --smoke-test`. **0 USD de inferencia**, sin control de escritorio ni pruebas con credenciales reales.

## Próximas ampliaciones

1. Importador OpenAPI con vista previa de endpoints, autenticación y selección antes de registrar.
2. Importación/exportación de paquetes de skills con recursos y versiones, sin autoejecutar código al importar.
3. Índice persistente y carga asíncrona para medir bibliotecas grandes desde disco.
4. Editor guiado de argumentos de funciones, validación por esquema y pruebas explícitas de conectores con resultados visibles.
5. Afinidad de caché e inspector de contexto, pendientes del plan previo: comparar coste por tarea correcta con una muestra pequeña antes de modificar defaults.
