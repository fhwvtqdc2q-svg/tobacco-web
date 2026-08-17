(function () {
  const config = window.appConfig?.supabase || {};
  if (!window.supabase?.createClient || !config.url || !config.publishableKey) return;

  const client = window.ozkSupabaseClient || window.supabase.createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  if (!window.ozkSupabaseClient) window.ozkSupabaseClient = client;

  async function listSupplierObligations() {
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session) return [];

    const { data, error } = await client
      .from("supplier_obligations")
      .select("supplier_key,supplier_name,amount_due,currency,due_date,strategic_weight,supply_risk,notes,source,updated_at")
      .gt("amount_due", 0)
      .order("amount_due", { ascending: false })
      .limit(200);

    if (error) throw error;
    return data || [];
  }

  window.supplierObligationsData = { listSupplierObligations };
})();
