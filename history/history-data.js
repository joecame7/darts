(function exposeHistoryData(globalScope) {
  const engine = globalScope.CricketEngine
    || (typeof module !== 'undefined' && module.exports
      ? require('../cricket/cricket-engine.js')
      : null);

  const outcomes = new Set(['win', 'loss', 'draw']);
  const segments = engine?.segments || ['20', '19', '18', '17', '16', '15', 'Bull'];

  function orderedPlayers(game) {
    return [...(game?.game_players || [])]
      .sort((left, right) => left.player_order - right.player_order);
  }

  function resultForPlayer(game, playerId) {
    return (game?.game_results || []).find((result) => result.game_player_id === playerId) || null;
  }

  function accountPlayerForGame(game, userId) {
    return orderedPlayers(game).find((player) => (
      player.player_type === 'account' && player.user_id === userId
    )) || null;
  }

  function normaliseCompletedOutcome(game, accountPlayer) {
    const results = game?.game_results || [];
    const ownResult = accountPlayer ? resultForPlayer(game, accountPlayer.id) : null;
    if (results.length !== 2 || !ownResult) return 'unknown';
    const opponentResult = results.find((result) => result.game_player_id !== accountPlayer.id);
    if (!opponentResult) return 'unknown';

    let derivedOutcome = 'unknown';
    if (ownResult.is_winner === true && opponentResult.is_winner === false) derivedOutcome = 'win';
    else if (ownResult.is_winner === false && opponentResult.is_winner === true) derivedOutcome = 'loss';
    else if (ownResult.is_winner === false && opponentResult.is_winner === false) derivedOutcome = 'draw';

    const storedOutcome = ownResult.result_data?.outcome;
    const expectedOpponentOutcome = derivedOutcome === 'win'
      ? 'loss'
      : (derivedOutcome === 'loss' ? 'win' : derivedOutcome);
    if (!outcomes.has(derivedOutcome)
      || !outcomes.has(storedOutcome)
      || storedOutcome !== derivedOutcome
      || opponentResult.result_data?.outcome !== expectedOpponentOutcome) return 'unknown';
    return derivedOutcome;
  }

  function summariseGame(game, userId) {
    const players = orderedPlayers(game);
    const accountPlayer = accountPlayerForGame(game, userId);
    const opponent = players.length === 2
      ? players.find((player) => player.id !== accountPlayer?.id) || null
      : null;
    const ownResult = accountPlayer ? resultForPlayer(game, accountPlayer.id) : null;
    const opponentResult = opponent ? resultForPlayer(game, opponent.id) : null;
    const completedOutcome = game?.status === 'completed'
      ? normaliseCompletedOutcome(game, accountPlayer)
      : game?.status || 'unknown';
    const isCricketV1 = game?.game_type === 'cricket' && game?.rules_version === 1;
    const isSupportedCricket = isCricketV1
      && players.length === 2
      && Boolean(accountPlayer)
      && Boolean(opponent);
    const hasCompleteResults = (game?.game_results || []).length === 2
      && Number.isInteger(ownResult?.final_score)
      && Number.isInteger(opponentResult?.final_score);

    return {
      game,
      players,
      accountPlayer,
      opponent,
      ownResult,
      opponentResult,
      outcome: completedOutcome,
      isCricketV1,
      isSupportedCricket,
      isValidCompleted: game?.status === 'completed'
        && isSupportedCricket
        && hasCompleteResults
        && outcomes.has(completedOutcome),
    };
  }

  function emptyTargetStats() {
    return Object.fromEntries(segments.map((segment) => [segment, {
      segment,
      marks: 0,
      closingMarks: 0,
      scoringMarks: 0,
      points: 0,
    }]));
  }

  function addTargetStats(target, source) {
    if (!source) return;
    for (const segment of segments) {
      target[segment].marks += source[segment]?.marks || 0;
      target[segment].closingMarks += source[segment]?.closingMarks || 0;
      target[segment].scoringMarks += source[segment]?.scoringMarks || 0;
      target[segment].points += source[segment]?.points || 0;
    }
  }

  function issue(code, message, fatal = false) {
    return { code, message, fatal };
  }

  function hitMapsMatch(actual, expected) {
    return actual
      && Object.keys(actual).length === segments.length
      && segments.every((segment) => (
      Number.isInteger(actual?.[segment]) && actual[segment] === expected[segment]
      ));
  }

  function replayCricketGame(game, inputEvents = []) {
    if (!engine) throw new Error('CricketEngine is required to replay Cricket history.');

    const issues = [];
    const players = orderedPlayers(game);
    const rounds = [...(game?.game_rounds || [])];
    const state = engine.createState();
    const timeline = [];
    const targetStatsByPlayer = new Map();
    const seenSequences = new Set();
    let replayState = state;
    let outcome = null;
    let streamBlocked = false;

    if (game?.game_type !== 'cricket' || game?.rules_version !== 1) {
      issues.push(issue('unsupported_rules', 'This game uses an unsupported Cricket rules version.', true));
    }
    if (players.length !== 2
      || players[0]?.player_order !== 1
      || players[1]?.player_order !== 2) {
      issues.push(issue('invalid_player_shape', 'The game does not contain exactly two ordered players.', true));
    }

    const round = rounds.length === 1
      && rounds[0].round_type === 'leg'
      && rounds[0].round_number === 1
      ? rounds[0]
      : null;
    if (!round) {
      issues.push(issue('invalid_round_shape', 'The game does not contain its expected Cricket leg.', true));
    }
    streamBlocked = issues.some((item) => item.fatal);

    const slotByPlayerId = new Map(players.map((player, index) => [player.id, index === 0 ? 'p1' : 'p2']));
    for (const player of players) targetStatsByPlayer.set(player.id, emptyTargetStats());

    const events = [...inputEvents].sort((left, right) => left.sequence_number - right.sequence_number);
    let previousSequence = 0;
    for (const event of events) {
      const sequence = Number(event.sequence_number);
      const segment = event.payload?.segment;
      const slot = slotByPlayerId.get(event.game_player_id) || null;
      const player = players.find((candidate) => candidate.id === event.game_player_id) || null;
      const timelineItem = {
        id: event.id,
        sequence,
        recordedAt: event.recorded_at,
        voidedAt: event.voided_at,
        player,
        playerId: event.game_player_id,
        slot,
        segment,
        status: event.voided_at ? 'voided' : 'active',
        marksAdded: 0,
        pointsAdded: 0,
        scoreAfter: slot ? replayState.scores[slot] : null,
        hitCountAfter: slot && segments.includes(String(segment))
          ? replayState.hits[slot][String(segment)]
          : null,
        scoresAfter: { ...replayState.scores },
        outcomeAfter: null,
      };

      if (!Number.isInteger(sequence) || sequence <= 0 || seenSequences.has(sequence)) {
        issues.push(issue('duplicate_or_invalid_sequence', 'The event stream contains an invalid or duplicate sequence number.', true));
        timelineItem.status = 'invalid';
        streamBlocked = true;
        timeline.push(timelineItem);
        continue;
      }
      seenSequences.add(sequence);
      if (sequence !== previousSequence + 1) {
        issues.push(issue('sequence_gap', 'The event stream contains a sequence gap.', false));
      }
      previousSequence = sequence;

      if (event.voided_at) {
        timeline.push(timelineItem);
        continue;
      }
      if (streamBlocked) {
        timelineItem.status = 'unverified';
        timeline.push(timelineItem);
        continue;
      }
      if (outcome) {
        issues.push(issue('event_after_outcome', 'The event stream continues after a final result was reached.', true));
        timelineItem.status = 'invalid';
        streamBlocked = true;
        timeline.push(timelineItem);
        continue;
      }
      if (event.event_type !== 'cricket_mark'
        || event.game_id !== game?.id
        || event.game_round_id !== round?.id
        || !slot
        || !segments.includes(String(segment))
        || event.payload?.input_mode !== 'scorecard_mark') {
        issues.push(issue('invalid_active_event', 'An active scoring event has invalid Cricket data.', true));
        timelineItem.status = 'invalid';
        streamBlocked = true;
        timeline.push(timelineItem);
        continue;
      }

      const applied = engine.applyMark(replayState, slot, String(segment));
      if (!applied.applied) {
        issues.push(issue('rejected_mark', 'An active mark targets a number already closed by both players.', true));
        timelineItem.status = 'invalid';
        streamBlocked = true;
        timeline.push(timelineItem);
        continue;
      }

      replayState = applied.state;
      timelineItem.marksAdded = applied.event.marks_added;
      timelineItem.pointsAdded = applied.event.points_added;
      timelineItem.scoreAfter = applied.event.score_after;
      timelineItem.hitCountAfter = applied.event.hit_count_after;
      timelineItem.scoresAfter = { ...replayState.scores };
      outcome = engine.findOutcome(replayState);
      timelineItem.outcomeAfter = outcome;
      timeline.push(timelineItem);

      const target = targetStatsByPlayer.get(event.game_player_id)?.[String(segment)];
      if (target) {
        target.marks += 1;
        target.closingMarks += applied.event.marks_added;
        target.scoringMarks += applied.event.points_added > 0 ? 1 : 0;
        target.points += applied.event.points_added;
      }
    }

    const results = game?.game_results || [];
    if (game?.status === 'completed') {
      if (!outcome) issues.push(issue('missing_replayed_outcome', 'The completed game has no replayable final outcome.', true));
      if (results.length !== 2) {
        issues.push(issue('invalid_result_count', 'The completed game does not have exactly two results.', true));
      }

      for (const [index, player] of players.entries()) {
        const slot = index === 0 ? 'p1' : 'p2';
        const result = resultForPlayer(game, player.id);
        const expectedWinner = outcome?.type === 'win' && outcome.winner === slot;
        const expectedOutcome = outcome?.type === 'draw'
          ? 'draw'
          : (expectedWinner ? 'win' : 'loss');
        const expectedPosition = outcome?.type === 'draw' ? null : (expectedWinner ? 1 : 2);
        if (!result
          || result.final_score !== replayState.scores[slot]
          || result.is_winner !== expectedWinner
          || result.finishing_position !== expectedPosition
          || !hitMapsMatch(result.result_data?.hits, replayState.hits[slot])
          || result.result_data?.outcome !== expectedOutcome
          || result.result_data?.input_mode !== 'scorecard_mark'
          || result.result_data?.rules_version !== 1) {
          issues.push(issue('result_mismatch', `The stored result for ${player.display_name || 'a player'} does not match the event replay.`, true));
        }
      }

      const expectedWinnerId = outcome?.type === 'win'
        ? players[outcome.winner === 'p1' ? 0 : 1]?.id
        : null;
      if (!round
        || round.status !== 'completed'
        || round.winner_player_id !== expectedWinnerId
        || round.metadata?.result !== outcome?.type
        || round.metadata?.input_mode !== 'scorecard_mark'
        || !round.completed_at
        || !game.completed_at
        || round.completed_at !== game.completed_at) {
        issues.push(issue('round_result_mismatch', 'The saved round does not match the replayed result.', true));
      }
    } else if (game?.status === 'in_progress') {
      if ((game.game_results || []).length > 0
        || game.completed_at
        || (round && (
          round.status !== 'in_progress'
          || round.winner_player_id !== null
          || round.completed_at
        ))) {
        issues.push(issue('round_status_mismatch', 'The active game does not have an active round.', true));
      }
    } else if (game?.status === 'abandoned') {
      if (results.length > 0) issues.push(issue('abandoned_game_has_results', 'The abandoned game unexpectedly contains final results.', false));
      if (outcome) issues.push(issue('abandoned_game_has_outcome', 'The abandoned game reached an outcome before it was abandoned.', false));
      if (game.completed_at
        || (round && (
          round.status !== 'abandoned'
          || round.winner_player_id !== null
          || round.completed_at
        ))) {
        issues.push(issue('round_status_mismatch', 'The abandoned game still has a non-abandoned round.', true));
      }
    }

    return {
      state: replayState,
      outcome,
      timeline,
      issues,
      replayComplete: !issues.some((item) => item.fatal),
      players,
      round,
      targetStatsByPlayer,
    };
  }

  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function calculateHistoryStats(games, events, userId) {
    const summaries = games.map((game) => summariseGame(game, userId));
    const completedCandidates = summaries.filter((summary) => summary.isValidCompleted);
    const eventsByGame = new Map();
    for (const event of events) {
      if (!eventsByGame.has(event.game_id)) eventsByGame.set(event.game_id, []);
      eventsByGame.get(event.game_id).push(event);
    }
    const replayByGame = new Map();
    const completed = completedCandidates.filter((summary) => {
      const replay = replayCricketGame(summary.game, eventsByGame.get(summary.game.id) || []);
      replayByGame.set(summary.game.id, replay);
      return replay.replayComplete;
    });
    const supportedGames = games.filter((game) => game.game_type === 'cricket' && game.rules_version === 1);
    const totals = {
      played: completed.length,
      wins: completed.filter((summary) => summary.outcome === 'win').length,
      losses: completed.filter((summary) => summary.outcome === 'loss').length,
      draws: completed.filter((summary) => summary.outcome === 'draw').length,
      active: supportedGames.filter((game) => game.status === 'in_progress').length,
      abandoned: supportedGames.filter((game) => game.status === 'abandoned').length,
      averageFinalPoints: average(completed.map((summary) => summary.ownResult.final_score)),
      highestFinalPoints: completed.length
        ? Math.max(...completed.map((summary) => summary.ownResult.final_score))
        : 0,
    };
    totals.winRate = totals.played ? (totals.wins / totals.played) * 100 : 0;

    const opponents = new Map();
    for (const summary of completed) {
      const savedId = summary.opponent.saved_player_id;
      const accountOpponentId = summary.opponent.player_type === 'account' ? summary.opponent.user_id : null;
      const key = savedId
        ? `saved:${savedId}`
        : (accountOpponentId ? `account:${accountOpponentId}` : 'one-time-guests');
      const existing = opponents.get(key) || {
        key,
        savedPlayerId: savedId || null,
        displayName: savedId || accountOpponentId ? summary.opponent.display_name : 'One-time guests',
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        opponentWins: 0,
        opponentLosses: 0,
        opponentDraws: 0,
        opponentFinalPointsTotal: 0,
        opponentHighestFinalPoints: 0,
        targetStats: emptyTargetStats(),
        lastPlayedAt: summary.game.started_at,
      };
      existing.games += 1;
      if (summary.outcome === 'win') {
        existing.wins += 1;
        existing.opponentLosses += 1;
      } else if (summary.outcome === 'loss') {
        existing.losses += 1;
        existing.opponentWins += 1;
      } else {
        existing.draws += 1;
        existing.opponentDraws += 1;
      }
      existing.opponentFinalPointsTotal += summary.opponentResult.final_score;
      existing.opponentHighestFinalPoints = Math.max(
        existing.opponentHighestFinalPoints,
        summary.opponentResult.final_score,
      );
      const replay = replayByGame.get(summary.game.id);
      addTargetStats(
        existing.targetStats,
        replay?.targetStatsByPlayer.get(summary.opponent.id),
      );
      if (new Date(summary.game.started_at) > new Date(existing.lastPlayedAt)) {
        existing.lastPlayedAt = summary.game.started_at;
        if (savedId || accountOpponentId) existing.displayName = summary.opponent.display_name;
      }
      opponents.set(key, existing);
    }
    const opponentStats = [...opponents.values()]
      .map((opponent) => {
        const { opponentFinalPointsTotal, ...publicStats } = opponent;
        return {
          ...publicStats,
          winRate: opponent.games ? (opponent.wins / opponent.games) * 100 : 0,
          opponentWinRate: opponent.games ? (opponent.opponentWins / opponent.games) * 100 : 0,
          opponentAverageFinalPoints: opponent.games
            ? opponentFinalPointsTotal / opponent.games
            : 0,
        };
      })
      .sort((left, right) => right.games - left.games
        || new Date(right.lastPlayedAt) - new Date(left.lastPlayedAt)
        || left.displayName.localeCompare(right.displayName)
        || left.key.localeCompare(right.key));

    const targetStats = emptyTargetStats();
    for (const summary of completed) {
      const replay = replayByGame.get(summary.game.id);
      const playerStats = replay.targetStatsByPlayer.get(summary.accountPlayer.id);
      addTargetStats(targetStats, playerStats);
    }

    return {
      summaries,
      completed,
      verifiedGameIds: new Set(completed.map((summary) => summary.game.id)),
      totals,
      opponentStats,
      targetStats,
      skippedTargetGames: summaries.filter((summary) => (
        summary.game.status === 'completed' && summary.isCricketV1
      )).length - completed.length,
    };
  }

  const api = Object.freeze({
    segments,
    orderedPlayers,
    resultForPlayer,
    accountPlayerForGame,
    summariseGame,
    replayCricketGame,
    calculateHistoryStats,
  });

  globalScope.HistoryData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
