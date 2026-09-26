/**
 * Producción GO (Grupo OSAR) — Backend (Google Apps Script)
 * Va pegado en: Sheet → Extensiones → Apps Script.
 * Implementar como App web: Ejecutar como "Yo", acceso "Cualquier usuario".
 *
 * La app de planta se comunica con este script por POST (JSON en texto plano).
 * Cada pedido se valida con el nombre y PIN del usuario (pestaña Usuarios).
 */

// ---------------------------------------------------------------- configuración inicial

/**
 * Ejecutar UNA vez desde el editor (botón ▶ con "setup" seleccionado).
 * Agrega la columna PIN a Usuarios y asigna un PIN provisorio de 4 dígitos a quien no tenga.
 */
function setup() {
  const sh = sheet_('Usuarios');
  let headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(norm_);
  let col = headers.indexOf('pin') + 1;
  if (!col) {
    col = sh.getLastColumn() + 1;
    sh.getRange(1, col).setValue('PIN');
  }
  const n = sh.getLastRow() - 1;
  if (n > 0) {
    const range = sh.getRange(2, col, n, 1);
    range.setNumberFormat('@'); // texto, para no perder ceros a la izquierda
    const pins = range.getValues().map(r => [r[0] ? String(r[0]) : String(Math.floor(1000 + Math.random() * 9000))]);
    range.setValues(pins);
  }
  Logger.log('Listo. Revisá los PIN en la pestaña Usuarios.');
}

const ROLES = { 'Operario': 1, 'Supervisor': 2, 'Aprobador': 3, 'Admin': 4 };

// Tablas que la app descarga (maestros + producción)
const MASTER_TABLES = ['Recetas', 'Receta_Items', 'Pasos', 'Insumos', 'Lotes_Insumo', 'Productos', 'Proveedores'];
const CHILD_TABLES = ['Lote_Items', 'Pasos_Lote', 'Eventos', 'Controles', 'Analisis_Lab'];
const RECENT_LOTS = 40; // lotes cerrados recientes que se envían completos

// Qué puede escribir la app, y con qué rol mínimo
const INSERT_RULES = {
  Lotes: 2, Lote_Items: 2, Pasos_Lote: 2,
  Cargas: 1, Eventos: 1, Controles: 1, Lotes_Insumo: 1
};
const UPDATE_RULES = {
  Lotes: {
    etapa: 2, litros_obtenidos: 2, cant_botellas: 2, formato_ml: 2, lote_etiqueta: 2, notas: 2,
    estado_final: 3, motivo: 3
  },
  Pasos_Lote: { realizado: 1, fecha_hora_real: 1, notas: 1 }
};
// Campos que la app muestra al instante pero que siempre escribe el servidor
const SERVER_FIELDS = { Lotes: ['aprobado_por', 'fecha_aprobacion'], Pasos_Lote: ['operario'] };

// ---------------------------------------------------------------- entrada

function doGet(e) {
  return respond_(route_(Object.assign({}, e && e.parameter)));
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { /* cuerpo inválido */ }
  return respond_(route_(body));
}

