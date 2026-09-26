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

## Permisos por rol

| Acción | Operario | Supervisor | Aprobador | Admin |
|---|---|---|---|---|
| Registrar cargas, pasos, bitácora y controles | ✓ | ✓ | ✓ | ✓ |
| Crear lotes, cambiar etapa, cargar litros obtenidos y envasado | | ✓ | ✓ | ✓ |
| Crear lotes por encima de la escala validada (ensayo) | | | ✓ | ✓ |
| Aprobar / reprocesar / descartar y cerrar el lote | | | ✓ | ✓ |

Recetas, insumos, proveedores y usuarios se editan directamente en la planilla.

## Cambios futuros

- **Si cambiás `Code.gs`:** Implementar → Gestionar implementaciones → ✏️ → Versión: **Nueva versión** → Implementar. La URL no cambia.
- **Si cambiás la app:** subí los archivos a GitHub y en `sw.js` cambiá `go-v1` por `go-v2` (así los celulares toman la versión nueva).
- **Receta nueva o ajustada:** agregá la versión en *Recetas*, *Receta_Items* y *Pasos* con estado *Vigente* y pasá la anterior a *Obsoleta*. Los lotes viejos conservan la receta con la que se hicieron.

## Limpieza opcional

La app de AppSheet y la pestaña *Diseño_AppSheet* ya no se usan: se pueden borrar sin afectar los datos.
