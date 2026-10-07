# App de planta – Producción GO (Grupo OSAR)

La planilla sigue siendo la base de datos. La app de planta se instala en el celular, funciona sin conexión y sincroniza con la planilla cuando vuelve internet.

## Archivos

| Archivo | Va en |
|---|---|
| `Code.gs` | Apps Script de la planilla (backend) |
| `index.html`, `sw.js`, `manifest.webmanifest`, `icon-180.png`, `icon-192.png`, `icon-512.png` | Publicación web (GitHub Pages) |

## 1. Backend en la planilla (10 min)

1. Abrí la planilla **DB_Produccion_Licor_YM** → **Extensiones → Apps Script**.
2. Borrá el contenido de `Código.gs`, pegá todo `Code.gs` y guardá (ícono de disquete).
3. Arriba, en el selector de funciones, elegí **setup** y tocá **▶ Ejecutar**. Google pide autorizar: aceptá con tu cuenta.
   - Esto agrega la columna **PIN** en la pestaña *Usuarios* y asigna un PIN provisorio de 4 dígitos a cada usuario.
4. En la pestaña **Usuarios** completá una fila por persona: **Nombre** (con el que aparece en la app, sin repetir), **Rol** (Operario, Supervisor, Aprobador o Admin), **Activo** = TRUE y **PIN**. El email es opcional.
5. **Implementar → Nueva implementación → App web**:
   - Ejecutar como: **Yo**
   - Usuarios con acceso: **Cualquier usuario**
6. Copiá la **URL de la app web** (termina en `/exec`).

## 2. Publicar la app (10 min, una sola vez)

1. Repositorio: `github.com/dmassei/produccion-GO` (público).
2. **Add file → Upload files** y subí los 6 archivos de la app (no subas `Code.gs`).
3. **Settings → Pages → Branch: main / (root) → Save**.
4. En uno o dos minutos la app queda en `https://dmassei.github.io/produccion-GO/`.

El repositorio solo contiene la app; los datos quedan en la planilla y para leerlos o escribirlos hace falta el PIN.

## 3. Instalar en cada celular

1. Armá este enlace (una vez) y mandáselo a cada persona:
   `https://dmassei.github.io/produccion-GO/?api=URL_EXEC`
   (reemplazá `URL_EXEC` por la URL del paso 1.6).
2. Abrirlo **con conexión**, elegir el nombre e ingresar el PIN.
3. Agregar a la pantalla de inicio:
   - **Android (Chrome):** menú ⋮ → *Agregar a la pantalla principal* / *Instalar app*.
   - **iPhone (Safari):** compartir → *Agregar a inicio*.
4. Desde ese momento la app abre y carga sin conexión. Cada persona tiene que ingresar una vez con internet en ese equipo.

## Número de lote

La app sugiere `PREFIJO-AAMMDD` (por ejemplo `LY-261003`). El prefijo sale de una columna **Prefijo_lote** en la pestaña *Productos*: agregala y poné `LY` para el licor de yerba mate. Cada producto nuevo lleva el suyo; si falta, usa `LT`. El número se puede editar antes de crear el lote.

## Cómo funciona sin conexión

- Todo lo que se carga queda guardado en el teléfono y se envía solo cuando vuelve la conexión. El indicador de arriba muestra “N sin enviar” o “Al día”.
- La hora de cada carga es la del teléfono; la planilla guarda además la hora de llegada (**Hora_sync**). Dejá la fecha y hora del teléfono en automático.
- Si el servidor rechaza algo (por ejemplo, PIN cambiado o falta de permiso), aparece un aviso rojo en el inicio con opción de reintentar o descartar.
- Antes de iniciar una producción, abrí la app con conexión para que el lote quede descargado.

## Corregir una carga mal registrada

Cualquier usuario, mientras el lote no esté cerrado: tocá el insumo → en *Cargas registradas*, **Anular** junto a la carga equivocada → motivo y, si querés, la **cantidad correcta**. La carga original no se borra: queda tachada con quién la anuló, cuándo y por qué, y deja de sumar. La corrección se registra con la misma hora y lote, y el reporte de trazabilidad muestra ambas. Con el lote cerrado, solo un Admin puede corregir.

## Pasos vinculados a la bitácora

En la pestaña *Pasos*, la columna **Tipo_evento** vincula un paso con un tipo de evento (por ejemplo "Revolver y rotar bolsas" → `Revuelto, Rotación`). La primera vez que corre la versión nueva del servidor se completa sola para revolver/rotar, escurrido y filtrado; se puede editar para otros pasos.

- Al registrar en *Bitácora* un evento de ese tipo, la app marca hecho el paso pendiente de fecha prevista más cercana, con la hora y el usuario del evento ("desde bitácora"). Cada evento cierra un solo paso.
- Tocar **Hecho** en un paso vinculado abre directamente el formulario del evento con el tipo elegido: un solo registro sirve para las dos cosas.
- Si un Admin borra el evento, el paso vuelve a pendiente.
- Los eventos que ya existían se vinculan solos al actualizar.
- **Pasos que se repiten:** la columna **Repetir_cada_h** de *Pasos* (48 en "Revolver y rotar bolsas") programa el siguiente a esa cantidad de horas desde que se hizo el anterior, hasta el fin de la maceración de la receta. Vale igual si se registra desde Proceso o desde Bitácora. Dejarla vacía desactiva la repetición.

