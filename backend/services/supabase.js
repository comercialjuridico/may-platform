// ─── Cliente Supabase (service role) ───────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false },
    // Realtime desabilitado — não usamos subscriptions em tempo real
    realtime: { enabled: false },
  }
);

module.exports = { supabase };
