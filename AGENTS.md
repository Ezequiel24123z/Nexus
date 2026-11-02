# Desarrollo de NEXUS

Lee `.github/copilot-instructions.md` para el mapa y las invariantes. La aplicación principal está en `desktop/`; la raíz tiene otro paquete para el prototipo web.

Usa Node 24.12.0. Para Desktop: `cd desktop`, `npm ci`, `npm test`, `npm run build`. `npm start` carga la interfaz compilada. Para abrirla sin tocar perfiles anteriores usa `NEXUS_TEST_DATA` con una ruta temporal nueva.

No ejecutes pruebas de inferencia de pago ni utilidades de vault en tareas rutinarias. No publiques perfiles, chats, secretos o recuperaciones. Conserva continuidad, originales/checkpoints, efectos externos y costes desconocidos según las instrucciones de Copilot.

Consulta `docs/ESTADO-Y-ROADMAP.md` y distingue implementación de validación. No cambies ambas aplicaciones a la vez salvo que el encargo lo requiera.
