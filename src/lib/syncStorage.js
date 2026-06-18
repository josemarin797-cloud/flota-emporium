import { supabase, isOnline } from './supabase.js';

const KEY_TO_TABLE = {
  'emp:v4:vehicles': 'vehicles',
  'emp:v4:drivers': 'drivers',
  'emp:v4:branches': 'branches',
  'emp:v4:archived_months': 'archived_months',
  'emp:v4:photos': 'photos',
  'emp:v4:gps_tracks': 'gps_tracks',
  'emp:v4:config': 'config',
};

// active_trips NO está aquí — se maneja directo con sbFetch en App.jsx
// trips NO está aquí — se maneja directo con fetch en App.jsx

const SYNCED_KEYS = Object.keys(KEY_TO_TABLE);
const memCache = {};
const recentUploads = {};
const SELF_ECHO_WINDOW_MS = 3000;

const SPECIAL_CAMEL_TO_SNAKE = { 'litersPer100km': 'liters_per_100km' };
const SPECIAL_SNAKE_TO_CAMEL = { 'liters_per_100km': 'litersPer100km' };

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
  for (const k of Object.keys(obj)) { out[camelToSnake(k)] = obj[k]; }
  return out;
}

function objectKeysToCamel(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const k of Object.keys(obj)) { out[snakeToCamel(k)] = obj[k]; }
  return out;
}

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
        value = configFromDB(data && data[0]);
      } else {
        value = (data || []).map(objectKeysToCamel);
      }
      result[key] = value;
      memCache[key] = value;
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    } catch (e) {
      console.warn(`Error cargando ${table}:`, e.message);
      try {
        const cached = localStorage.getItem(key);
        result[key] = cached ? JSON.parse(cached) : null;
        memCache[key] = result[key];
      } catch (e2) { result[key] = null; }
    }
  }
  return result;
}

async function uploadToSupabase(key, newValue) {
  const table = KEY_TO_TABLE[key];
  if (!table || !isOnline()) return;
  recentUploads[key] = Date.now();
  try {
    if (table === 'config') {
      const payload = configToDB(newValue);
      const { error } = await supabase.from('config').upsert(payload, { onConflict: 'id' });
      if (error) throw error;
      return;
    }
    const newArr = Array.isArray(newValue) ? newValue : [];
    const oldArr = Array.isArray(memCache[key]) ? memCache[key] : [];
    const newIds = new Set(newArr.map((x) => String(x.id ?? x.month ?? x.tripId)));
    const oldIds = new Set(oldArr.map((x) => String(x.id ?? x.month ?? x.tripId)));
    const toDelete = [...oldIds].filter((id) => !newIds.has(id));
    if (toDelete.length > 0) {
      const idField = table === 'archived_months' ? 'month' : (table === 'gps_tracks' ? 'trip_id' : 'id');
      const { error } = await supabase.from(table).delete().in(idField, toDelete);
      if (error) console.warn(`Delete en ${table}:`, error.message);
    }
    if (newArr.length > 0) {
      const payload = newArr.map(r => { const s = objectKeysToSnake(r); for (const k of Object.keys(s)) { if ((k.endsWith('_date') || k.endsWith('_at')) && s[k] === '') s[k] = null; } return s; });
      const idField = table === 'archived_months' ? 'month' : (table === 'gps_tracks' ? 'trip_id' : 'id');
      const { error } = await supabase.from(table).upsert(payload, { onConflict: idField });
      if (error) console.warn(`Upsert en ${table}:`, error.message);
    }
  } catch (e) {
    console.warn(`Error subiendo ${table}:`, e.message);
  }
}

export const storageAPI = {
  async get(key) {
    if (memCache[key] !== undefined) {
      return { key, value: JSON.stringify(memCache[key]), shared: false };
    }
    try {
      const cached = localStorage.getItem(key);
      if (cached) return { key, value: cached, shared: false };
    } catch (e) {}
    return null;
  },
  async set(key, valueStr, shared = false) {
    let parsed;
    try { parsed = JSON.parse(valueStr); } catch { parsed = valueStr; }
    memCache[key] = parsed;
    try { localStorage.setItem(key, valueStr); } catch (e) {}
    if (KEY_TO_TABLE[key]) {
      uploadToSupabase(key, parsed);
    }
    return { key, value: valueStr, shared };
  },
  async delete(key) {
    delete memCache[key];
    try { localStorage.removeItem(key); } catch (e) {}
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

export function startRealtimeListeners(onChange) {
  // Realtime desactivado — no necesario
  return () => {};
}
