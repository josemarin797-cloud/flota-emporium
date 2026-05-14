// ============================================================
// SYNC STORAGE - Capa de sincronización con Supabase
// ============================================================
// Este archivo es el "puente" entre la app y la base de datos.
//
// La app sigue usando window.storage.get/set como antes,
// pero ahora cada cambio se sube a Supabase, y los cambios
// que hacen otros usuarios se reciben en tiempo real.
// ============================================================

import { supabase, isOnline } from './supabase.js';

// Mapeo: clave que usa la app ↔ tabla en Supabase
const KEY_TO_TABLE = {
  'emp:v4:vehicles': 'vehicles',
  'emp:v4:drivers': 'drivers',
  'emp:v4:branches': 'branches',
  'emp:v4:trips': 'trips',
  'emp:v4:active_trips': 'active_trips',
  'emp:v4:archived_months': 'archived_months',
  'emp:v4:photos': 'photos',
  'emp:v4:gps_tracks': 'gps_tracks',
  'emp:v4:config': 'config',
};

// Las claves que SÍ se guardan en Supabase
const SYNCED_KEYS = Object.keys(KEY_TO_TABLE);

// Caché en memoria de los datos (para responder rápido a la app)
const memCache = {};

// Timestamp de la última subida por key (para evitar que nuestros propios
// uploads disparen una notificación realtime que cause un re-render)
const recentUploads = {};
const SELF_ECHO_WINDOW_MS = 3000;

// ============================================================
// HELPERS: camelCase ↔ snake_case
// ============================================================
// Campos especiales que tienen números o conversiones no estándar
const SPECIAL_CAMEL_TO_SNAKE = {
  'litersPer100km': 'liters_per_100km',
};
const SPECIAL_SNAKE_TO_CAMEL = {
  'liters_per_100km': 'litersPer100km',
};

const camelToSnake = (str) => {
  if (SPECIAL_CAMEL_TO_SNAKE[str]) return SPECIAL_CAMEL_TO_SNAKE[str];
  return str.replace(/[A-Z]/g, (l) => '_' + l.toLowerCase());
};
const snakeToCamel = (str) => {
  if (SPECIAL_SNAKE_TO_CAMEL[str]) return SPECIAL_SNAKE_TO_CAMEL[str];
  return str.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
};

function objectKeysToSnake(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    out[camelToSnake(k)] = obj[k];
  }
  return out;
}

function objectKeysToCamel(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    out[snakeToCamel(k)] = obj[k];
  }
  return out;
}

// ============================================================
// CONFIG: caso especial (es un objeto, no un array)
// ============================================================
function configFromDB(row) {
  if (!row) return { fuelPrice: 0.5 };
  return {
    fuelPrice: Number(row.fuel_price) || 0.5,
    discordWebhookGeneral: row.discord_webhook_general || '',
    discordWebhookMaintenance: row.discord_webhook_maintenance || '',
    discordWebhookByVehicle: row.discord_webhook_by_vehicle || {},
  };
}

function configToDB(cfg) {
  return {
    id: 1,
    fuel_price: Number(cfg.fuelPrice) || 0.5,
    discord_webhook_general: cfg.discordWebhookGeneral || null,
    discord_webhook_maintenance: cfg.discordWebhookMaintenance || null,
    discord_webhook_by_vehicle: cfg.discordWebhookByVehicle || {},
    updated_at: new Date().toISOString(),
  };
}

// ============================================================
// CARGA INICIAL: traer todos los datos desde Supabase
// ============================================================
export async function loadAllFromSupabase(onProgress) {
  const result = {};
  let step = 0;
  const totalSteps = SYNCED_KEYS.length;

  for (const key of SYNCED_KEYS) {
    const table = KEY_TO_TABLE[key];
    step++;
    if (onProgress) onProgress(step, totalSteps, table);

    try {
      const { data, error } = await supabase.from(table).select('*');
      if (error) throw error;

      let value;
      if (table === 'config') {
        // Config es un solo objeto, no un array
        value = configFromDB(data && data[0]);
      } else {
        // Las demás tablas son arrays de objetos
        value = (data || []).map(objectKeysToCamel);
      }

      result[key] = value;
      memCache[key] = value;
      // Guardar en localStorage como cache (por si después no hay internet)
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {}
    } catch (e) {
      console.warn(`Error cargando ${table}, usando caché local:`, e.message);
      // Si falla Supabase, intentar leer del cache local
      try {
        const cached = localStorage.getItem(key);
        result[key] = cached ? JSON.parse(cached) : null;
        memCache[key] = result[key];
      } catch (e2) {
        result[key] = null;
      }
    }
  }

  return result;
}

