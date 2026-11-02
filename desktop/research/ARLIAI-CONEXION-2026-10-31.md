# Arli.ai: diagnóstico y corrección del 31 de octubre de 2026

El chat del usuario usaba `arliai/GLM-4.6-Derestricted-v5` con streaming y razonamiento `xhigh`. Su error persistido era `fetch failed`; la versión anterior no guardaba el código de la causa de transporte, por lo que no es posible reconstruir el motivo exacto de esa desconexión.

## Comprobaciones reales

- La clave cifrada de NEXUS permitió consultar el catálogo de cuenta: HTTP 200, con GLM y DeepSeek habilitados y contexto de cuenta de 131072 tokens.
- GLM y DeepSeek respondieron a pruebas mínimas de generación: HTTP 200.
- En otras peticiones de esa misma sesión, GLM devolvió HTTP 503. La respuesta fue `No servers available for this model type. Please contact support.` La disponibilidad anunciada en el catálogo público no garantiza que una petición de generación encuentre servidor.
- Los ensayos sólo enviaron mensajes sintéticos y esquemas de herramientas. No ejecutaron herramientas del modelo, no abrieron ventanas de pruebas ni modificaron chats, claves o ajustes del usuario.
- Un primer programa de diagnóstico provocó un aviso EPIPE al escribir en una salida cerrada. Se retiró ese programa. El diagnóstico restante escribe únicamente resultados de transporte en un archivo, sin imprimir claves ni contenidos de chats.

## Corrección

El motor comparte un único reintento para desconexiones temporales, errores HTTP 408/502/503/504 y streams cortados antes de emitir salida. Registra ambos intentos por separado. No repite una respuesta que ya haya emitido texto, razonamiento o llamadas de herramientas; tampoco reintenta credenciales rechazadas ni problemas de certificado.

Los errores de red se explican en español y no exponen las causas internas ni el cuerpo del proveedor. El botón de comprobación distingue verificar la clave de confirmar la disponibilidad de generación.

## Validación

195 pruebas automáticas pasaron, incluidas regresiones para reconexión, HTTP 503/401, límites de reintento, preservación de respuesta parcial y certificados. Compilación de la interfaz comprobada por separado.

La aplicación que ya esté abierta necesita cerrarse y abrirse de nuevo para cargar el motor corregido. No se reinició ni se manejó el escritorio del usuario. La disponibilidad de los servidores de Arli.ai sigue dependiendo del proveedor.
