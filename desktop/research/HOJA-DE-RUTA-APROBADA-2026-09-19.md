# Hoja de ruta aprobada — 19 de septiembre de 2026

El usuario aprobó las siete líneas de mejora. Se ejecutan por entregas con pruebas, sin considerar la hoja completa terminada por añadir una primera pantalla.

| Línea | Estado | Criterio de entrega |
| --- | --- | --- |
| Contexto, caché y gasto | En verificación: inspector, detalle acotado, coste por generación/compresión, historial y afinidad opt-in | Pruebas locales y Electron, lectura sin API, datos desconocidos explícitos; ahorro real pendiente de experimento |
| Conectores sin escribir JSON | Pendiente | Formularios por contrato, revisión de petición, prueba explícita con diagnóstico y efectos inciertos visibles |
| Memoria editable de proyecto | Pendiente | Fuente, fecha, ámbito y revisión; recuperación por búsqueda y pruebas de continuidad tras compresiones |
| Fluidez a gran escala | Parcial previo; ampliación pendiente | I/O fuera del proceso principal, lectura parcial desde disco y mediciones con streams concurrentes |
| Paquetes de skills y recetas | Pendiente | Importación/exportación versionada, revisión de cambios y ausencia de ejecución al importar |
| UI diaria y regresiones visuales | En curso transversal | Foco/teclado, streaming sin arrastre, estados claros y controles realmente visibles, no sólo presentes en el DOM |
| Navegador y documentos | Pendiente de ampliar | Navegación por tarea y adaptadores PDF/Office con referencias y extracción reutilizable |

Primero se verifica cada entrega antes de integrar la siguiente. No se ejecutan pruebas contra APIs reales mutantes por defecto. Los ensayos del desarrollo usan almacenes temporales; el perfil del usuario y las tareas que tenga abiertas se conservan. No se crea instalador final ni automatización de trabajo en segundo plano en esta fase.

La afinidad de proveedor se incorpora como opción experimental desactivada: los mecanismos documentados no demuestran ahorro para la carga concreta de NEXUS. Se debe comparar coste por tarea verificada, latencia y continuidad, no maximizar aisladamente un porcentaje de caché.
