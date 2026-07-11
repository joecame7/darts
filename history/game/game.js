(function initialiseGameDetail() {
  const service = window.DartsSupabase;
  const historyData = window.HistoryData;
  const message = document.getElementById('detail-message');
  const signedOutState = document.getElementById('detail-signed-out');
  const unavailableState = document.getElementById('detail-unavailable');
  const unavailableTitle = document.getElementById('detail-unavailable-title');
  const unavailableText = document.getElementById('detail-unavailable-text');
  const unavailableLink = document.getElementById('detail-unavailable-link');
  const detail = document.getElementById('game-detail');
  const accountName = document.getElementById('detail-account-name');
  const signOutButton = document.getElementById('detail-sign-out');
  const title = document.getElementById('game-detail-title');
  const result = document.getElementById('game-detail-result');
  const statusBadge = document.getElementById('game-detail-status');
  const actions = document.getElementById('game-detail-actions');
  const scoreHeading = document.getElementById('score-heading');
  const playerOneName = document.getElementById('detail-player-one-name');
  const playerTwoName = document.getElementById('detail-player-two-name');
  const playerOneScore = document.getElementById('detail-player-one-score');
  const playerTwoScore = document.getElementById('detail-player-two-score');
  const startedAt = document.getElementById('detail-started-at');
  const duration = document.getElementById('detail-duration');
  const opponentType = document.getElementById('detail-opponent-type');
  const rules = document.getElementById('detail-rules');
  const scorecardSection = document.getElementById('detail-scorecard-section');
  const scorecardPlayerOne = document.getElementById('detail-scorecard-player-one');
  const scorecardPlayerTwo = document.getElementById('detail-scorecard-player-two');
  const scorecardBody = document.getElementById('detail-scorecard-body');
  const warning = document.getElementById('detail-integrity-warning');
  const warningList = document.getElementById('detail-integrity-list');
  const timelineSection = document.getElementById('detail-timeline-section');
  const timeline = document.getElementById('detail-event-timeline');
  const timelineCount = document.getElementById('detail-timeline-count');
  const timelineEmpty = document.getElementById('detail-timeline-empty');
  const deleteGameDialog = document.getElementById('delete-game-dialog');
  const deleteGameDescription = document.getElementById('delete-game-description');
  const deleteGameMessage = document.getElementById('delete-game-message');
  const cancelDeleteGameButton = document.getElementById('cancel-delete-game-button');
  const confirmDeleteGameButton = document.getElementById('confirm-delete-game-button');

  let loadVersion = 0;
  let displayedGame = null;
  let displayedUserId = null;
  let deleteInProgress = false;

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.dataset.kind = kind;
  }

  function setUnavailableState(serviceFailure = false) {
    unavailableTitle.textContent = serviceFailure ? 'Game details are unavailable' : 'Game unavailable';
    unavailableText.textContent = serviceFailure
      ? 'The account service could not load these details. Try refreshing the page.'
      : 'The link is invalid, the game no longer exists, or it belongs to another account.';
    unavailableLink.href = serviceFailure ? window.location.href : '../';
    unavailableLink.textContent = serviceFailure ? 'Try again' : 'Return to history';
    unavailableState.hidden = false;
  }

  function throwIfError(response) {
    if (response?.error) throw response.error;
    return response?.data;
  }

  function showDialog(dialog) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function setDeleteMessage(text, kind = '') {
    deleteGameMessage.textContent = text;
    deleteGameMessage.dataset.kind = kind;
  }

  function setDeleteBusy(busy) {
    deleteInProgress = busy;
    cancelDeleteGameButton.disabled = busy;
    confirmDeleteGameButton.disabled = busy;
    confirmDeleteGameButton.textContent = busy ? 'Deleting…' : 'Delete game permanently';
    deleteGameDialog.setAttribute('aria-busy', String(busy));
  }

  function resetDeleteDialog() {
    setDeleteBusy(false);
    setDeleteMessage('');
    if (deleteGameDialog.open || deleteGameDialog.hasAttribute('open')) closeDialog(deleteGameDialog);
  }

  function openDeleteDialog() {
    if (!displayedGame || !displayedUserId || deleteInProgress) return;
    deleteGameDescription.textContent = `This permanently deletes “${title.textContent}”, including its saved scorecard and timeline. It will no longer count towards your statistics. This cannot be undone.`;
    setDeleteMessage('');
    showDialog(deleteGameDialog);
    window.setTimeout(() => cancelDeleteGameButton.focus(), 0);
  }

  function closeDeleteGameDialog() {
    if (deleteInProgress) return;
    setDeleteMessage('');
    closeDialog(deleteGameDialog);
  }

  async function deleteDisplayedGame() {
    if (deleteInProgress || !displayedGame || !displayedUserId) return;

    const gameId = displayedGame.id;
    const userId = displayedUserId;
    const version = loadVersion;
    setDeleteBusy(true);
    setDeleteMessage('Deleting the game…');

    try {
      const response = await service.client.rpc('delete_owned_game', { p_game_id: gameId });
      if (response.error) throw response.error;
      if (version !== loadVersion
        || displayedUserId !== userId
        || displayedGame?.id !== gameId) return;

      setDeleteBusy(false);
      window.location.replace('../?deleted=1');
    } catch (error) {
      if (version !== loadVersion
        || displayedUserId !== userId
        || displayedGame?.id !== gameId) return;
      console.error('Unable to delete game', error);
      setDeleteBusy(false);
      setDeleteMessage(error?.message || 'The game could not be deleted. Please try again.', 'error');
      confirmDeleteGameButton.focus();
    }
  }

  function validGameId(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
  }

  function formatGameType(value) {
    return String(value || 'game')
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  function formatEventTime(value) {
    return new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(new Date(value));
  }

  function formatDuration(startValue, endValue) {
    if (!startValue || !endValue) return 'Not available';
    const milliseconds = new Date(endValue) - new Date(startValue);
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'Not available';
    const totalMinutes = Math.floor(milliseconds / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours} hr ${minutes} min`;
    if (totalMinutes > 0) return `${totalMinutes} min`;
    return '< 1 min';
  }

  function relativeResultText(summary, replay) {
    const score = Number.isInteger(summary.ownResult?.final_score)
      && Number.isInteger(summary.opponentResult?.final_score)
      ? `${summary.ownResult.final_score}-${summary.opponentResult.final_score}`
      : null;
    if (summary.isCricketV1 && !replay.replayComplete) {
      if (summary.game.status === 'in_progress') return 'Current score could not be fully verified';
      if (summary.game.status === 'abandoned') return 'Abandoned score could not be fully verified';
      return 'Completed result could not be fully verified';
    }
    if (summary.game.status === 'in_progress') {
      return replay.outcome ? 'Result detected and awaiting confirmation' : 'Game in progress';
    }
    if (summary.game.status === 'abandoned') return 'Game abandoned';
    if (summary.outcome === 'win') return `You won${score ? ` ${score}` : ''}`;
    if (summary.outcome === 'loss') return `You lost${score ? ` ${score}` : ''}`;
    if (summary.outcome === 'draw') return `Draw${score ? ` ${score}` : ''}`;
    return 'Completed game';
  }

  function statusText(summary) {
    if (summary.game.status === 'completed' && summary.outcome !== 'unknown') return summary.outcome;
    return summary.game.status.replaceAll('_', ' ');
  }

  async function fetchGame(gameId, userId) {
    return throwIfError(await service.client
      .from('games')
      .select(`
        id,
        owner_user_id,
        game_type,
        rules_version,
        status,
        started_at,
        completed_at,
        settings,
        app_version,
        game_players(id, user_id, saved_player_id, player_type, display_name, player_order),
        game_rounds(id, status, round_type, round_number, winner_player_id, started_at, completed_at, metadata),
        game_results(game_player_id, finishing_position, final_score, is_winner, result_data)
      `)
      .eq('id', gameId)
      .eq('owner_user_id', userId)
      .maybeSingle());
  }

  async function fetchGameEvents(gameId, userId) {
    const pageSize = 100;
    const events = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = throwIfError(await service.client
        .from('game_events')
        .select('id, game_id, game_round_id, game_player_id, sequence_number, event_type, payload, recorded_at, voided_at')
        .eq('game_id', gameId)
        .eq('owner_user_id', userId)
        .order('sequence_number', { ascending: true })
        .range(offset, offset + pageSize - 1)) || [];
      events.push(...page);
      if (page.length < pageSize) break;
    }
    return events;
  }

  function renderActions(game) {
    actions.replaceChildren();
    const primary = document.createElement('a');
    primary.className = 'primary-button button-link';
    primary.href = game.game_type === 'cricket' ? '../../cricket/' : '../../';
    primary.textContent = game.status === 'in_progress' && game.game_type === 'cricket'
      ? 'Resume game'
      : 'Play another game';
    const historyLink = document.createElement('a');
    historyLink.className = 'secondary-button button-link';
    historyLink.href = '../';
    historyLink.textContent = 'View all history';
    const deleteButton = document.createElement('button');
    deleteButton.className = 'secondary-button delete-game-trigger';
    deleteButton.id = 'delete-game-button';
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete game';
    deleteButton.addEventListener('click', openDeleteDialog);
    actions.append(primary, historyLink, deleteButton);
  }

  function renderScorecard(replay) {
    scorecardBody.replaceChildren();
    for (const segment of historyData.segments) {
      const row = document.createElement('tr');
      const firstMarks = document.createElement('td');
      const target = document.createElement('th');
      target.scope = 'row';
      target.textContent = segment;
      const secondMarks = document.createElement('td');

      for (const [cell, slot] of [[firstMarks, 'p1'], [secondMarks, 'p2']]) {
        const count = Math.min(3, replay.state.hits[slot][segment]);
        if (count === 0) {
          cell.textContent = '—';
          cell.className = 'empty-mark';
        } else {
          const image = document.createElement('img');
          image.src = `../../tally${count}.png`;
          image.alt = `${count} of 3 marks`;
          cell.append(image);
        }
      }
      row.append(firstMarks, target, secondMarks);
      scorecardBody.append(row);
    }
  }

  function timelineDescription(item) {
    const playerName = item.player?.display_name || 'Unknown player';
    const segment = item.segment || 'unknown target';
    if (item.status === 'voided') return `${playerName}'s ${segment} mark was undone`;
    if (item.status === 'invalid') return `${playerName}'s ${segment} mark could not be replayed`;
    if (item.status === 'unverified') return `${playerName}'s ${segment} mark follows unverified data`;
    if (item.pointsAdded > 0) return `${playerName} scored ${item.pointsAdded} points on ${segment}`;
    return `${playerName} marked ${segment} (${item.hitCountAfter} of 3)`;
  }

  function renderTimeline(replay) {
    timeline.replaceChildren();
    timelineCount.textContent = `${replay.timeline.length} saved action${replay.timeline.length === 1 ? '' : 's'}`;
    timelineEmpty.hidden = replay.timeline.length !== 0;

    for (const item of replay.timeline) {
      const entry = document.createElement('li');
      entry.className = 'game-event-item';
      entry.dataset.status = item.status;
      const sequence = document.createElement('span');
      sequence.className = 'game-event-sequence';
      sequence.textContent = String(item.sequence);
      sequence.setAttribute('aria-label', `Action ${item.sequence}`);
      const content = document.createElement('div');
      const description = document.createElement('strong');
      description.textContent = timelineDescription(item);
      const metadata = document.createElement('p');
      if (item.recordedAt) {
        const time = document.createElement('time');
        time.dateTime = item.recordedAt;
        time.textContent = formatEventTime(item.recordedAt);
        metadata.append(time);
      }
      if (item.status === 'active') {
        const score = document.createTextNode(` · Match score after: ${item.scoresAfter.p1}-${item.scoresAfter.p2}`);
        metadata.append(score);
      } else if (item.status === 'voided') {
        metadata.append(document.createTextNode(' · Excluded from the final score'));
      } else if (item.status === 'unverified') {
        metadata.append(document.createTextNode(' · Not applied after an earlier replay problem'));
      }
      content.append(description, metadata);
      entry.append(sequence, content);
      timeline.append(entry);
    }
  }

  function renderWarnings(replay) {
    const uniqueIssues = [...new Map(replay.issues.map((item) => [`${item.code}:${item.message}`, item])).values()];
    warning.hidden = uniqueIssues.length === 0;
    warningList.replaceChildren();
    for (const item of uniqueIssues) {
      const listItem = document.createElement('li');
      listItem.textContent = item.message;
      warningList.append(listItem);
    }
  }

  function renderDetail(game, events, userId) {
    const summary = historyData.summariseGame(game, userId);
    const replay = historyData.replayCricketGame(game, events);
    const firstPlayer = replay.players[0];
    const secondPlayer = replay.players[1];
    const opponent = summary.opponent;
    displayedGame = game;
    displayedUserId = userId;

    title.textContent = opponent
      ? `${formatGameType(game.game_type)} vs ${opponent.display_name}`
      : formatGameType(game.game_type);
    result.textContent = relativeResultText(summary, replay);
    statusBadge.textContent = game.status === 'completed' && !replay.replayComplete
      ? 'completed'
      : statusText(summary);
    statusBadge.dataset.status = game.status === 'completed' && replay.replayComplete
      ? summary.outcome
      : game.status;
    document.title = `${title.textContent} - Darts`;

    playerOneName.textContent = firstPlayer?.display_name || 'Player 1';
    playerTwoName.textContent = secondPlayer?.display_name || 'Player 2';
    scorecardPlayerOne.textContent = playerOneName.textContent;
    scorecardPlayerTwo.textContent = playerTwoName.textContent;
    const firstResult = firstPlayer ? historyData.resultForPlayer(game, firstPlayer.id) : null;
    const secondResult = secondPlayer ? historyData.resultForPlayer(game, secondPlayer.id) : null;
    const firstStoredScore = Number.isInteger(firstResult?.final_score) ? firstResult.final_score : null;
    const secondStoredScore = Number.isInteger(secondResult?.final_score) ? secondResult.final_score : null;
    const useCompletedStoredScore = game.status === 'completed'
      && (!summary.isCricketV1 || replay.replayComplete);
    playerOneScore.textContent = String(useCompletedStoredScore && firstStoredScore !== null
      ? firstStoredScore
      : (summary.isCricketV1 ? replay.state.scores.p1 : '—'));
    playerTwoScore.textContent = String(useCompletedStoredScore && secondStoredScore !== null
      ? secondStoredScore
      : (summary.isCricketV1 ? replay.state.scores.p2 : '—'));

    scoreHeading.textContent = game.status === 'in_progress'
      ? 'Current scoreboard'
      : (game.status === 'abandoned' ? 'Score at abandonment' : 'Final scoreboard');

    startedAt.dateTime = game.started_at;
    startedAt.textContent = formatDate(game.started_at);
    duration.textContent = formatDuration(game.started_at, game.completed_at);
    opponentType.textContent = opponent?.player_type === 'saved'
      ? 'Saved player'
      : (opponent?.player_type === 'guest'
        ? 'One-time guest'
        : (opponent?.player_type === 'account' ? 'Account player' : 'Not available'));
    rules.textContent = `${formatGameType(game.game_type)} v${game.rules_version}`;
    renderActions(game);

    const supportedCricket = game.game_type === 'cricket' && game.rules_version === 1;
    scorecardSection.hidden = !supportedCricket;
    timelineSection.hidden = !supportedCricket;
    if (supportedCricket) {
      renderScorecard(replay);
      renderTimeline(replay);
    }
    renderWarnings(replay);
    detail.hidden = false;
  }

  async function loadDetail(session) {
    const version = ++loadVersion;
    const user = session?.user || null;
    const gameId = new URLSearchParams(window.location.search).get('id');
    displayedGame = null;
    displayedUserId = user?.id || null;
    resetDeleteDialog();
    detail.hidden = true;
    unavailableState.hidden = true;
    signedOutState.hidden = Boolean(user);
    signOutButton.hidden = !user;

    if (!user) {
      accountName.textContent = '';
      setMessage('');
      return;
    }
    if (!validGameId(gameId)) {
      setUnavailableState(false);
      setMessage('');
      return;
    }

    setMessage('Loading the saved scorecard...');
    try {
      const [profile, game] = await Promise.all([
        service.getOrCreateProfile(user),
        fetchGame(gameId, user.id),
      ]);
      if (version !== loadVersion) return;
      accountName.textContent = profile?.display_name || service.fallbackDisplayName(user);
      if (!game) {
        setUnavailableState(false);
        setMessage('');
        return;
      }

      const events = await fetchGameEvents(game.id, user.id);
      if (version !== loadVersion) return;
      renderDetail(game, events, user.id);
      setMessage('');
    } catch (error) {
      if (version !== loadVersion) return;
      console.error('Unable to load game details', error);
      setUnavailableState(true);
      setMessage(error?.message || 'The game details could not be loaded.', 'error');
    }
  }

  signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    const response = await service.client.auth.signOut({ scope: 'local' });
    if (response.error) {
      setMessage(response.error.message, 'error');
      signOutButton.disabled = false;
      return;
    }
    window.location.replace('../../');
  });

  cancelDeleteGameButton.addEventListener('click', closeDeleteGameDialog);
  confirmDeleteGameButton.addEventListener('click', deleteDisplayedGame);
  deleteGameDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDeleteGameDialog();
  });
  deleteGameDialog.addEventListener('click', (event) => {
    if (event.target === deleteGameDialog) closeDeleteGameDialog();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!deleteInProgress) return;
    event.preventDefault();
    event.returnValue = '';
  });

  if (!service || !historyData) {
    setUnavailableState(true);
    setMessage(window.DARTS_SUPABASE_ERROR || 'Game details are temporarily unavailable.', 'error');
    return;
  }

  service.client.auth.onAuthStateChange((_event, session) => {
    if (deleteInProgress && session?.user?.id === displayedUserId) return;
    window.setTimeout(() => loadDetail(session), 0);
  });

  service.client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      return loadDetail(data.session);
    })
    .catch((error) => setMessage(error.message, 'error'));
})();
