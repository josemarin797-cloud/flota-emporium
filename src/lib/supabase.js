import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://sieadibkcqnvbwlwlmds.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_10TgLdGmmcHccAqJu2JLiw_zyYgKT_M';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 0 } },
});

export function isOnline() {
  return navigator.onLine !== false;
}
