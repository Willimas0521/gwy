(function () {
  "use strict";

  var config = window.SUPABASE_CONFIG || {};
  if (!config.url || !config.publishableKey || !window.supabase) {
    window.supabaseClient = null;
    return;
  }

  window.supabaseClient = window.supabase.createClient(
    config.url,
    config.publishableKey,
    { auth: { persistSession: true, autoRefreshToken: true } }
  );
})();
