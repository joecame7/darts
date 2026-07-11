(function initialiseSavedPlayers() {
  const service = window.DartsSupabase;
  const message = document.getElementById('players-message');
  const signedOutState = document.getElementById('signed-out-players');
  const content = document.getElementById('players-content');
  const accountName = document.getElementById('players-account-name');
  const signOutButton = document.getElementById('players-sign-out');
  const addForm = document.getElementById('add-player-form');
  const addInput = document.getElementById('new-player-name');
  const addSubmit = document.getElementById('add-player-submit');
  const activeList = document.getElementById('active-player-list');
  const archivedList = document.getElementById('archived-player-list');
  const emptyActiveState = document.getElementById('empty-active-players');
  const archivedSection = document.getElementById('archived-players-section');
  const activeCount = document.getElementById('active-player-count');
  const archivedCount = document.getElementById('archived-player-count');
  const editDialog = document.getElementById('edit-player-dialog');
  const editForm = document.getElementById('edit-player-form');
  const editInput = document.getElementById('edit-player-name');
  const editSubmit = document.getElementById('edit-player-submit');
  const editMessage = document.getElementById('edit-player-message');

  let currentUser = null;
  let editingPlayerId = null;
  let loadVersion = 0;
  let loadedPlayers = [];

  function setMessage(element, text, kind = '') {
    element.textContent = text;
    element.dataset.kind = kind;
  }

  function normaliseName(value) {
    return value.trim().replace(/\s+/g, ' ');
  }

  function normaliseNameForComparison(value) {
    return normaliseName(value).toLocaleLowerCase();
  }

  function friendlyMutationError(error, fallback) {
    if (error?.code === '23505') return 'A saved player with that name already exists.';
    return error?.message || fallback;
  }

  function clearRenderedPlayers() {
    loadedPlayers = [];
    activeList.replaceChildren();
    archivedList.replaceChildren();
    activeCount.textContent = '0';
    archivedCount.textContent = '0';
    emptyActiveState.hidden = true;
    archivedSection.hidden = true;
  }

  function setButtonBusy(button, busy, busyLabel, readyLabel) {
    button.disabled = busy;
    button.textContent = busy ? busyLabel : readyLabel;
  }

  function closeEditDialog() {
    editingPlayerId = null;
    editForm.reset();
    setMessage(editMessage, '');
    if (typeof editDialog.close === 'function') editDialog.close();
    else editDialog.removeAttribute('open');
  }

  function openEditDialog(player) {
    editingPlayerId = player.id;
    editInput.value = player.display_name;
    setMessage(editMessage, '');
    if (typeof editDialog.showModal === 'function') editDialog.showModal();
    else editDialog.setAttribute('open', '');
    window.setTimeout(() => {
      editInput.focus();
      editInput.select();
    }, 0);
  }

  function createPlayerItem(player, archived) {
    const item = document.createElement('li');
    item.className = `saved-player-item${archived ? ' archived-player-item' : ''}`;

    const identity = document.createElement('div');
    identity.className = 'saved-player-identity';
    const avatar = document.createElement('span');
    avatar.className = 'player-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = Array.from(player.display_name)[0]?.toUpperCase() || '?';
    const text = document.createElement('div');
    const name = document.createElement('h3');
    name.textContent = player.display_name;
    const detail = document.createElement('p');
    detail.textContent = archived ? 'Archived opponent' : 'Saved opponent';
    text.append(name, detail);
    identity.append(avatar, text);

    const actions = document.createElement('div');
    actions.className = 'saved-player-actions';
    const renameButton = document.createElement('button');
    renameButton.className = 'secondary-button small-button';
    renameButton.type = 'button';
    renameButton.textContent = 'Rename';
    renameButton.setAttribute('aria-label', `Rename ${player.display_name}`);
    renameButton.addEventListener('click', () => openEditDialog(player));

    const archiveButton = document.createElement('button');
    archiveButton.className = 'text-button small-button';
    archiveButton.type = 'button';
    archiveButton.textContent = archived ? 'Restore' : 'Archive';
    archiveButton.setAttribute('aria-label', `${archived ? 'Restore' : 'Archive'} ${player.display_name}`);
    archiveButton.addEventListener('click', () => setArchived(player, !archived, archiveButton));
    actions.append(renameButton, archiveButton);
    item.append(identity, actions);
    return item;
  }

  function renderPlayers(players) {
    loadedPlayers = players;
    const active = players.filter((player) => !player.archived_at);
    const archived = players.filter((player) => player.archived_at);
    activeList.replaceChildren(...active.map((player) => createPlayerItem(player, false)));
    archivedList.replaceChildren(...archived.map((player) => createPlayerItem(player, true)));
    activeCount.textContent = String(active.length);
    archivedCount.textContent = String(archived.length);
    emptyActiveState.hidden = active.length !== 0;
    archivedSection.hidden = archived.length === 0;
  }

  async function loadPlayers(session) {
    const version = ++loadVersion;
    currentUser = session?.user || null;
    const signedIn = Boolean(currentUser);
    signedOutState.hidden = signedIn;
    content.hidden = !signedIn;
    signOutButton.hidden = !signedIn;

    if (!currentUser) {
      accountName.textContent = '';
      clearRenderedPlayers();
      setMessage(message, '');
      return;
    }

    clearRenderedPlayers();
    accountName.textContent = service.fallbackDisplayName(currentUser);
    setMessage(message, 'Loading your players...');
    try {
      service.getOrCreateProfile(currentUser)
        .then((profile) => {
          if (version === loadVersion && profile?.display_name) accountName.textContent = profile.display_name;
        })
        .catch((error) => console.warn('Unable to load account profile', error));

      const result = await service.client
        .from('saved_players')
        .select('id, display_name, archived_at, created_at, updated_at')
        .order('display_name', { ascending: true });
      if (result.error) throw result.error;
      if (version !== loadVersion) return;
      renderPlayers(result.data || []);
      setMessage(message, '');
    } catch (error) {
      if (version !== loadVersion) return;
      console.error('Unable to load saved players', error);
      setMessage(message, error?.message || 'Your saved players could not be loaded.', 'error');
    }
  }

  async function refreshPlayers() {
    if (!currentUser) return;
    const sessionResult = await service.client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    await loadPlayers(sessionResult.data.session);
  }

  async function setArchived(player, archived, button) {
    if (!currentUser) return;
    setButtonBusy(button, true, archived ? 'Archiving...' : 'Restoring...', archived ? 'Archive' : 'Restore');
    setMessage(message, '');
    try {
      const result = await service.client
        .from('saved_players')
        .update({
          archived_at: archived ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', player.id)
        .eq('owner_user_id', currentUser.id)
        .select('id')
        .single();
      if (result.error) throw result.error;
      await refreshPlayers();
      setMessage(message, archived ? `${player.display_name} was archived.` : `${player.display_name} was restored.`, 'success');
    } catch (error) {
      setMessage(message, friendlyMutationError(error, 'The player could not be updated.'), 'error');
      setButtonBusy(button, false, '', archived ? 'Archive' : 'Restore');
    }
  }

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser) return;
    const displayName = normaliseName(addInput.value);
    if (!displayName) {
      setMessage(message, 'Enter a player name.', 'error');
      addInput.focus();
      return;
    }

    const existing = loadedPlayers.find(
      (player) => normaliseNameForComparison(player.display_name) === normaliseNameForComparison(displayName),
    );
    if (existing && !existing.archived_at) {
      setMessage(message, `${existing.display_name} is already in your saved players.`, 'error');
      addInput.focus();
      return;
    }

    setButtonBusy(addSubmit, true, 'Adding...', 'Add player');
    setMessage(message, '');
    try {
      const result = existing
        ? await service.client
          .from('saved_players')
          .update({ archived_at: null, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .eq('owner_user_id', currentUser.id)
          .select('id')
          .single()
        : await service.client
          .from('saved_players')
          .insert({ owner_user_id: currentUser.id, display_name: displayName })
          .select('id')
          .single();
      if (result.error) throw result.error;
      addForm.reset();
      await refreshPlayers();
      setMessage(
        message,
        existing
          ? `${existing.display_name} was restored and is available for future games.`
          : `${displayName} is now available for future games.`,
        'success',
      );
    } catch (error) {
      setMessage(message, friendlyMutationError(error, 'The player could not be added.'), 'error');
    } finally {
      setButtonBusy(addSubmit, false, '', 'Add player');
    }
  });

  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser || !editingPlayerId) return;
    const displayName = normaliseName(editInput.value);
    if (!displayName) {
      setMessage(editMessage, 'Enter a player name.', 'error');
      return;
    }
    const duplicate = loadedPlayers.find(
      (player) => player.id !== editingPlayerId
        && normaliseNameForComparison(player.display_name) === normaliseNameForComparison(displayName),
    );
    if (duplicate) {
      setMessage(editMessage, `${duplicate.display_name} already exists in your saved players.`, 'error');
      return;
    }

    setButtonBusy(editSubmit, true, 'Saving...', 'Save name');
    setMessage(editMessage, '');
    try {
      const result = await service.client
        .from('saved_players')
        .update({ display_name: displayName, updated_at: new Date().toISOString() })
        .eq('id', editingPlayerId)
        .eq('owner_user_id', currentUser.id)
        .select('id')
        .single();
      if (result.error) throw result.error;
      closeEditDialog();
      await refreshPlayers();
      setMessage(message, `Player renamed to ${displayName}.`, 'success');
    } catch (error) {
      setMessage(editMessage, friendlyMutationError(error, 'The player could not be renamed.'), 'error');
    } finally {
      setButtonBusy(editSubmit, false, '', 'Save name');
    }
  });

  document.getElementById('close-edit-player').addEventListener('click', closeEditDialog);
  editDialog.addEventListener('click', (event) => {
    if (event.target === editDialog) closeEditDialog();
  });

  if (!service) {
    signedOutState.hidden = false;
    setMessage(message, window.DARTS_SUPABASE_ERROR || 'Saved players are temporarily unavailable.', 'error');
    return;
  }

  signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    const result = await service.client.auth.signOut({ scope: 'local' });
    if (result.error) {
      setMessage(message, result.error.message, 'error');
      signOutButton.disabled = false;
      return;
    }
    window.location.replace('../');
  });

  service.client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => loadPlayers(session), 0);
  });

  service.client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      return loadPlayers(data.session);
    })
    .catch((error) => setMessage(message, error.message, 'error'));
})();
