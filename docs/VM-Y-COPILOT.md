# Trabajar en una VM con GitHub Copilot

## Preparación

Necesitas Git, Node.js 24.12.0, acceso al repositorio y un editor con el Copilot habilitado por tu organización. Para ejecutar y validar la aplicación nativa usa Windows. En otros sistemas puedes editar código y ejecutar parte de las comprobaciones, pero no validar el controlador Windows.

Las dependencias se descargan de npm; Electron descarga además un binario. Para proxy/certificados utiliza la configuración proporcionada por TI, sin desactivar TLS. Poder usar Copilot no garantiza permiso para ejecutar Electron o acceder a proveedores externos.

```powershell
git clone https://github.com/Ezequiel24123z/Nexus.git
cd Nexus
git switch -c mejora/primera-revision
cd desktop
npm ci
npm test
npm run build
$env:NEXUS_TEST_DATA = Join-Path $env:TEMP ('nexus-dev-' + [guid]::NewGuid())
npm start
```

Si PowerShell bloquea `npm.ps1`, usa `npm.cmd` en los mismos comandos; no necesitas cambiar políticas del sistema. La variable de prueba evita importar perfiles antiguos y permanece en esa terminal hasta cerrarla o ejecutar `Remove-Item Env:NEXUS_TEST_DATA`. Reutiliza la misma ruta si quieres conservar el perfil de desarrollo entre aperturas.

Abre en el editor la carpeta **Nexus completa** para que Copilot vea instrucciones y documentación. Los comandos de Desktop se ejecutan dentro de `Nexus/desktop`, cuyo paquete es independiente del de la raíz.

## Contexto de Copilot

Se incluyen `.github/copilot-instructions.md` y `AGENTS.md`. Su lectura depende del cliente, configuración y políticas; si muestra referencias, comprueba que utilice las instrucciones. [Documentación oficial de GitHub](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions).

Encargo inicial para pegar en Copilot:

> Lee .github/copilot-instructions.md, docs/ARQUITECTURA.md, docs/ESTADO-Y-ROADMAP.md y docs/VALIDACION.md. Trabajaremos en NEXUS Desktop. Reproduce pruebas y compilación desde desktop/, resume las limitaciones vigentes y propón una primera mejora pequeña de la hoja de ruta con criterio de aceptación. Conserva persistencia, compresión, costes y recuperación. Usa datos temporales y no ejecutes test:live ni utilidades de vault.

No necesitas API keys para editar, compilar o ejecutar `npm test`. Para generar respuestas reales configura una clave autorizada de OpenRouter o Arli.ai dentro de NEXUS. Las claves del ordenador original no se trasladan mediante Git. Copilot no es actualmente un proveedor de inferencia de NEXUS.

## Guardar mejoras

Desde la raíz, revisa los cambios antes de guardarlos:

```powershell
git status
git diff
git add desktop docs .github AGENTS.md
git commit -m "Describe la mejora realizada"
git push -u origin mejora/primera-revision
```

Abre una pull request. La automatización instala, ejecuta la suite Node y compila Desktop en Windows; no ejecuta inferencia, control visual, pruebas Electron ni empaquetado. Para UI revisa también una sesión real aislada de Windows.

Para sincronizar la rama principal sin cambios locales pendientes:

```powershell
git switch main
git pull --ff-only
```