## Fotos en la bitácora

- En cada evento de *Bitácora*: **📷 Agregar foto**, con **Tomar foto** (abre la cámara) o **Galería**. Sirve para eventos ya registrados: la foto queda con la fecha y hora del evento.
- Al **registrar un evento** también se pueden sacar o elegir fotos en el mismo formulario.
- La app reduce cada foto (máx. 1600 px) y la guarda en el teléfono hasta sincronizar; funciona sin conexión.
- El servidor las sube a Drive, en la carpeta **"Producción GO - Fotos"** (una subcarpeta por lote). La pestaña *Fotos* guarda evento, lote, usuario, hora de subida y una miniatura. Tocando la miniatura se ve la foto completa; el reporte de trazabilidad las incluye.
- Un Admin puede borrar una foto desde el visor (queda en Auditoría y el archivo va a la papelera de Drive).
- **Permiso de Drive:** al actualizar el código, ejecutá una vez `setup` desde el editor de Apps Script y aceptá el permiso nuevo; después publicá la nueva versión.

## Stock de insumos

El stock se calcula solo: **cantidad recibida − cargas (sin las anuladas) ± ajustes**, por lote de insumo.

- **Pantalla Stock** (inicio → *Stock de insumos*): disponible por insumo y por lote, con alertas de stock bajo el mínimo y de lotes vencidos o que vencen en 30 días.
- **Al crear un lote** la app compara lo que necesita la receta con el stock y avisa qué falta (no bloquea).
- **Al cargar** sugiere el lote que vence primero y avisa si al lote elegido no le alcanza. Una producción puede usar varios lotes del mismo insumo: cada carga registra el suyo.
- **Unidades:** en carga, recepción y ajustes se puede elegir kg o g (L o ml). La app convierte a la unidad de trabajo del insumo, que es en la que guarda todo.
- **Ajustes de stock** (Supervisor o superior, desde el lote en la pantalla Stock): inventario físico (se ingresa lo contado y la app calcula la diferencia), merma, descarte o vencido. Van con motivo y quedan en *Auditoria*.
- **Configuración** (Panel de control → Insumos): *Controla stock* = No para lo que no se controla (por ejemplo, el agua) y *Stock mínimo* para las alertas.
- **Para arrancar:** registrá el inventario actual como una recepción por cada lote que haya en planta (notas: "Inventario inicial").

Las columnas y la pestaña *Ajustes_Stock* se crean solas la primera vez que se usa la versión nueva del servidor.

## Usuarios administradores

El rol **Admin** es un ingreso aparte, pensado solo para correcciones. Cada persona que lo necesite tiene **dos filas** en *Usuarios*, con PIN distintos:

| Nombre | Rol | Uso |
|---|---|---|
| Adriana | Aprobador | Trabajo diario |
| Adriana · Admin | Admin | Solo para corregir datos |

Así, en el trabajo diario nadie puede borrar por error. Con un usuario Admin el encabezado de la app se pone **rojo**.

**Panel de control** (solo Admin, desde el inicio):
- Corregir o borrar cargas, eventos y controles; corregir pasos, cantidades teóricas y datos del lote.
- **Eliminar lote** (para pruebas): pide escribir el número de lote y borra todos sus registros.
- Proveedores, insumos y materia prima recibida: alta y corrección. Lo que ya se usó en producción no se puede borrar, solo corregir; un insumo que no se usa más se marca inactivo.
- Cada corrección o borrado pide un **motivo** y queda en la pestaña **Auditoria** (fecha, usuario, qué cambió, valor anterior y nuevo). La pestaña se crea sola la primera vez.

Un lote real que salió mal no se elimina: el Aprobador lo cierra como **Descartado** con el motivo.

## Permisos por rol

| Acción | Operario | Supervisor | Aprobador | Admin |
|---|---|---|---|---|
| Registrar cargas, pasos, bitácora y controles | ✓ | ✓ | ✓ | ✓ |
| Crear lotes, cambiar etapa, cargar litros obtenidos y envasado | | ✓ | ✓ | ✓ |
| Recepción de materia prima | | ✓ | ✓ | ✓ |
| Crear lotes por encima de la escala validada (ensayo) | | | ✓ | ✓ |
| Aprobar / reprocesar / descartar y cerrar el lote | | | ✓ | ✓ |
| Panel de control: corregir, borrar, proveedores e insumos | | | | ✓ |

Recetas y usuarios se editan directamente en la planilla.

## Cambios futuros

- **Si cambiás `Code.gs`:** Implementar → Gestionar implementaciones → ✏️ → Versión: **Nueva versión** → Implementar. La URL no cambia.
- **Si cambiás la app:** subí los archivos a GitHub y en `sw.js` subí el número de versión en `sw.js` (`go-v12` → `go-v13`) (así los celulares toman la versión nueva).
- **Receta nueva o ajustada:** agregá la versión en *Recetas*, *Receta_Items* y *Pasos* con estado *Vigente* y pasá la anterior a *Obsoleta*. Los lotes viejos conservan la receta con la que se hicieron.

## Limpieza opcional

La app de AppSheet y la pestaña *Diseño_AppSheet* ya no se usan: se pueden borrar sin afectar los datos.
