(function initialiseHistory() {
  const service = window.DartsSupabase;
  const message = document.getElementById('history-message');
  const signedOutState = document.getElementById('signed-out-history');
  const emptyState = document.getElementById('empty-history');
  const historyList = document.getElementById('history-list');
  const accountName = document.getElementById('history-account-name');
  const signOutButton = document.getElementById('history-sign-out');
  let loadVersion = 0;

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.dataset.kind = kind;
  }

  function formatGameType(value) {
    return value
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  function renderGames(games) {
    historyList.replaceChildren();
    for (const game of games) {
      const item = document.createElement('li');
      item.className = 'game-history-item';

      const details = document.createElement('div');
      const title = document.createElement('h2');
      title.textContent = formatGameType(game.game_type);
      const meta = document.createElement('p');
      const players = [...(game.game_players || [])]
        .sort((a, b) => a.player_order - b.player_order)
        .map((player) => player.display_name)
        .join(' vs ');
      meta.textContent = `${players || 'Players not recorded'} · ${formatDate(game.started_at)}`;
      details.append(title, meta);

      const status = document.createElement('span');
      status.className = 'status-badge';
      status.textContent = game.status.replace('_', ' ');
      item.append(details, status);
      historyList.append(item);
    }
  }

  async function loadHistory(session) {
    const version = ++loadVersion;
    const user = session?.user;
    signedOutState.hidden = Boolean(user);
    emptyState.hidden = true;
    historyList.replaceChildren();
    signOutButton.hidden = !user;

    if (!user) {
      accountName.textContent = '';
      setMessage('');
      return;
    }

    try {
      const profile = await service.getOrCreateProfile(user);
      if (version !== loadVersion) return;
      accountName.textContent = profile?.display_name || service.fallbackDisplayName(user);

      const result = await service.client
        .from('games')
        .select('id, game_type, status, started_at, completed_at, game_players(display_name, player_order)')
        .order('started_at', { ascending: false })
        .range(0, 49);
      if (result.error) throw result.error;
      if (version !== loadVersion) return;

      const games = result.data || [];
      emptyState.hidden = games.length !== 0;
      if (games.length) renderGames(games);
      setMessage('');
    } catch (error) {
      if (version !== loadVersion) return;
      console.error('Unable to load game history', error);
      setMessage(error?.message || 'Your game history could not be loaded.', 'error');
    }
  }

  signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    const result = await service.client.auth.signOut({ scope: 'local' });
    if (result.error) {
      setMessage(result.error.message, 'error');
      signOutButton.disabled = false;
      return;
    }
    window.location.replace('../');
  });

  if (!service) {
    signedOutState.hidden = false;
    setMessage(window.DARTS_SUPABASE_ERROR || 'Accounts are temporarily unavailable.', 'error');
    return;
  }

  service.client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => loadHistory(session), 0);
  });

  service.client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      return loadHistory(data.session);
    })
    .catch((error) => setMessage(error.message, 'error'));
})();
