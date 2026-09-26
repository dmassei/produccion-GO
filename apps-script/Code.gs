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
  ensureCols_('Cargas', CARGA_COLS, {});
  Logger.log('Listo. Revisá los PIN en la pestaña Usuarios.');
}

const ROLES = { 'Operario': 1, 'Supervisor': 2, 'Aprobador': 3, 'Admin': 4 };

// Tablas que la app descarga (maestros + producción)
const MASTER_TABLES = ['Recetas', 'Receta_Items', 'Pasos', 'Insumos', 'Lotes_Insumo', 'Productos', 'Proveedores', 'Ajustes_Stock'];
const CHILD_TABLES = ['Lote_Items', 'Pasos_Lote', 'Eventos', 'Controles', 'Analisis_Lab'];
const RECENT_LOTS = 40; // lotes cerrados recientes que se envían completos

// Qué puede escribir la app, y con qué rol mínimo
const INSERT_RULES = {
  Lotes: 2, Lote_Items: 2, Pasos_Lote: 2,
  Cargas: 1, Eventos: 1, Controles: 1, Lotes_Insumo: 1,
  Proveedores: 4, Insumos: 4, Ajustes_Stock: 2
};
const UPDATE_RULES = {
  Lotes: {
    etapa: 2, litros_obtenidos: 2, cant_botellas: 2, formato_ml: 2, lote_etiqueta: 2, notas: 2,
    estado_final: 3, motivo: 3
  },
  Pasos_Lote: { realizado: 1, fecha_hora_real: 1, notas: 1 }
};
// Modo administrador: tablas que el Admin puede corregir o borrar (queda registrado en Auditoria)
const ADMIN_TABLES = ['Lotes', 'Lote_Items', 'Pasos_Lote', 'Cargas', 'Eventos', 'Controles', 'Analisis_Lab',
  'Lotes_Insumo', 'Proveedores', 'Insumos', 'Ajustes_Stock'];
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
    ensureSchema_();
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
  const cargas = readTable_('Cargas').rows;
  data.Cargas = cargas.filter(c => items.has(String(c.id_lote_item)));
  // Consumo acumulado por lote de insumo (todas las cargas no anuladas, de todos los lotes)
  data.Consumo = {};
  cargas.forEach(c => {
    if (!c.id_lote_insumo || c.anulada === true || String(c.anulada).toUpperCase() === 'TRUE') return;
    const k = String(c.id_lote_insumo);
    data.Consumo[k] = (data.Consumo[k] || 0) + (Number(c.cantidad) || 0);
  });
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
    if (op.table === 'Ajustes_Stock') {
      if (!row.motivo || !String(row.motivo).trim()) throw new Error('Falta el motivo del ajuste');
      row.usuario = user.nombre;
    }
    if (op.table === 'Lotes') {
      row.responsable = row.responsable || user.nombre;
      if (row.ensayo_escalado === true) {
        if (user.nivel < 3) throw new Error('Un ensayo de escalado requiere un Aprobador');
        row.autorizado_por = user.nombre;
      }
    }

    if (op.table === 'Cargas' && row.reemplaza) ensureCols_('Cargas', CARGA_COLS, cache);
    const t = tableInfo_(op.table, cache);
    const key = String(row[t.headers[0]] || '');
    if (!key) throw new Error('Falta la clave ' + t.headers[0]);
    if (t.keys.indexOf(key) >= 0) return { status: 'dup' }; // ya estaba: reintento de sincronización
    const values = t.headers.map(h => toCell_(h, row[h]));
    t.sh.appendRow(values);
    t.keys.push(key);
    if (op.table === 'Ajustes_Stock') audit_(user, 'Ajuste de stock', 'Lotes_Insumo', row.id_lote_insumo, null, { cantidad: row.cantidad, tipo: row.tipo }, row.motivo);
    return { status: 'ok' };
  }

  if (op.type === 'anular') return anularCarga_(op, user, cache);
  if (op.type === 'update' && op.admin) return adminUpdate_(op, user, cache);
  if (op.type === 'delete') return adminDelete_(op, user, cache);
  if (op.type === 'deleteLote') return adminDeleteLote_(op, user, cache);

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

// ---------------------------------------------------------------- modo administrador

function requireAdmin_(op, user) {
  if (user.nivel < 4) throw new Error('Solo un Admin puede corregir o borrar datos');
  if (op.table && ADMIN_TABLES.indexOf(op.table) < 0) throw new Error('Tabla no editable: ' + op.table);
  if (!op.motivo || !String(op.motivo).trim()) throw new Error('Falta el motivo de la corrección');
}

function rowObj_(t, idx) {
  const vals = t.sh.getRange(idx + 2, 1, 1, t.headers.length).getValues()[0];
  const o = {};
  t.headers.forEach((h, i) => { if (h) o[h] = vals[i] instanceof Date ? vals[i].toISOString() : vals[i]; });
  return o;
}

function audit_(user, accion, tabla, clave, antes, despues, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Auditoria');
  if (!sh) {
    sh = ss.insertSheet('Auditoria');
    sh.appendRow(['Fecha', 'Usuario', 'Acción', 'Tabla', 'Clave', 'Antes', 'Después', 'Motivo']);
  }
  sh.appendRow([new Date(), user.nombre, accion, tabla, clave,
    antes ? JSON.stringify(antes) : '', despues ? JSON.stringify(despues) : '', motivo || '']);
}

