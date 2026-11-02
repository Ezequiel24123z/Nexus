# Compresión de contexto: diseño de NEXUS

## Qué se puede afirmar sobre Codex

La implementación interna de Codex no está publicada como código reutilizable. La documentación oficial de OpenAI sí describe el patrón aplicable a agentes de larga duración: la API Responses puede compactar un estado conversacional en un elemento opaco y cifrado, hecho para **continuar** el trabajo y no para inspeccionarlo. Recomienda compactar tras fases con muchas herramientas, planificar antes de alcanzar la ventana y conservar el prompt funcionalmente idéntico al reanudar. También indica que el estado debe preservar acciones completadas, supuestos activos, IDs, resultados de herramientas, bloqueos y el siguiente objetivo.

NEXUS no puede utilizar ese objeto opaco con DeepSeek u otros modelos a través de OpenRouter Chat Completions. Por ello implementa el mismo contrato de continuidad de forma local y auditable, sin afirmar que reproduce el mecanismo privado de Codex.

Fuente: [Model guidance / Compaction de OpenAI](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2).

## Política aplicada en NEXUS

1. **Prefijo estable.** Instrucciones globales, proyecto y objetivo se emiten como el primer mensaje de sistema, sin mezclarles resumen, efectos ni recordatorios que cambian. Esto mantiene un prefijo cacheable en cada paso y tras cada compresión.
2. **Umbral explícito.** La ventana operativa predeterminada es 50.000 tokens y el slider elige el porcentaje de activación; el valor actual de 95% compacta cerca de 47.500 tokens. No limita la salida normal del proveedor.
3. **Cápsula de continuidad estructurada.** La compresión exige: objetivo y restricciones, hechos verificados, cambios/rutas/artefactos, herramientas y efectos, incertidumbres, plan activo y siguiente acción. Los datos desconocidos se marcan en vez de inventarse.
4. **Tramo reciente conservado.** Se mantiene una pequeña cola válida de mensajes recientes (entre 3k y 12k tokens según la ventana) para que el siguiente paso conserve el estado inmediato. Si el corte cae en una respuesta ordinaria, se prioriza la siguiente instrucción de usuario; las parejas de herramienta no se parten.
5. **Recuperación completa.** Todo el historial previo a la compresión queda en `checkpoint-N.json`, con el resumen anterior. El diario conserva sólo una vista previa y métricas, no duplica el resumen completo.
6. **Sin reasoning reenviado.** Los detalles de razonamiento almacenados se eliminan tanto del contexto habitual como del material de compresión por bloques. Los originales locales siguen recuperables en los checkpoints.
7. **Degradación explícita.** Si un resumen se corta, NEXUS pide continuación hasta dos veces. Si no puede completarlo, lo registra como degradado y conserva el original; nunca finge una compresión íntegra.

## Coste y límites

- La compresión es una llamada del modelo y aparece como tal en coste, tokens y telemetría.
- Cuando un historial único es demasiado grande, se procesa por bloques que dejan margen de salida para el resumen, y luego se fusionan.
- La compresión no se ejecuta simplemente por abrir la app o migrar un chat antiguo: se ejecuta antes de su próxima llamada o manualmente. Así no genera coste inesperado.
- La interfaz muestra cuándo un chat heredado se comprimirá en la siguiente ejecución.

## Verificación

La suite cubre el umbral de 50k, checkpoints, fragmentación, continuaciones de resumen truncado, conservación de cola reciente, estabilidad del prefijo, privacidad de reasoning y reanudación. La prueba de integración real usa la clave local cifrada y sólo imprime métricas agregadas; puede guardar el informe en `NEXUS_LIVE_REPORT_PATH` al cambiar el algoritmo o el modelo de prueba.
