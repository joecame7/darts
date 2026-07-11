(function initialiseDartsSupabase() {
  const config = window.DARTS_CONFIG;
  const library = window.supabase;

  if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
    window.DARTS_SUPABASE_ERROR = 'Account configuration is missing.';
    return;
  }

  if (!library?.createClient) {
    window.DARTS_SUPABASE_ERROR = 'The account service could not be loaded.';
    return;
  }

  const client = library.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    },
  );

  function fallbackDisplayName(user) {
    const metadataName = user?.user_metadata?.display_name?.trim();
    if (metadataName) return metadataName;
    return user?.email?.split('@')[0] || 'Player';
  }

  async function getOrCreateProfile(user) {
    if (!user) return null;

    const existing = await client
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();

    if (existing.error) throw existing.error;
    if (existing.data) return existing.data;

    const profile = {
      id: user.id,
      display_name: fallbackDisplayName(user),
    };
    const inserted = await client
      .from('profiles')
      .insert(profile)
      .select('display_name')
      .single();

    if (inserted.error) {
      const retry = await client
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle();
      if (retry.error || !retry.data) throw inserted.error;
      return retry.data;
    }

    return inserted.data;
  }

  window.DartsSupabase = Object.freeze({
    client,
    fallbackDisplayName,
    getOrCreateProfile,
  });
})();
