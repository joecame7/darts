(function initialiseTrackedCricket() {
  const service = window.DartsSupabase;
  const engine = window.CricketEngine;
  const tallyImages = {
    1: '../tally1.png',
    2: '../tally2.png',
    3: '../tally3.png',
  };

  const accountRequired = document.getElementById('account-required');
  const loadingScreen = document.getElementById('cricket-loading');
  const setupScreen = document.getElementById('cricket-setup');
  const setupForm = document.getElementById('cricket-setup-form');
  const setupMessage = document.getElementById('setup-message');
  const startGameButton = document.getElementById('start-game-button');
  const accountPlayerName = document.getElementById('account-player-name');
  const accountPlayerAvatar = document.getElementById('account-player-avatar');
  const opponentType = document.getElementById('opponent-type');
  const savedOpponentField = document.getElementById('saved-opponent-field');
  const savedOpponentSelect = document.getElementById('saved-opponent');
  const guestOpponentField = document.getElementById('guest-opponent-field');
  const guestOpponentInput = document.getElementById('guest-opponent-name');
  const resumeCard = document.getElementById('resume-game-card');
  const resumeDetail = document.getElementById('resume-game-detail');
  const resumeButton = document.getElementById('resume-game-button');
  const discardResumeButton = document.getElementById('discard-resume-button');
  const gameScreen = document.getElementById('cricket-game');
  const saveStatus = document.getElementById('save-status');
  const p1Name = document.getElementById('p1-name');
  const p2Name = document.getElementById('p2-name');
  const p1Score = document.getElementById('p1-score');
  const p2Score = document.getElementById('p2-score');
  const scoreAnnouncement = document.getElementById('score-announcement');
  const markButtons = [...document.querySelectorAll('.mark-button')];
  const undoButton = document.getElementById('tracked-undo-button');
  const abandonGameButton = document.getElementById('abandon-game-button');
  const winnerDialog = document.getElementById('winner-dialog');
  const winnerTitle = document.getElementById('winner-title');
  const winnerDetail = document.getElementById('winner-detail');
  const winnerSaveMessage = document.getElementById('winner-save-message');
  const winnerConfirmActions = document.getElementById('winner-confirm-actions');
  const winnerSavedActions = document.getElementById('winner-saved-actions');
  const confirmWinButton = document.getElementById('confirm-win-button');
  const undoWinningMarkButton = document.getElementById('undo-winning-mark-button');
  const retrySaveButton = document.getElementById('retry-save-button');
  const abandonDialog = document.getElementById('abandon-dialog');
  const abandonMessage = document.getElementById('abandon-message');
  const confirmAbandonButton = document.getElementById('confirm-abandon-button');
  const cancelAbandonButton = document.getElementById('cancel-abandon-button');

  let currentUser = null;
  let profileName = 'Player';
  let savedPlayers = [];
  let unfinishedGame = null;
  let currentGame = null;
  let cricketState = engine ? engine.createState() : null;
  let actionHistory = [];
  let allEventRows = new Map();
  let nextSequence = 1;
  let pendingOutcome = null;
  let resultSaved = false;
  let syncQueue = Promise.resolve();
  let pendingSyncCount = 0;
  let syncHasError = false;
  let syncConflict = false;
  let abandoningTarget = null;
  let loadVersion = 0;
  let accountDataReady = false;
  let resumeInProgress = false;
  let startInProgress = false;
  let abandonInProgress = false;
  let operationGeneration = 0;

  function setMessage(element, text, kind = '') {
    element.textContent = text;
    element.dataset.kind = kind;
  }

  function setSaveStatus(text, state, detail = '') {
    saveStatus.textContent = text;
    saveStatus.dataset.state = state;
    saveStatus.title = detail;
  }

  function normaliseName(value) {
    return value.trim().replace(/\s+/g, ' ');
  }

  function newUuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function showDialog(dialog) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function throwIfError(result) {
    if (result?.error) throw result.error;
    return result?.data;
  }

  function queueSync(task) {
    const generation = operationGeneration;
    pendingSyncCount += 1;
    setSaveStatus('Saving...', 'saving');
    const run = syncQueue.then(() => {
      if (generation !== operationGeneration) throw new Error('This save belongs to an earlier account or game.');
      return task();
    });
    syncQueue = run.catch(() => undefined);

    return run.then(
      (value) => {
        if (generation !== operationGeneration) return { ok: false, stale: true };
        pendingSyncCount -= 1;
        syncHasError = false;
        if (pendingSyncCount === 0 && !resultSaved) setSaveStatus('Saved', 'saved');
        return { ok: true, value };
      },
      (error) => {
        if (generation !== operationGeneration) return { ok: false, stale: true, error };
        pendingSyncCount -= 1;
        syncHasError = true;
        console.error('Cricket sync failed', error);
        const sequenceConflict = error?.code === '23505';
        syncConflict = sequenceConflict;
        setSaveStatus(
          sequenceConflict ? 'Reload needed' : 'Not saved',
          'error',
          sequenceConflict
            ? 'This game changed in another tab. Reload to restore the latest saved score.'
            : 'A change could not be saved. Keep this page open and try again.',
        );
        scoreAnnouncement.textContent = sequenceConflict
          ? 'This game changed in another tab. Reload to restore the latest saved score.'
          : 'A score change could not be saved. Keep this page open and try again.';
        if (sequenceConflict) renderBoard();
        return { ok: false, error };
      },
    );
  }

  function resetGameState() {
    operationGeneration += 1;
    cricketState = engine.createState();
    actionHistory = [];
    allEventRows = new Map();
    nextSequence = 1;
    pendingOutcome = null;
    resultSaved = false;
    syncQueue = Promise.resolve();
    pendingSyncCount = 0;
    syncHasError = false;
    syncConflict = false;
    scoreAnnouncement.textContent = '';
  }

  function playerForSlot(slot) {
    return currentGame?.players?.[slot] || null;
  }

  function slotForPlayerId(playerId) {
    if (currentGame?.players?.p1?.id === playerId) return 'p1';
    if (currentGame?.players?.p2?.id === playerId) return 'p2';
    return null;
  }

  function renderBoard() {
    if (!currentGame) return;
    p1Name.textContent = currentGame.players.p1.display_name;
    p2Name.textContent = currentGame.players.p2.display_name;
    p1Score.textContent = String(cricketState.scores.p1);
    p2Score.textContent = String(cricketState.scores.p2);

    const locked = Boolean(pendingOutcome) || resultSaved || syncConflict;
    for (const button of markButtons) {
      const slot = button.dataset.player;
      const segment = button.dataset.segment;
      const count = cricketState.hits[slot][segment];
      const opponent = engine.otherPlayer(slot);
      const blocked = count >= 3 && cricketState.hits[opponent][segment] >= 3;
      button.replaceChildren();
      if (count > 0) {
        const image = document.createElement('img');
        image.src = tallyImages[Math.min(3, count)];
        image.alt = '';
        button.append(image);
      }
      button.classList.toggle('target-closed', count >= 3);
      button.classList.toggle('target-blocked', blocked);
      button.disabled = locked || blocked;
      button.setAttribute(
        'aria-label',
        `${playerForSlot(slot).display_name}: ${segment}, ${count} of 3 marks${count >= 3 ? ', closed' : ''}${blocked ? ' by both players; no more scoring' : ''}; score ${cricketState.scores[slot]}`,
      );
    }

    undoButton.disabled = locked || actionHistory.length === 0;
    abandonGameButton.disabled = syncConflict;
  }

  function updateOpponentFields() {
    const usingSavedPlayer = opponentType.value === 'saved';
    savedOpponentField.hidden = !usingSavedPlayer;
    guestOpponentField.hidden = usingSavedPlayer;
    savedOpponentSelect.required = usingSavedPlayer;
    guestOpponentInput.required = !usingSavedPlayer;
  }

  function populateSavedPlayers() {
    savedOpponentSelect.replaceChildren();
    for (const player of savedPlayers) {
      const option = document.createElement('option');
      option.value = player.id;
      option.textContent = player.display_name;
      savedOpponentSelect.append(option);
    }

    const savedOption = opponentType.querySelector('option[value="saved"]');
    savedOption.disabled = savedPlayers.length === 0;
    if (savedPlayers.length === 0) opponentType.value = 'guest';
    updateOpponentFields();
  }

  function displaySetup() {
    document.body.classList.remove('game-active');
    accountRequired.hidden = true;
    setupScreen.hidden = false;
    gameScreen.hidden = true;
    setSaveStatus('Not started', 'idle');
  }

  function displayGame() {
    document.body.classList.add('game-active');
    setupScreen.hidden = true;
    accountRequired.hidden = true;
    gameScreen.hidden = false;
    setSaveStatus('Saved', 'saved');
    renderBoard();
  }

  function renderResumeCard() {
    resumeCard.hidden = !unfinishedGame;
    startGameButton.disabled = !accountDataReady || Boolean(unfinishedGame) || startInProgress;
    resumeButton.disabled = !accountDataReady || !unfinishedGame || resumeInProgress;
    discardResumeButton.disabled = !accountDataReady || !unfinishedGame || resumeInProgress;
    if (!unfinishedGame) {
      resumeDetail.textContent = '';
      return;
    }
    const players = [...(unfinishedGame.game_players || [])].sort((a, b) => a.player_order - b.player_order);
    const opponent = players[1]?.display_name || 'your opponent';
    const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(unfinishedGame.started_at));
    resumeDetail.textContent = `Against ${opponent}, started ${date}. Resume or abandon it before starting another.`;
  }

  async function loadAccountData(session) {
    const version = ++loadVersion;
    const nextUser = session?.user || null;
    accountDataReady = false;
    loadingScreen.hidden = true;
    resumeInProgress = false;
    startGameButton.disabled = true;
    startGameButton.textContent = 'Start tracked game';
    resumeButton.disabled = true;
    discardResumeButton.disabled = true;
    currentUser = nextUser;
    currentGame = null;
    unfinishedGame = null;
    savedPlayers = [];
    abandoningTarget = null;
    startInProgress = false;
    abandonInProgress = false;
    resumeCard.hidden = true;
    resumeDetail.textContent = '';
    savedOpponentSelect.replaceChildren();
    if (winnerDialog.open) closeDialog(winnerDialog);
    if (abandonDialog.open) closeDialog(abandonDialog);
    resetGameState();
    if (!currentUser) {
      document.body.classList.remove('game-active');
      setupScreen.hidden = true;
      gameScreen.hidden = true;
      accountRequired.hidden = false;
      setSaveStatus('Sign in required', 'idle');
      return;
    }

    const user = currentUser;
    const userId = user.id;
    displaySetup();
    startGameButton.disabled = true;
    profileName = service.fallbackDisplayName(user);
    accountPlayerName.textContent = profileName;
    accountPlayerAvatar.textContent = Array.from(profileName)[0]?.toUpperCase() || 'P';
    setMessage(setupMessage, 'Loading opponents...');

    try {
      const [profile, playersResult, gameResult, eventsCheck] = await Promise.all([
        service.getOrCreateProfile(user),
        service.client
          .from('saved_players')
          .select('id, display_name')
          .is('archived_at', null)
          .order('display_name', { ascending: true }),
        service.client
          .from('games')
          .select('id, status, started_at, rules_version, settings, game_players(id, display_name, player_order, player_type, saved_player_id, user_id), game_rounds(id, status, round_type, round_number)')
          .eq('owner_user_id', userId)
          .eq('game_type', 'cricket')
          .eq('status', 'in_progress')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        service.client.from('game_events').select('id').limit(0),
      ]);
      if (playersResult.error) throw playersResult.error;
      if (gameResult.error) throw gameResult.error;
      if (eventsCheck.error) throw new Error('The tracked-game database migration has not been installed yet.');
      if (version !== loadVersion || currentUser?.id !== userId) return;

      if (profile?.display_name) profileName = profile.display_name;
      accountPlayerName.textContent = profileName;
      accountPlayerAvatar.textContent = Array.from(profileName)[0]?.toUpperCase() || 'P';
      savedPlayers = playersResult.data || [];
      unfinishedGame = gameResult.data || null;
      accountDataReady = true;
      populateSavedPlayers();
      renderResumeCard();
      setMessage(setupMessage, unfinishedGame ? 'Resume or abandon the unfinished game first.' : '');
    } catch (error) {
      if (version !== loadVersion) return;
      console.error('Unable to initialise tracked Cricket', error);
      setMessage(setupMessage, error?.message || 'Tracked Cricket could not be loaded.', 'error');
      startGameButton.disabled = true;
      resumeButton.disabled = true;
    }
  }

  async function startGame(event) {
    event.preventDefault();
    if (!currentUser || unfinishedGame || !accountDataReady || startInProgress) return;

    let opponent;
    if (opponentType.value === 'saved') {
      const savedPlayer = savedPlayers.find((player) => player.id === savedOpponentSelect.value);
      if (!savedPlayer) {
        setMessage(setupMessage, 'Choose a saved opponent.', 'error');
        return;
      }
      opponent = {
        display_name: savedPlayer.display_name,
        player_type: 'saved',
        saved_player_id: savedPlayer.id,
        user_id: null,
      };
    } else {
      const guestName = normaliseName(guestOpponentInput.value);
      if (!guestName) {
        setMessage(setupMessage, 'Enter a name for your opponent.', 'error');
        guestOpponentInput.focus();
        return;
      }
      opponent = {
        display_name: guestName,
        player_type: 'guest',
        saved_player_id: null,
        user_id: null,
      };
    }

    const userId = currentUser.id;
    const version = loadVersion;
    startInProgress = true;
    startGameButton.disabled = true;
    startGameButton.textContent = 'Starting...';
    setMessage(setupMessage, 'Creating your tracked game...');

    try {
      const game = throwIfError(await service.client.rpc('start_cricket_game', {
        p_opponent_type: opponent.player_type,
        p_saved_player_id: opponent.saved_player_id,
        p_guest_display_name: opponent.player_type === 'guest' ? opponent.display_name : null,
        p_app_version: 'tracked-cricket-1',
      }));
      if (version !== loadVersion || currentUser?.id !== userId) return;

      currentGame = game;
      unfinishedGame = null;
      resetGameState();
      displayGame();
      setMessage(setupMessage, '');
    } catch (error) {
      if (version !== loadVersion || currentUser?.id !== userId) return;
      console.error('Unable to start Cricket game', error);
      const message = error?.code === '23505'
        ? 'An unfinished Cricket game already exists. Reload this page to resume it.'
        : (error?.message || 'The tracked game could not be started.');
      setMessage(setupMessage, message, 'error');
    } finally {
      if (version === loadVersion && currentUser?.id === userId) {
        startInProgress = false;
        startGameButton.textContent = 'Start tracked game';
        renderResumeCard();
      }
    }
  }

  function buildEventRow(action) {
    return {
      id: action.id,
      game_id: currentGame.id,
      owner_user_id: currentUser.id,
      game_round_id: currentGame.round.id,
      game_player_id: action.playerId,
      sequence_number: action.sequence,
      event_type: 'cricket_mark',
      payload: { segment: action.segment, input_mode: 'scorecard_mark' },
      recorded_at: action.recordedAt,
      voided_at: action.voidedAt,
    };
  }

  function saveEvent(action) {
    const row = buildEventRow(action);
    allEventRows.set(row.id, row);
    return queueSync(async () => {
      const rows = syncHasError ? [...allEventRows.values()] : [row];
      throwIfError(await service.client.from('game_events').upsert(rows));
    });
  }

  function addMark(slot, segment) {
    if (!currentGame || pendingOutcome || resultSaved) return;
    const before = engine.cloneState(cricketState);
    const result = engine.applyMark(cricketState, slot, segment);
    if (!result.applied) return;

    cricketState = result.state;
    const action = {
      id: newUuid(),
      sequence: nextSequence,
      slot,
      playerId: playerForSlot(slot).id,
      segment,
      before,
      recordedAt: new Date().toISOString(),
      voidedAt: null,
    };
    nextSequence += 1;
    actionHistory.push(action);
    saveEvent(action);
    renderBoard();
    const playerName = playerForSlot(slot).display_name;
    scoreAnnouncement.textContent = result.event.points_added > 0
      ? `${playerName} scored ${result.event.points_added} points on ${segment}. Score ${cricketState.scores[slot]}.`
      : `${playerName} marked ${segment}. ${result.event.hit_count_after} of 3 marks.`;

    const outcome = engine.findOutcome(cricketState);
    if (outcome) showDetectedOutcome(outcome);
  }

  function undoLastAction() {
    if (!currentGame || resultSaved) return;
    const action = actionHistory.pop();
    if (!action) return;
    cricketState = engine.cloneState(action.before);
    action.voidedAt = new Date().toISOString();
    saveEvent(action);
    pendingOutcome = null;
    renderBoard();
    scoreAnnouncement.textContent = `Last ${action.segment} mark by ${playerForSlot(action.slot).display_name} undone.`;
  }

  function showDetectedOutcome(outcome) {
    pendingOutcome = outcome;
    resultSaved = false;
    winnerConfirmActions.hidden = false;
    winnerSavedActions.hidden = true;
    retrySaveButton.hidden = true;
    confirmWinButton.disabled = false;
    undoWinningMarkButton.disabled = false;
    setMessage(winnerSaveMessage, 'Review the score, then confirm the result.');

    if (outcome.type === 'draw') {
      winnerTitle.textContent = 'Game tied';
      winnerDetail.textContent = `Both scorecards are closed at ${cricketState.scores.p1} points.`;
      confirmWinButton.textContent = 'Confirm and save draw';
    } else {
      const winner = playerForSlot(outcome.winner);
      const loserSlot = engine.otherPlayer(outcome.winner);
      winnerTitle.textContent = `${winner.display_name} wins!`;
      winnerDetail.textContent = `${cricketState.scores[outcome.winner]}-${cricketState.scores[loserSlot]}, with every target closed.`;
      confirmWinButton.textContent = 'Confirm and save result';
    }
    renderBoard();
    showDialog(winnerDialog);
  }

  function hitMapsMatch(actual, expected) {
    return engine.segments.every((segment) => Number(actual?.[segment]) === expected[segment]);
  }

  async function fetchOwnedGameStatus(gameId, userId) {
    const result = await service.client
      .from('games')
      .select('status')
      .eq('id', gameId)
      .eq('owner_user_id', userId)
      .maybeSingle();
    return throwIfError(result)?.status || null;
  }

  async function storedResultMatches(snapshot) {
    const [gameResult, resultsResult] = await Promise.all([
      service.client
        .from('games')
        .select('status')
        .eq('id', snapshot.gameId)
        .eq('owner_user_id', snapshot.userId)
        .maybeSingle(),
      service.client
        .from('game_results')
        .select('game_player_id, final_score, is_winner, result_data')
        .eq('game_id', snapshot.gameId)
        .eq('owner_user_id', snapshot.userId),
    ]);
    if (gameResult.error || resultsResult.error || gameResult.data?.status !== 'completed') return false;
    if ((resultsResult.data || []).length !== 2) return false;

    return ['p1', 'p2'].every((slot) => {
      const row = resultsResult.data.find((result) => result.game_player_id === snapshot.playerIds[slot]);
      const expectedWinner = snapshot.outcome.type === 'win' && snapshot.outcome.winner === slot;
      return row
        && row.final_score === snapshot.state.scores[slot]
        && row.is_winner === expectedWinner
        && hitMapsMatch(row.result_data?.hits, snapshot.state.hits[slot]);
    });
  }

  async function completeGame() {
    if (!pendingOutcome || resultSaved) return;
    const version = loadVersion;
    const generation = operationGeneration;
    const snapshot = {
      userId: currentUser.id,
      gameId: currentGame.id,
      roundId: currentGame.round.id,
      playerIds: { p1: currentGame.players.p1.id, p2: currentGame.players.p2.id },
      state: engine.cloneState(cricketState),
      outcome: { ...pendingOutcome },
      eventRows: [...allEventRows.values()].map((row) => ({ ...row, payload: { ...row.payload } })),
    };
    confirmWinButton.disabled = true;
    undoWinningMarkButton.disabled = true;
    retrySaveButton.hidden = true;
    setMessage(winnerSaveMessage, 'Saving the final result...');

    const syncResult = await queueSync(async () => {
      const storedStatus = await fetchOwnedGameStatus(snapshot.gameId, snapshot.userId);
      if (storedStatus === 'in_progress' && snapshot.eventRows.length) {
        throwIfError(await service.client.from('game_events').upsert(snapshot.eventRows));
      }

      const winnerPlayerId = snapshot.outcome.type === 'win'
        ? snapshot.playerIds[snapshot.outcome.winner]
        : null;
      const rpcResult = await service.client.rpc('complete_cricket_game', {
        p_game_id: snapshot.gameId,
        p_round_id: snapshot.roundId,
        p_winner_player_id: winnerPlayerId,
        p_player_one_id: snapshot.playerIds.p1,
        p_player_one_score: snapshot.state.scores.p1,
        p_player_one_hits: snapshot.state.hits.p1,
        p_player_two_id: snapshot.playerIds.p2,
        p_player_two_score: snapshot.state.scores.p2,
        p_player_two_hits: snapshot.state.hits.p2,
      });

      if (rpcResult.error) {
        if (!(await storedResultMatches(snapshot))) throw rpcResult.error;
      }
    });

    if (version !== loadVersion
      || generation !== operationGeneration
      || currentUser?.id !== snapshot.userId
      || currentGame?.id !== snapshot.gameId) return;

    if (!syncResult.ok) {
      setMessage(winnerSaveMessage, syncResult.error?.message || 'The result could not be saved. Your score remains on this page.', 'error');
      retrySaveButton.hidden = false;
      confirmWinButton.disabled = false;
      undoWinningMarkButton.disabled = false;
      return;
    }

    resultSaved = true;
    setSaveStatus('Result saved', 'saved');
    setMessage(winnerSaveMessage, 'The result is safely stored in your game history.', 'success');
    winnerConfirmActions.hidden = true;
    winnerSavedActions.hidden = false;
    retrySaveButton.hidden = true;
    renderBoard();
  }

  async function resumeUnfinishedGame() {
    if (!unfinishedGame || !currentUser || !accountDataReady || resumeInProgress) return;
    const target = unfinishedGame;
    const userId = currentUser.id;
    const version = loadVersion;
    resumeInProgress = true;
    resumeButton.disabled = true;
    discardResumeButton.disabled = true;
    setMessage(setupMessage, 'Restoring the scoreboard...');
    try {
      if (target.rules_version !== 1) throw new Error('This game uses an unsupported Cricket rules version.');
      const players = [...(target.game_players || [])].sort((a, b) => a.player_order - b.player_order);
      const round = (target.game_rounds || []).find((item) => item.status === 'in_progress');
      if (players.length !== 2 || !round) throw new Error('The unfinished game is missing player or round data.');

      const events = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const page = throwIfError(await service.client
          .from('game_events')
          .select('id, game_round_id, game_player_id, sequence_number, event_type, payload, recorded_at, voided_at')
          .eq('game_id', target.id)
          .eq('owner_user_id', userId)
          .order('sequence_number', { ascending: true })
          .range(offset, offset + pageSize - 1));
        events.push(...page);
        if (page.length < pageSize) break;
      }
      if (version !== loadVersion || currentUser?.id !== userId || unfinishedGame?.id !== target.id) return;

      currentGame = {
        ...target,
        round,
        players: { p1: players[0], p2: players[1] },
      };
      resetGameState();
      let replayOutcome = null;

      for (const event of events) {
        nextSequence = Math.max(nextSequence, event.sequence_number + 1);
        const slot = slotForPlayerId(event.game_player_id);
        if (!slot || event.event_type !== 'cricket_mark' || event.game_round_id !== round.id) {
          if (event.voided_at) continue;
          throw new Error('The saved game contains an unsupported scoring event.');
        }

        const row = {
          id: event.id,
          game_id: target.id,
          owner_user_id: userId,
          game_round_id: event.game_round_id,
          game_player_id: event.game_player_id,
          sequence_number: event.sequence_number,
          event_type: event.event_type,
          payload: event.payload,
          recorded_at: event.recorded_at,
          voided_at: event.voided_at,
        };
        allEventRows.set(event.id, row);
        if (event.voided_at) continue;
        if (replayOutcome) throw new Error('The saved game contains scoring after its final result.');

        const before = engine.cloneState(cricketState);
        const replay = engine.applyMark(cricketState, slot, event.payload?.segment);
        if (!replay.applied) throw new Error('The saved Cricket score cannot be replayed safely.');
        cricketState = replay.state;
        actionHistory.push({
          id: event.id,
          sequence: event.sequence_number,
          slot,
          playerId: event.game_player_id,
          segment: String(event.payload.segment),
          before,
          recordedAt: event.recorded_at,
          voidedAt: null,
        });
        replayOutcome = engine.findOutcome(cricketState);
      }

      unfinishedGame = null;
      resumeInProgress = false;
      displayGame();
      if (replayOutcome) showDetectedOutcome(replayOutcome);
    } catch (error) {
      if (version !== loadVersion || currentUser?.id !== userId) return;
      currentGame = null;
      resetGameState();
      console.error('Unable to resume Cricket game', error);
      setMessage(setupMessage, error?.message || 'The unfinished game could not be resumed.', 'error');
      resumeInProgress = false;
      renderResumeCard();
    } finally {
      if (version === loadVersion && currentUser?.id === userId && unfinishedGame?.id === target.id) {
        resumeInProgress = false;
        renderResumeCard();
      }
    }
  }

  function openAbandonDialog(target) {
    if (abandonInProgress) return;
    abandoningTarget = target;
    setMessage(abandonMessage, '');
    confirmAbandonButton.disabled = false;
    cancelAbandonButton.disabled = false;
    showDialog(abandonDialog);
  }

  async function abandonSelectedGame() {
    if (abandonInProgress) return;
    const targetType = abandoningTarget;
    const target = targetType === 'current' ? currentGame : unfinishedGame;
    if (!target || !currentUser || !accountDataReady) return;
    const version = loadVersion;
    const generation = operationGeneration;
    const userId = currentUser.id;
    const eventRows = targetType === 'current'
      ? [...allEventRows.values()].map((row) => ({ ...row, payload: { ...row.payload } }))
      : [];
    const round = target.round || (target.game_rounds || []).find((item) => item.status === 'in_progress');
    abandonInProgress = true;
    confirmAbandonButton.disabled = true;
    cancelAbandonButton.disabled = true;
    setMessage(abandonMessage, 'Saving the abandoned result...');

    const result = await queueSync(async () => {
      const storedStatus = await fetchOwnedGameStatus(target.id, userId);
      if (targetType === 'current' && storedStatus === 'in_progress') {
        if (eventRows.length) throwIfError(await service.client.from('game_events').upsert(eventRows));
      }
      const rpcResult = await service.client.rpc('abandon_cricket_game', {
        p_game_id: target.id,
        p_round_id: round?.id || null,
      });
      if (rpcResult.error) {
        const statusResult = await service.client
          .from('games')
          .select('status')
          .eq('id', target.id)
          .eq('owner_user_id', userId)
          .maybeSingle();
        if (statusResult.error || statusResult.data?.status !== 'abandoned') throw rpcResult.error;
      }
    });

    if (version !== loadVersion
      || generation !== operationGeneration
      || currentUser?.id !== userId) return;

    if (!result.ok) {
      setMessage(abandonMessage, result.error?.message || 'The game could not be abandoned.', 'error');
      abandonInProgress = false;
      confirmAbandonButton.disabled = false;
      cancelAbandonButton.disabled = false;
      return;
    }
    abandonInProgress = false;
    resultSaved = true;
    window.location.reload();
  }

  markButtons.forEach((button) => {
    button.addEventListener('click', () => addMark(button.dataset.player, button.dataset.segment));
  });
  setupForm.addEventListener('submit', startGame);
  opponentType.addEventListener('change', updateOpponentFields);
  undoButton.addEventListener('click', undoLastAction);
  abandonGameButton.addEventListener('click', () => openAbandonDialog('current'));
  resumeButton.addEventListener('click', resumeUnfinishedGame);
  discardResumeButton.addEventListener('click', () => openAbandonDialog('unfinished'));
  confirmWinButton.addEventListener('click', completeGame);
  retrySaveButton.addEventListener('click', completeGame);
  undoWinningMarkButton.addEventListener('click', () => {
    closeDialog(winnerDialog);
    pendingOutcome = null;
    undoLastAction();
  });
  document.getElementById('new-game-button').addEventListener('click', () => window.location.reload());
  cancelAbandonButton.addEventListener('click', () => {
    if (abandonInProgress) return;
    abandoningTarget = null;
    closeDialog(abandonDialog);
  });
  confirmAbandonButton.addEventListener('click', abandonSelectedGame);
  winnerDialog.addEventListener('cancel', (event) => event.preventDefault());
  abandonDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (abandonInProgress) return;
    abandoningTarget = null;
    closeDialog(abandonDialog);
  });
  window.addEventListener('beforeunload', (event) => {
    const hasUnsavedGameData = currentGame && !resultSaved && (pendingSyncCount > 0 || syncHasError);
    if (!startInProgress && !abandonInProgress && !hasUnsavedGameData) return;
    event.preventDefault();
    event.returnValue = '';
  });

  if (!service || !engine) {
    loadingScreen.hidden = true;
    setupScreen.hidden = true;
    gameScreen.hidden = true;
    accountRequired.hidden = false;
    accountRequired.querySelector('h1').textContent = 'Tracked Cricket is unavailable';
    accountRequired.querySelector('p:not(.section-label)').textContent = window.DARTS_SUPABASE_ERROR || 'The game could not be loaded.';
    return;
  }

  service.client.auth.onAuthStateChange((event, session) => {
    const incomingUserId = session?.user?.id || null;
    if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && incomingUserId !== currentUser?.id)) {
      window.setTimeout(() => loadAccountData(session), 0);
    }
  });

  service.client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      return loadAccountData(data.session);
    })
    .catch((error) => {
      console.error('Unable to restore account session', error);
      loadingScreen.hidden = true;
      setupScreen.hidden = true;
      accountRequired.hidden = false;
    });
})();
