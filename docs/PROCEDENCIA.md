# Procedencia y alcance

Instantánea del 2 de noviembre de 2026 del árbol de trabajo de NEXUS en `D:/Agents`, preparada por separado para conservar el checkout original y su remoto.

- Commit de referencia original: `5f5cb606fc9131785364e3d920c7a5f868074740`.
- Incluye cambios locales posteriores sin commit: motor, interfaz, pruebas y documentación. Ese SHA no representa por sí solo el contenido completo exportado.
- Se copiaron 227 archivos de código/configuración/documentación y la plantilla vacía `.env.example`; se añadieron guías, instrucciones y validación de GitHub.
- El nuevo repositorio empieza con esta instantánea revisada; no publica el historial Git anterior. Los informes y el inventario conservan contexto histórico.
- El README del starter web se conserva en `docs/WEB-STARTER.md`.
- Se aisló la configuración PostCSS de Vite en Desktop: antes heredaba la configuración web y fallaba al compilar con sólo sus propias dependencias instaladas. No se cambió el motor del agente.

Se incluyen ambas aplicaciones, sus lockfiles, pruebas sintéticas, utilidades de desarrollo, migraciones, informes, planes y avisos de terceros existentes.

Se excluyen dependencias, compilaciones, instaladores y resultados de pruebas; perfiles, chats, adjuntos, vaults y bases de datos reales; secretos y logs del usuario; los repositorios externos de investigación en `desktop/research/sources/`; las carpetas ajenas `CitiesDineroX2`, `.nexus-scratch` y el archivo local `nexus-operator.tar.gz`.

Las URLs y commits de las fuentes externas siguen en `desktop/research/inventory.json`. Los informes históricos enlazan a veces evidencias `test-results/` y rutas locales: no están adjuntas al repositorio. Para la entrega actual consulta [VALIDACION.md](VALIDACION.md).
