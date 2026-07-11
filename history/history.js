(function initialiseHistory() {
  const service = window.DartsSupabase;
  const historyData = window.HistoryData;
  const message = document.getElementById('history-message');
  const signedOutState = document.getElementById('signed-out-history');
  const unavailableState = document.getElementById('unavailable-history');
  const emptyState = document.getElementById('empty-history');
  const historyContent = document.getElementById('history-content');
  const historyList = document.getElementById('history-list');
  const filteredHistoryEmpty = document.getElementById('filtered-history-empty');
  const historyListSummary = document.getElementById('history-list-summary');
  const accountName = document.getElementById('history-account-name');
  const signOutButton = document.getElementById('history-sign-out');
  const statGamesPlayed = document.getElementById('stat-games-played');
  const statRecord = document.getElementById('stat-record');
  const statWinRate = document.getElementById('stat-win-rate');
  const statAveragePoints = document.getElementById('stat-average-points');
  const lifecycleSummary = document.getElementById('history-lifecycle-summary');
  const targetStatsBody = document.getElementById('target-stats-body');
  const targetStatsNote = document.getElementById('target-stats-note');
  const opponentRecordList = document.getElementById('opponent-record-list');
  const opponentRecordEmpty = document.getElementById('opponent-record-empty');
  const filterButtons = [...document.querySelectorAll('.history-filter')];

  const initialUrl = new URL(window.location.href);
  let pendingDeletedNotice = initialUrl.searchParams.get('deleted') === '1';
  let deletedNoticeVisible = false;
  if (pendingDeletedNotice) {
    initialUrl.searchParams.delete('deleted');
    window.history.replaceState(null, '', `${initialUrl.pathname}${initialUrl.search}${initialUrl.hash}`);
  }

  let loadVersion = 0;
  let activeFilter = 'all';
  let currentSummaries = [];

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.dataset.kind = kind;
  }

  function setLoadedMessage() {
    if (pendingDeletedNotice) {
      setMessage('Game deleted. Your history and statistics have been updated.', 'success');
      pendingDeletedNotice = false;
      deletedNoticeVisible = true;
      return;
    }
    if (deletedNoticeVisible && message.dataset.kind === 'success') return;
    setMessage('');
  }

  function throwIfError(result) {
    if (result?.error) throw result.error;
    return result?.data || [];
  }

  function formatGameType(value) {
    return String(value || 'game')
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

  function formatNumber(value, maximumFractionDigits = 1) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value || 0);
  }

  function formatPercent(value) {
    return `${formatNumber(value, 1)}%`;
  }

  function scoreText(summary) {
    if (!Number.isInteger(summary.ownResult?.final_score)
      || !Number.isInteger(summary.opponentResult?.final_score)) return '';
    return `${summary.ownResult.final_score}-${summary.opponentResult.final_score}`;
  }

  function resultText(summary) {
    if (summary.game.status === 'in_progress') return 'In progress';
    if (summary.game.status === 'abandoned') return 'Abandoned';
    if (summary.isCricketV1 && summary.replayVerified === false) return 'Completed · Statistics unavailable';
    const score = scoreText(summary);
    if (summary.outcome === 'win') return `Win${score ? ` ${score}` : ''}`;
    if (summary.outcome === 'loss') return `Loss${score ? ` ${score}` : ''}`;
    if (summary.outcome === 'draw') return `Draw${score ? ` ${score}` : ''}`;
    return 'Completed';
  }

  function badgeText(summary) {
    if (summary.game.status === 'completed' && summary.isCricketV1 && summary.replayVerified === false) return 'completed';
    if (summary.game.status === 'completed' && summary.outcome !== 'unknown') return summary.outcome;
    return summary.game.status.replaceAll('_', ' ');
  }

  async function fetchAllGames(userId) {
    const pageSize = 100;
    const games = [];
    let upperStartedAt = null;
    for (let offset = 0; ; offset += pageSize) {
      let query = service.client
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
        .eq('owner_user_id', userId)
        .order('started_at', { ascending: false })
        .order('id', { ascending: false });
      if (upperStartedAt) query = query.lte('started_at', upperStartedAt);
      const page = throwIfError(await query.range(offset, offset + pageSize - 1));
      if (!upperStartedAt && page[0]?.started_at) upperStartedAt = page[0].started_at;
      games.push(...page);
      if (page.length < pageSize) break;
    }
    return [...new Map(games.map((game) => [game.id, game])).values()];
  }

  async function fetchEventsForGames(games, userId) {
    const gameIds = games
      .filter((game) => game.game_type === 'cricket' && game.rules_version === 1 && game.status === 'completed')
      .map((game) => game.id);
    const allEvents = [];
    const batchSize = 25;
    const pageSize = 100;

    for (let batchStart = 0; batchStart < gameIds.length; batchStart += batchSize) {
      const batchIds = gameIds.slice(batchStart, batchStart + batchSize);
      for (let offset = 0; ; offset += pageSize) {
        const page = throwIfError(await service.client
          .from('game_events')
          .select('id, game_id, game_round_id, game_player_id, sequence_number, event_type, payload, recorded_at, voided_at')
          .eq('owner_user_id', userId)
          .in('game_id', batchIds)
          .order('game_id', { ascending: true })
          .order('sequence_number', { ascending: true })
          .range(offset, offset + pageSize - 1));
        allEvents.push(...page);
        if (page.length < pageSize) break;
      }
    }
    return allEvents;
  }

  function renderOverview(stats) {
    const { totals } = stats;
    statGamesPlayed.textContent = formatNumber(totals.played, 0);
    statRecord.textContent = `${totals.wins}-${totals.losses}-${totals.draws}`;
    statWinRate.textContent = formatPercent(totals.winRate);
    statAveragePoints.textContent = formatNumber(totals.averageFinalPoints, 1);
    const excluded = stats.skippedTargetGames
      ? ` · Excluded from statistics: ${stats.skippedTargetGames}`
      : '';
    lifecycleSummary.textContent = `Highest final points: ${formatNumber(totals.highestFinalPoints, 0)} · Active: ${totals.active} · Abandoned: ${totals.abandoned}${excluded}`;
  }

  function renderTargetStats(stats) {
    targetStatsBody.replaceChildren();
    for (const segment of historyData.segments) {
      const target = stats.targetStats[segment];
      const row = document.createElement('tr');
      const targetName = document.createElement('th');
      targetName.scope = 'row';
      targetName.textContent = segment;
      const marks = document.createElement('td');
      marks.textContent = formatNumber(target.marks, 0);
      const scoringMarks = document.createElement('td');
      scoringMarks.textContent = formatNumber(target.scoringMarks, 0);
      const points = document.createElement('td');
      points.textContent = formatNumber(target.points, 0);
      row.append(targetName, marks, scoringMarks, points);
      targetStatsBody.append(row);
    }

    targetStatsNote.textContent = stats.skippedTargetGames
      ? `These are scorecard taps, not physical-dart accuracy. ${stats.skippedTargetGames} game${stats.skippedTargetGames === 1 ? '' : 's'} could not be verified and was excluded from statistics.`
      : 'These are scorecard taps, not physical-dart accuracy.';
  }

  function renderOpponentStats(opponents) {
    opponentRecordList.replaceChildren();
    opponentRecordEmpty.hidden = opponents.length !== 0;
    for (const opponent of opponents) {
      const item = document.createElement('li');
      item.className = 'opponent-record-card';

      const identity = document.createElement('div');
      identity.className = 'opponent-record-identity';
      const avatar = document.createElement('span');
      avatar.className = 'opponent-record-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = Array.from(opponent.displayName)[0]?.toUpperCase() || 'P';
      const nameBlock = document.createElement('div');
      const name = document.createElement('h3');
      name.textContent = opponent.displayName;
      const detail = document.createElement('p');
      detail.textContent = `${opponent.games} completed game${opponent.games === 1 ? '' : 's'} · Last played ${formatDate(opponent.lastPlayedAt)}`;
      nameBlock.append(name, detail);
      identity.append(avatar, nameBlock);

      const record = document.createElement('dl');
      record.className = 'opponent-record-metrics';
      const recordGroup = document.createElement('div');
      const recordLabel = document.createElement('dt');
      recordLabel.textContent = 'Record';
      const recordValue = document.createElement('dd');
      recordValue.textContent = `${opponent.wins}-${opponent.losses}-${opponent.draws}`;
      recordGroup.append(recordLabel, recordValue);
      const rateGroup = document.createElement('div');
      const rateLabel = document.createElement('dt');
      rateLabel.textContent = 'Win rate';
      const rateValue = document.createElement('dd');
      rateValue.textContent = formatPercent(opponent.winRate);
      rateGroup.append(rateLabel, rateValue);
      record.append(recordGroup, rateGroup);

      item.append(identity, record);
      opponentRecordList.append(item);
    }
  }

  function renderGames() {
    historyList.replaceChildren();
    const visible = activeFilter === 'all'
      ? currentSummaries
      : currentSummaries.filter((summary) => summary.game.status === activeFilter);
    filteredHistoryEmpty.hidden = visible.length !== 0;
    historyListSummary.textContent = activeFilter === 'all'
      ? `${visible.length} tracked game${visible.length === 1 ? '' : 's'}`
      : `${visible.length} of ${currentSummaries.length} tracked games`;

    for (const summary of visible) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'game-history-link';
      link.href = `game/?id=${encodeURIComponent(summary.game.id)}`;

      const details = document.createElement('div');
      details.className = 'game-history-main';
      const title = document.createElement('h3');
      title.textContent = summary.opponent
        ? `${formatGameType(summary.game.game_type)} vs ${summary.opponent.display_name}`
        : formatGameType(summary.game.game_type);
      const result = document.createElement('p');
      result.className = 'game-history-result';
      result.textContent = resultText(summary);
      const date = document.createElement('time');
      date.dateTime = summary.game.started_at;
      date.textContent = formatDate(summary.game.started_at);
      details.append(title, result, date);

      const trailing = document.createElement('div');
      trailing.className = 'game-history-trailing';
      const status = document.createElement('span');
      status.className = 'status-badge';
      status.dataset.status = summary.game.status === 'completed' && summary.replayVerified
        ? summary.outcome
        : summary.game.status;
      status.textContent = badgeText(summary);
      const arrow = document.createElement('span');
      arrow.className = 'game-history-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      trailing.append(status, arrow);

      link.append(details, trailing);
      item.append(link);
      historyList.append(item);
    }
  }

  function renderHistory(games, events, savedPlayers, userId) {
    const stats = historyData.calculateHistoryStats(games, events, userId);
    stats.summaries.forEach((summary) => {
      summary.replayVerified = summary.game.status !== 'completed'
        || !summary.isCricketV1
        || stats.verifiedGameIds.has(summary.game.id);
    });
    const currentPlayerNames = new Map(savedPlayers.map((player) => [player.id, player.display_name]));
    stats.opponentStats.forEach((opponent) => {
      if (opponent.savedPlayerId && currentPlayerNames.has(opponent.savedPlayerId)) {
        opponent.displayName = currentPlayerNames.get(opponent.savedPlayerId);
      }
    });
    currentSummaries = stats.summaries;
    renderOverview(stats);
    renderTargetStats(stats);
    renderOpponentStats(stats.opponentStats);
    renderGames();
  }

  async function loadHistory(session) {
    const version = ++loadVersion;
    const user = session?.user || null;
    signedOutState.hidden = Boolean(user);
    unavailableState.hidden = true;
    emptyState.hidden = true;
    historyContent.hidden = true;
    historyList.replaceChildren();
    currentSummaries = [];
    activeFilter = 'all';
    filterButtons.forEach((button) => {
      const active = button.dataset.status === 'all';
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    signOutButton.hidden = !user;

    if (!user) {
      accountName.textContent = '';
      setMessage('');
      return;
    }

    setMessage('Loading all games and statistics...');
    try {
      const [profile, games, savedPlayersResult] = await Promise.all([
        service.getOrCreateProfile(user),
        fetchAllGames(user.id),
        service.client
          .from('saved_players')
          .select('id, display_name')
          .eq('owner_user_id', user.id),
      ]);
      if (savedPlayersResult.error) throw savedPlayersResult.error;
      if (version !== loadVersion) return;
      accountName.textContent = profile?.display_name || service.fallbackDisplayName(user);

      if (!games.length) {
        emptyState.hidden = false;
        setLoadedMessage();
        return;
      }

      const events = await fetchEventsForGames(games, user.id);
      if (version !== loadVersion) return;
      renderHistory(games, events, savedPlayersResult.data || [], user.id);
      historyContent.hidden = false;
      setLoadedMessage();
    } catch (error) {
      if (version !== loadVersion) return;
      console.error('Unable to load game history', error);
      setMessage(error?.message || 'Your game history could not be loaded.', 'error');
    }
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.status;
      filterButtons.forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle('is-active', active);
        candidate.setAttribute('aria-pressed', String(active));
      });
      renderGames();
    });
  });

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

  if (!service || !historyData) {
    signedOutState.hidden = true;
    unavailableState.hidden = false;
    setMessage(window.DARTS_SUPABASE_ERROR || 'History is temporarily unavailable.', 'error');
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
