# Ronda de interfaz, streaming y calidad — 17 de septiembre de 2026

## Entregado

- Diseño blanco más uniforme: espaciado, jerarquía de títulos, mensajes, barra lateral, estados, editor y telemetría desplegable.
- Fragmentos de texto presentados progresivamente, con convergencia acotada. Las ráfagas grandes se muestran inmediatamente; no se reproduce artificialmente una respuesta larga. Respeta la preferencia de movimiento reducido.
- Renderizado Markdown memoizado y componentes estables: las tablas mantienen su desplazamiento horizontal durante las actualizaciones. Bloques de código con lenguaje y copia; copia del mensaje completo con confirmación temporal.
- «Volver al final» cuando se lee arriba. El streaming no fuerza volver abajo. El seguimiento se mantiene al crecer el editor.
- Editor multilínea autoajustable, con altura máxima visual y desplazamiento interno. Pausa accesible junto al botón de enviar; sigue siendo posible mandar instrucciones de seguimiento.
- Respuesta parcial recuperada identificada como «Recuperada · incompleta»; no se presenta como tarea terminada.
- Compresión manual con explicación del contexto actual, umbral y resultado anterior. Si el resumen aumentó los tokens, se muestra ese aumento; el aviso no bloquea la compresión.

## Correcciones de fiabilidad asociadas

El texto en curso se escribe incrementalmente en un archivo por tarea, junto con identificador y uso reportados por el proveedor. Al reiniciar se recupera lo recibido antes de la caída y no se duplica una respuesta ya guardada. No se ejecutan herramientas a partir de argumentos parciales recuperados. Los fallos de escritura no provocan una llamada extra al proveedor. No se guardan credenciales ni contenido de razonamiento en ese registro.

Esto no migra toda la persistencia: otros eventos todavía guardan el estado completo. Tampoco garantiza recuperación de texto aún no recibido ni durabilidad tras un corte eléctrico. El cierre normal y la terminación forzada del proceso son escenarios diferentes.

## Verificación

- `npm test`: **105 aprobadas, 0 fallos**; incluye proceso hijo terminado forzosamente, Unicode, cola truncada, deduplicación, costes y suavizado acotado.
- `npm run build`: correcto.
- `npm start -- --smoke-test`: **67 comprobaciones**, almacén aislado y Electron fuera de pantalla. Prueba flujo real del renderer/puente con tareas y proveedor sintéticos. No usa control del escritorio ni datos de chats reales.
- Capturas revisadas de tablas/código, streaming, recuperación y ajustes de compresión. Sin desbordamiento horizontal global detectado en los anchos comprobados de 940 y 1500 px.
- `git diff --check`: sin errores de espacios; advertencias de normalización LF/CRLF en Windows.
- Validación adicional real: una llamada a `deepseek/deepseek-v4.1-flash`, 3.049 tokens de entrada, 8 de salida, coste reportado **0,00046215 USD**. Identificador persistido, sin `max_tokens` y sin duplicación tras reabrir el almacén. La llamada breve reportó 0 tokens cacheados: no es un ensayo de eficiencia de caché.

Evidencia visual y resultados: `test-results/revision-ui-2026-09-17/smoke/`. Resultado de la llamada: `test-results/revision-stream-recovery-2026-09-17/live.json`.

## Siguiente bloque recomendado

1. Medir fluidez con historiales grandes y múltiples chats en streaming; decidir la virtualización a partir de mediciones, conservando selección de texto y posición de lectura.
2. Separar historial, eventos y llamadas del snapshot global para reducir trabajo síncrono en sesiones largas.
3. Mejorar navegación por búsquedas dentro del chat y por archivos/cambios producidos, con retorno al mensaje de origen.

El cliente está construido, pero no se ha generado un instalador nuevo ni reiniciado la aplicación personal que estaba abierta. Para cargar el cliente actualizado con el lanzador del proyecto hay que cerrar y volver a abrir NEXUS, preferentemente sin tareas en curso.