function adminUpdate_(op, user, cache) {
  requireAdmin_(op, user);
  const t = tableInfo_(op.table, cache);
  const idx = t.keys.indexOf(String(op.key));
  if (idx < 0) throw new Error('No existe ' + op.key + ' en ' + op.table);
  const before = rowObj_(t, idx);
  const antes = {}, despues = {};
  Object.keys(op.fields || {}).forEach(f => {
    const col = t.headers.indexOf(f);
    if (col <= 0) return; // columna inexistente o la clave: no se modifica
    antes[f] = before[f];
    despues[f] = op.fields[f];
    t.sh.getRange(idx + 2, col + 1).setValue(toCell_(f, op.fields[f]));
  });
  audit_(user, 'Corrección', op.table, op.key, antes, despues, op.motivo);
  return { status: 'ok' };
}

function adminDelete_(op, user, cache) {
  requireAdmin_(op, user);
  if (op.table === 'Lotes') throw new Error('Para borrar un lote usá "Eliminar lote"');
  const t = tableInfo_(op.table, cache);
  const idx = t.keys.indexOf(String(op.key));
  if (idx < 0) return { status: 'dup' }; // ya no estaba
  const before = rowObj_(t, idx);
  t.sh.deleteRow(idx + 2);
  t.keys.splice(idx, 1);
  audit_(user, 'Borrado', op.table, op.key, before, null, op.motivo);
  return { status: 'ok' };
}

function deleteWhere_(name, pred, cache) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = (values[0] || []).map(norm_);
  let n = 0;
  for (let i = values.length - 1; i >= 1; i--) {
    const o = {};
    headers.forEach((h, j) => o[h] = values[i][j]);
    if (pred(o)) { sh.deleteRow(i + 1); n++; }
  }
  delete cache[name];
  return n;
}

function adminDeleteLote_(op, user, cache) {
  requireAdmin_(Object.assign({}, op, { table: 'Lotes' }), user);
  const id = String(op.key);
  const lote = readTable_('Lotes').rows.find(r => String(r.id_lote) === id);
  if (!lote) return { status: 'dup' };
  const items = new Set(readTable_('Lote_Items').rows.filter(r => String(r.id_lote) === id).map(r => String(r.id_lote_item)));
  const detalle = {};
  detalle.Cargas = deleteWhere_('Cargas', r => items.has(String(r.id_lote_item)), cache);
  ['Lote_Items', 'Pasos_Lote', 'Eventos', 'Controles', 'Analisis_Lab'].forEach(t => {
    detalle[t] = deleteWhere_(t, r => String(r.id_lote) === id, cache);
  });
  detalle.Lotes = deleteWhere_('Lotes', r => String(r.id_lote) === id, cache);
  audit_(user, 'Lote eliminado', 'Lotes', id, lote, detalle, op.motivo);
  return { status: 'ok' };
}

// ---------------------------------------------------------------- anulación de cargas (cualquier usuario)
// Una carga mal registrada no se borra: se anula con motivo, queda visible y no suma.
const CARGA_COLS = ['Anulada', 'Anulada_por', 'Fecha_anulacion', 'Motivo_anulacion', 'Reemplaza'];

function ensureCols_(name, cols, cache) {
  const sh = sheet_(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(norm_);
  let last = sh.getLastColumn();
  cols.forEach(c => { if (headers.indexOf(norm_(c)) < 0) sh.getRange(1, ++last).setValue(c); });
  delete cache[name];
}

function anularCarga_(op, user, cache) {
  if (!op.motivo || !String(op.motivo).trim()) throw new Error('Falta el motivo de la anulación');
  ensureCols_('Cargas', CARGA_COLS, cache);
  const t = tableInfo_('Cargas', cache);
  const idx = t.keys.indexOf(String(op.key));
  if (idx < 0) throw new Error('No existe la carga ' + op.key);
  const c = rowObj_(t, idx);
  if (c.anulada === true || String(c.anulada).toUpperCase() === 'TRUE') return { status: 'dup' };
  const item = readTable_('Lote_Items').rows.find(r => String(r.id_lote_item) === String(c.id_lote_item)) || {};
  const lote = readTable_('Lotes').rows.find(r => String(r.id_lote) === String(item.id_lote)) || {};
  if (lote.etapa === 'Cerrado' && user.nivel < 4) throw new Error('El lote está cerrado: solo un Admin puede corregirlo');
  const set = { anulada: true, anulada_por: user.nombre, fecha_anulacion: new Date(), motivo_anulacion: String(op.motivo) };
  Object.keys(set).forEach(f => t.sh.getRange(idx + 2, t.headers.indexOf(f) + 1).setValue(set[f]));
  audit_(user, 'Carga anulada', 'Cargas', op.key, { cantidad: c.cantidad, fecha_hora: c.fecha_hora, operario: c.operario }, null, op.motivo);
  return { status: 'ok' };
}

// ---------------------------------------------------------------- esquema
// Crea solo las columnas y pestañas que agregan las versiones nuevas (una vez por versión).
const SCHEMA_VERSION = '3';
function ensureSchema_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('schema') === SCHEMA_VERSION) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureCols_('Cargas', CARGA_COLS, {});
  ensureCols_('Insumos', ['Controla_stock', 'Stock_minimo'], {});
  if (!ss.getSheetByName('Ajustes_Stock')) {
    ss.insertSheet('Ajustes_Stock').appendRow(['ID_Ajuste', 'ID_Lote_Insumo', 'Cantidad', 'Tipo', 'Fecha_hora', 'Usuario', 'Motivo']);
  }
  props.setProperty('schema', SCHEMA_VERSION);
}
