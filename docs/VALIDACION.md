# Validación de la entrega

Comprobaciones del 2 de noviembre de 2026 en Windows, sobre la copia preparada para GitHub. Node.js `v24.12.0`, npm `11.6.2`. Las dependencias se instalaron desde los lockfiles, sin copiar los `node_modules` originales.

| Comprobación | Resultado |
| --- | --- |
| Desktop: `npm ci --no-audit --no-fund` | Correcto, incluida la instalación del binario Electron |
| Desktop: `npm test` | **195 pruebas aprobadas**, sin fallos ni pruebas omitidas |
| Desktop: `npm run build` | Correcto; HTML, CSS y JavaScript generados en `desktop/ui/` |
| Desktop: `npm start -- --smoke-test` | Correcto; **170 comprobaciones**, perfil temporal aislado |
| Web, raíz: `npm ci --no-audit --no-fund` | Correcto |
| Web, raíz: `npm run build` | Correcto; Vinext genera cliente, servidor y rutas API |
| Revisión de credenciales | Sin coincidencias en la búsqueda de tokens GitHub/proveedor, claves privadas, AWS, JWT y URLs con contraseña en los archivos candidatos |

## Corrección necesaria para reproducir la compilación

La primera compilación de Desktop con sólo sus dependencias instaladas falló: Vite encontraba el PostCSS de la raíz e intentaba cargar `@tailwindcss/postcss`, que pertenece al paquete web. Se definió una configuración PostCSS vacía explícita en `desktop/vite.config.mjs`. Desktop usa CSS normal y ahora su compilación queda aislada de la configuración web.

No se cambió el motor, el esquema de datos ni la configuración del perfil original. El checkout original en `D:/Agents` permanece separado de esta exportación.

La primera ejecución de GitHub detectó una expectativa de prueba no portable: TEMP usa a veces un alias Windows 8.3 (`RUNNER~1`), mientras que `workspacePath` devuelve la raíz real. Se corrigió la expectativa para usar `fs.realpath`, manteniendo los rechazos de escape y de junctions. No se alteró el módulo de rutas.

## Alcance y límites

La prueba Electron se ejecutó fuera de pantalla con un almacén nuevo y comprobó navegación, adjuntos, continuidad, biblioteca, contratos, inspector, almacenamiento y panel de proveedores. El informe final declaró `passed: true`, 170 comprobaciones y ausencia de desbordamiento horizontal a 1500 y 940 píxeles. Los errores de validación deliberados de esas pruebas aparecen en su salida como rechazos esperados.

Se inspeccionó visualmente la captura inicial y se incluye como `docs/images/nexus-desktop.png`: procede del perfil de prueba vacío, sin conversaciones ni credenciales del usuario. Los demás resultados y logs temporales no se publican.

No se hicieron llamadas de inferencia de pago, no se usaron claves personales y no se validó una misión visual de Windows con un modelo real. La compilación web no prueba un despliegue con secretos, autenticación y D1 reales. Vinext avisó de rutas que su análisis estático no puede clasificar; el build terminó correctamente.

La instalación mostró avisos de dependencias transitivas obsoletas. No se actualizaron paquetes como parte de esta transferencia y no se ejecutó una auditoría completa de dependencias. La búsqueda de patrones de secretos tampoco sustituye una auditoría de seguridad.

El workflow `.github/workflows/desktop.yml` reproduce instalación, suite Node y compilación en un runner Windows con Node 24.12.0. No ejecuta las pruebas Electron, inferencia ni empaquetado. Su resultado en GitHub se consulta en la pestaña Actions y es independiente de estas comprobaciones locales.
