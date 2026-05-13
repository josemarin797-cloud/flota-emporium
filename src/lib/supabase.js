// ============================================================
// CLIENTE SUPABASE - Transporte Emporium
// ============================================================
// Este archivo conecta la app con la base de datos en la nube.
//
// Si en el futuro necesitas mover la base de datos a otro proyecto,
// solo cambia estos dos valores.
// ============================================================

import { createClient } from '@supabase/supabase-js';

// Datos del proyecto Supabase de Transporte Emporium
const SUPABASE_URL = 'https://sieadibkcqnvbwlwlmds.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_10TgLdGmmcHccAqJu2JLiw_zyYgKT_M';

// Crear cliente
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false, // No usamos auth de Supabase (la app maneja su propio login)
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// Detector simple de conectividad
export function isOnline() {
  return navigator.onLine !== false;
}
