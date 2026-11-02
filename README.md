# NEXUS

Espacio de trabajo de agentes de IA con chats, proyectos, herramientas locales, conectores REST/MCP y seguimiento de contexto, tokens y coste. La aplicación principal es **NEXUS Desktop para Windows**, construida con Electron, React y Vite. Admite **OpenRouter y Arli.ai**.

Este repositorio reúne el código actual de escritorio, el prototipo web original y los informes de diseño, evolución y verificación. Es una revisión de desarrollo; el paquete conserva la versión `0.2.0`.

![Inicio de NEXUS con un perfil de prueba vacío](docs/images/nexus-desktop.png)

## Empezar con Desktop

Requisitos: Windows, Git y **Node.js 24.12.0**, versión usada para esta entrega y fijada en `.node-version`.

```powershell
git clone https://github.com/Ezequiel24123z/Nexus.git
cd Nexus/desktop
npm ci
npm test
npm run build
npm start
```

Configura la clave de OpenRouter o Arli.ai dentro de NEXUS. Copilot sirve para desarrollar el programa; su suscripción no proporciona las credenciales de inferencia de NEXUS.

Después de cambiar la interfaz, ejecuta `npm run build` antes de abrirla: `npm start` carga `desktop/ui/`, generado por ese comando. `Abrir NEXUS.cmd` también necesita las dependencias y la interfaz compilada.

## Documentación

| Documento | Contenido |
| --- | --- |
| [VM y Copilot](docs/VM-Y-COPILOT.md) | Instalación, claves, ramas y primer encargo sugerido |
| [Arquitectura](docs/ARQUITECTURA.md) | Mapa de módulos y reglas de continuidad |
| [Estado y próximos pasos](docs/ESTADO-Y-ROADMAP.md) | Funciones actuales, límites y trabajo pendiente |
| [Validación de la entrega](docs/VALIDACION.md) | Comprobaciones actuales y sus límites |
| [Procedencia](docs/PROCEDENCIA.md) | Origen de esta instantánea y exclusiones |
| [Manual Desktop](desktop/README.md) | Uso detallado y persistencia |
| [Investigación](docs/INVESTIGACION.md) | Índice de planes, auditorías y verificaciones históricas |
| [Instrucciones de Copilot](.github/copilot-instructions.md) | Contexto permanente del repositorio |

## Dos aplicaciones independientes

- `desktop/`: aplicación Windows, motor, interfaz, pruebas e investigación.
- `app/`, `lib/`, `db/`, `components/`: prototipo web con Vinext/React, Cloudflare Workers y D1. No comparte el motor completo de Desktop.
- `docs/`: guías de incorporación y entrega.
- `.github/`: instrucciones de Copilot y validación automática de Desktop.

Los dos `package.json` son independientes. Para Desktop instala y ejecuta los comandos **dentro de `desktop/`**; no necesitas las dependencias de la raíz.

El prototipo web conserva su configuración en [WEB-STARTER.md](docs/WEB-STARTER.md). Sus comandos, desde la raíz, son `npm ci`, `npm run build` y `npm run dev`. Compilar no configura secretos, autenticación ni bases de datos de un despliegue. Las APIs web usan bindings de Cloudflare y claves de servidor, no el vault de Desktop.

## Datos y credenciales

Esta entrega contiene código y documentación. Se excluyen chats, adjuntos, vaults, bases de datos reales, copias de recuperación, dependencias y resultados generados. Los secretos de Desktop se guardan mediante Electron `safeStorage` en el perfil local; hay que introducirlos de nuevo en otro equipo.

Para abrir una sesión de desarrollo aislada en PowerShell, antes de `npm start`:

```powershell
$env:NEXUS_TEST_DATA = Join-Path $env:TEMP ('nexus-dev-' + [guid]::NewGuid())
npm start
```

`NEXUS_TEST_DATA` impide importar automáticamente perfiles anteriores. `NEXUS_DATA_DIR` cambia el directorio normal de datos, pero no desactiva esa importación.

`npm test` usa datos sintéticos y no necesita claves de inferencia. Los comandos `test:live*` pueden consumir saldo y quedan fuera de la validación normal. El control de escritorio requiere Windows.

Se conservan los avisos de licencia de terceros incluidos. Esta exportación no añade una licencia general para el código propio.