function route_(p) {
  try {
    if (p.action === 'ping') return { ok: true, time: new Date().toISOString() };
    if (p.action === 'users') return { ok: true, users: listUsers_() };
    const user = auth_(p.user, p.pin);
    if (p.action === 'snapshot') return { ok: true, user: user, data: snapshot_(), time: new Date().toISOString() };
    if (p.action === 'sync') {
      const results = applyOps_(p.ops || [], user);
      return { ok: true, user: user, results: results, data: snapshot_(), time: new Date().toISOString() };
    }
    return { ok: false, error: 'Acción desconocida' };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- usuarios

function listUsers_() {
  return readTable_('Usuarios').rows
    .filter(u => u.nombre && u.activo !== false && String(u.activo).toUpperCase() !== 'FALSE')
    .map(u => ({ nombre: String(u.nombre), rol: String(u.rol || 'Operario') }));
}

function auth_(nombre, pin) {
  if (!nombre || pin === undefined || pin === null || pin === '') throw new Error('Falta usuario o PIN');
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + norm_(nombre);
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) throw new Error('Demasiados intentos fallidos. Esperá 10 minutos.');
  const u = readTable_('Usuarios').rows.find(r => String(r.nombre) === String(nombre));
  if (!u || u.activo === false || String(u.activo).toUpperCase() === 'FALSE') throw new Error('Usuario no habilitado');
  if (!u.pin || String(u.pin).trim() !== String(pin).trim()) {
    cache.put(failKey, String(fails + 1), 600);
    throw new Error('PIN incorrecto');
  }
  cache.remove(failKey);
  const rol = String(u.rol || 'Operario');
  return { nombre: String(u.nombre), rol: rol, nivel: ROLES[rol] || 1, planta: u.id_planta || '' };
}

// ---------------------------------------------------------------- lectura

function norm_(h) {
  return String(h).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('No existe la pestaña ' + name);
  return sh;
}

function readTable_(name) {
  const values = sheet_(name).getDataRange().getValues();
  const headers = (values.shift() || []).map(norm_);
  const rows = values
    .filter(r => r.some(c => c !== '' && c !== null))
    .map(r => {
      const o = {};
      headers.forEach((h, i) => { if (h) o[h] = r[i] instanceof Date ? r[i].toISOString() : r[i]; });
      return o;
    });
  return { headers: headers, rows: rows };
}

function snapshot_() {
  const data = {};
  MASTER_TABLES.forEach(t => data[t] = readTable_(t).rows);

  const lotes = readTable_('Lotes').rows;
  const activos = lotes.filter(l => l.etapa !== 'Cerrado');
  const cerrados = lotes.filter(l => l.etapa === 'Cerrado')
    .sort((a, b) => String(b.fecha_hora_inicio).localeCompare(String(a.fecha_hora_inicio)))
    .slice(0, RECENT_LOTS);
  const ids = new Set(activos.concat(cerrados).map(l => String(l.id_lote)));
  data.Lotes = lotes; // la cabecera de todos los lotes es liviana y sirve de referencia

  CHILD_TABLES.forEach(t => data[t] = readTable_(t).rows.filter(r => ids.has(String(r.id_lote))));
  const items = new Set(data.Lote_Items.map(i => String(i.id_lote_item)));
  data.Cargas = readTable_('Cargas').rows.filter(c => items.has(String(c.id_lote_item)));
  return data;
}

// ---------------------------------------------------------------- escritura

function applyOps_(ops, user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cache = {};
    return ops.map(op => {
      try { return Object.assign({ id: op.id }, applyOne_(op, user, cache)); }
      catch (err) { return { id: op.id, status: 'error', error: String(err && err.message || err) }; }
    });
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function tableInfo_(name, cache) {
  if (!cache[name]) {
    const sh = sheet_(name);
    const lastCol = sh.getLastColumn();
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(norm_);
    const lastRow = sh.getLastRow();
    const keys = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, 1).getValues().map(r => String(r[0])) : [];
    cache[name] = { sh: sh, headers: headers, keys: keys };
  }
  return cache[name];
}

function isDateCol_(h) {
  return /^fecha|hora|vencimiento|vigente_desde/.test(h);
}

function toCell_(h, v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' && isDateCol_(h) && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v);
  return v;
}

function applyOne_(op, user, cache) {
  const now = new Date().toISOString();

  if (op.type === 'insert') {
    const min = INSERT_RULES[op.table];
    if (!min) throw new Error('Tabla no permitida: ' + op.table);
    if (user.nivel < min) throw new Error('Sin permiso para crear en ' + op.table);
    const row = Object.assign({}, op.row);

    // Datos que siempre pone el servidor
    if (op.table === 'Cargas') { row.operario = user.nombre; row.hora_sync = now; }
    if (op.table === 'Eventos' || op.table === 'Controles') row.operario = user.nombre;
    if (op.table === 'Lotes') {
      row.responsable = row.responsable || user.nombre;
      if (row.ensayo_escalado === true) {
        if (user.nivel < 3) throw new Error('Un ensayo de escalado requiere un Aprobador');
        row.autorizado_por = user.nombre;
      }
    }

    const t = tableInfo_(op.table, cache);
    const key = String(row[t.headers[0]] || '');
    if (!key) throw new Error('Falta la clave ' + t.headers[0]);
    if (t.keys.indexOf(key) >= 0) return { status: 'dup' }; // ya estaba: reintento de sincronización
    const values = t.headers.map(h => toCell_(h, row[h]));
    t.sh.appendRow(values);
    t.keys.push(key);
    return { status: 'ok' };
  }

  if (op.type === 'update') {
    const rules = UPDATE_RULES[op.table];
    if (!rules) throw new Error('Tabla no editable: ' + op.table);
    const fields = Object.assign({}, op.fields);
    (SERVER_FIELDS[op.table] || []).forEach(f => delete fields[f]); // los completa el servidor
    Object.keys(fields).forEach(f => {
      if (!rules[f]) throw new Error('Campo no editable: ' + f);
      if (user.nivel < rules[f]) throw new Error('Sin permiso para modificar ' + f);
    });
    if (op.table === 'Lotes' && fields.estado_final !== undefined) {
      fields.aprobado_por = user.nombre;
      fields.fecha_aprobacion = now;
    }
    if (op.table === 'Pasos_Lote' && fields.realizado !== undefined) fields.operario = user.nombre;

    const t = tableInfo_(op.table, cache);
    const idx = t.keys.indexOf(String(op.key));
    if (idx < 0) throw new Error('No existe ' + op.key + ' en ' + op.table);
    Object.keys(fields).forEach(f => {
      const col = t.headers.indexOf(f);
      if (col >= 0) t.sh.getRange(idx + 2, col + 1).setValue(toCell_(f, fields[f]));
    });
    return { status: 'ok' };
  }

  throw new Error('Operación desconocida');
}