// ============================================================
// GUARDAR EN SUPABASE: cuando la app llama window.storage.set
// ============================================================
async function uploadToSupabase(key, newValue) {
  const table = KEY_TO_TABLE[key];
  if (!table || !isOnline()) return;

  // Marcar este key como recién subido (para ignorar nuestro propio echo)
  recentUploads[key] = Date.now();

  try {
    if (table === 'config') {
      // Config: upsert único row con id=1
      const payload = configToDB(newValue);
      const { error } = await supabase.from('config').upsert(payload, { onConflict: 'id' });
      if (error) throw error;
      return;
    }

    // Tablas tipo array
    const newArr = Array.isArray(newValue) ? newValue : [];
    const oldArr = Array.isArray(memCache[key]) ? memCache[key] : [];

    const newIds = new Set(newArr.map((x) => String(x.id ?? x.month ?? x.tripId)));
    const oldIds = new Set(oldArr.map((x) => String(x.id ?? x.month ?? x.tripId)));

    // 1) DELETE - los que ya no están
    const toDelete = [...oldIds].filter((id) => !newIds.has(id));
    if (toDelete.length > 0) {
      const idField = table === 'archived_months' ? 'month' : (table === 'gps_tracks' ? 'trip_id' : 'id');
      const { error } = await supabase.from(table).delete().in(idField, toDelete);
      if (error) console.warn(`Delete en ${table}:`, error.message);
    }

    // 2) UPSERT - los nuevos y modificados
    if (newArr.length > 0) {
      const payload = newArr.map(objectKeysToSnake);
      const idField = table === 'archived_months' ? 'month' : (table === 'gps_tracks' ? 'trip_id' : 'id');
      const { error } = await supabase.from(table).upsert(payload, { onConflict: idField });
      if (error) console.warn(`Upsert en ${table}:`, error.message);
    }
  } catch (e) {
    console.warn(`Error subiendo ${table}:`, e.message);
  }
}

// ============================================================
// API: el polyfill que reemplaza window.storage
// ============================================================
export const storageAPI = {
  async get(key) {
    // Devolver desde memoria si está disponible
    if (memCache[key] !== undefined) {
      return { key, value: JSON.stringify(memCache[key]), shared: false };
    }
    // Sino, intentar desde localStorage
    try {
      const cached = localStorage.getItem(key);
      if (cached) return { key, value: cached, shared: false };
    } catch (e) {}
    return null;
  },

  async set(key, valueStr, shared = false) {
    let parsed;
    try {
      parsed = JSON.parse(valueStr);
    } catch {
      parsed = valueStr;
    }

    // Actualizar memoria y localStorage
    memCache[key] = parsed;
    try {
      localStorage.setItem(key, valueStr);
    } catch (e) {}

    // Si es una clave sincronizada, subir a Supabase en background
    if (KEY_TO_TABLE[key]) {
      uploadToSupabase(key, parsed);
    }

    return { key, value: valueStr, shared };
  },

  async delete(key) {
    delete memCache[key];
    try {
      localStorage.removeItem(key);
    } catch (e) {}
    return { key, deleted: true, shared: false };
  },

  async list(prefix = '') {
    const keys = [];
    for (const k of Object.keys(memCache)) {
      if (k.startsWith(prefix)) keys.push(k);
    }
    return { keys, prefix, shared: false };
  },
};

// ============================================================
// REALTIME: escuchar cambios de otros usuarios
// ============================================================
export function startRealtimeListeners(onChange) {
  const channels = [];

  for (const key of SYNCED_KEYS) {
    const table = KEY_TO_TABLE[key];

    const channel = supabase
      .channel(`realtime:${table}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        async (payload) => {
          // Si acabamos de subir este key, ignorar (es nuestro propio echo)
          const lastUpload = recentUploads[key] || 0;
          if (Date.now() - lastUpload < SELF_ECHO_WINDOW_MS) {
            return;
          }

          // Recargar TODA la tabla cuando hay un cambio
          // (más simple y robusto que aplicar el delta)
          try {
            const { data, error } = await supabase.from(table).select('*');
            if (error) throw error;

            let value;
            if (table === 'config') {
              value = configFromDB(data && data[0]);
            } else {
              value = (data || []).map(objectKeysToCamel);
            }

            memCache[key] = value;
            try {
              localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {}

            // Notificar a la app
            if (onChange) onChange(key, value);
          } catch (e) {
            console.warn(`Realtime sync de ${table} falló:`, e.message);
          }
        }
      )
      .subscribe();

    channels.push(channel);
  }

  // Función para detener todas las suscripciones
  return () => {
    for (const ch of channels) {
      supabase.removeChannel(ch);
    }
  };
}
