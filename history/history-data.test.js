const assert = require('node:assert/strict');
const historyData = require('./history-data.js');

const userId = '00000000-0000-4000-8000-000000000001';
const accountPlayerId = '00000000-0000-4000-8000-000000000011';
const opponentPlayerId = '00000000-0000-4000-8000-000000000012';

function hitMap(value = 0) {
  return Object.fromEntries(historyData.segments.map((segment) => [segment, value]));
}

function makeGame({
  id,
  status = 'in_progress',
  opponentType = 'saved',
  savedPlayerId = '00000000-0000-4000-8000-000000000099',
  startedAt = '2026-07-01T12:00:00.000Z',
} = {}) {
  return {
    id,
    game_type: 'cricket',
    rules_version: 1,
    status,
    started_at: startedAt,
    completed_at: status === 'completed' ? '2026-07-01T12:15:00.000Z' : null,
    game_players: [
      {
        id: accountPlayerId,
        user_id: userId,
        saved_player_id: null,
        player_type: 'account',
        display_name: 'Account Player',
        player_order: 1,
      },
      {
        id: opponentPlayerId,
        user_id: null,
        saved_player_id: opponentType === 'saved' ? savedPlayerId : null,
        player_type: opponentType,
        display_name: opponentType === 'saved' ? 'Dad' : 'Guest',
        player_order: 2,
      },
    ],
    game_rounds: [{
      id: `${id}-round`,
      status: status === 'completed' ? 'completed' : status,
      round_type: 'leg',
      round_number: 1,
      winner_player_id: null,
      completed_at: status === 'completed' ? '2026-07-01T12:15:00.000Z' : null,
      metadata: status === 'completed' ? { result: null, input_mode: 'scorecard_mark' } : {},
    }],
    game_results: [],
  };
}

function makeEvent(game, sequence, playerId, segment, voidedAt = null) {
  return {
    id: `${game.id}-event-${sequence}`,
    game_id: game.id,
    game_round_id: game.game_rounds[0].id,
    game_player_id: playerId,
    sequence_number: sequence,
    event_type: 'cricket_mark',
    payload: { segment, input_mode: 'scorecard_mark' },
    recorded_at: new Date(Date.parse(game.started_at) + sequence * 1000).toISOString(),
    voided_at: voidedAt,
  };
}

function closePlayer(game, playerId, events, nextSequence) {
  let sequence = nextSequence;
  for (const segment of historyData.segments) {
    for (let mark = 0; mark < 3; mark += 1) {
      events.push(makeEvent(game, sequence, playerId, segment));
      sequence += 1;
    }
  }
  return sequence;
}

function completeWinGame({ id, winner = 'account', opponentType = 'saved', startedAt } = {}) {
  const game = makeGame({ id, status: 'completed', opponentType, startedAt });
  const events = [];
  const winnerId = winner === 'account' ? accountPlayerId : opponentPlayerId;
  let sequence = closePlayer(game, winnerId, events, 1);
  events.push(makeEvent(game, sequence, winnerId, '20'));
  const accountWon = winner === 'account';
  const accountHits = accountWon ? hitMap(3) : hitMap(0);
  const opponentHits = accountWon ? hitMap(0) : hitMap(3);
  game.game_results = [
    {
      game_player_id: accountPlayerId,
      finishing_position: accountWon ? 1 : 2,
      final_score: accountWon ? 20 : 0,
      is_winner: accountWon,
      result_data: { outcome: accountWon ? 'win' : 'loss', hits: accountHits, input_mode: 'scorecard_mark', rules_version: 1 },
    },
    {
      game_player_id: opponentPlayerId,
      finishing_position: accountWon ? 2 : 1,
      final_score: accountWon ? 0 : 20,
      is_winner: !accountWon,
      result_data: { outcome: accountWon ? 'loss' : 'win', hits: opponentHits, input_mode: 'scorecard_mark', rules_version: 1 },
    },
  ];
  game.game_rounds[0].winner_player_id = winnerId;
  game.game_rounds[0].metadata.result = 'win';
  return { game, events };
}

function completeDrawGame({ id, opponentType = 'guest', startedAt } = {}) {
  const game = makeGame({ id, status: 'completed', opponentType, startedAt });
  const events = [];
  let sequence = closePlayer(game, accountPlayerId, events, 1);
  closePlayer(game, opponentPlayerId, events, sequence);
  game.game_results = [accountPlayerId, opponentPlayerId].map((playerId) => ({
    game_player_id: playerId,
    finishing_position: null,
    final_score: 0,
    is_winner: false,
    result_data: { outcome: 'draw', hits: hitMap(3), input_mode: 'scorecard_mark', rules_version: 1 },
  }));
  game.game_rounds[0].metadata.result = 'draw';
  return { game, events };
}

{
  const { game, events } = completeWinGame({ id: 'game-win' });
  const replay = historyData.replayCricketGame(game, [...events].reverse());
  assert.equal(replay.replayComplete, true);
  assert.deepEqual(replay.outcome, { type: 'win', winner: 'p1' });
  assert.equal(replay.state.scores.p1, 20);
  assert.equal(replay.timeline.length, 22);
  assert.equal(replay.targetStatsByPlayer.get(accountPlayerId)['20'].marks, 4);
  assert.equal(replay.targetStatsByPlayer.get(accountPlayerId)['20'].scoringMarks, 1);
  assert.equal(replay.targetStatsByPlayer.get(accountPlayerId)['20'].points, 20);
}

{
  const game = makeGame({ id: 'game-voided' });
  const events = [];
  let sequence = closePlayer(game, accountPlayerId, events, 1);
  events.push(makeEvent(game, sequence, accountPlayerId, '20', '2026-07-01T12:10:00.000Z'));
  sequence += 1;
  events.push(makeEvent(game, sequence, accountPlayerId, '20'));
  const replay = historyData.replayCricketGame(game, events);
  assert.equal(replay.timeline.filter((event) => event.status === 'voided').length, 1);
  assert.equal(replay.state.scores.p1, 20);
  assert.equal(replay.targetStatsByPlayer.get(accountPlayerId)['20'].marks, 4);
}

{
  const { game, events } = completeWinGame({ id: 'game-after-outcome' });
  events.push(makeEvent(game, events.length + 1, opponentPlayerId, '20'));
  const replay = historyData.replayCricketGame(game, events);
  assert.equal(replay.replayComplete, false);
  assert.equal(replay.issues.some((item) => item.code === 'event_after_outcome'), true);
}

{
  const game = makeGame({ id: 'game-frozen-replay' });
  const events = [
    makeEvent(game, 1, accountPlayerId, '20'),
    makeEvent(game, 2, accountPlayerId, '14'),
    makeEvent(game, 3, accountPlayerId, '20'),
  ];
  const replay = historyData.replayCricketGame(game, events);
  assert.equal(replay.replayComplete, false);
  assert.equal(replay.state.hits.p1['20'], 1, 'state must freeze after the first fatal event');
  assert.equal(replay.timeline[1].status, 'invalid');
  assert.equal(replay.timeline[2].status, 'unverified');
}

{
  const game = makeGame({ id: 'game-first-gap' });
  const replay = historyData.replayCricketGame(game, [makeEvent(game, 2, accountPlayerId, '20')]);
  assert.equal(replay.issues.some((item) => item.code === 'sequence_gap'), true);
}

{
  const win = completeWinGame({ id: 'stats-win', startedAt: '2026-07-03T12:00:00.000Z' });
  const loss = completeWinGame({ id: 'stats-loss', winner: 'opponent', startedAt: '2026-07-02T12:00:00.000Z' });
  const draw = completeDrawGame({ id: 'stats-draw', startedAt: '2026-07-01T12:00:00.000Z' });
  const abandoned = makeGame({ id: 'stats-abandoned', status: 'abandoned' });
  const stats = historyData.calculateHistoryStats(
    [win.game, loss.game, draw.game, abandoned],
    [...win.events, ...loss.events, ...draw.events],
    userId,
  );
  assert.equal(stats.totals.played, 3);
  assert.equal(stats.totals.wins, 1);
  assert.equal(stats.totals.losses, 1);
  assert.equal(stats.totals.draws, 1);
  assert.equal(stats.totals.abandoned, 1);
  assert.equal(Math.round(stats.totals.winRate), 33);
  assert.equal(Math.round(stats.totals.averageFinalPoints * 100) / 100, 6.67);
  assert.equal(stats.opponentStats.length, 2);
  const savedOpponent = stats.opponentStats.find((opponent) => opponent.savedPlayerId);
  assert.equal(savedOpponent?.games, 2);
  assert.equal(savedOpponent?.wins, 1);
  assert.equal(savedOpponent?.losses, 1);
  assert.equal(savedOpponent?.opponentWins, 1);
  assert.equal(savedOpponent?.opponentLosses, 1);
  assert.equal(savedOpponent?.opponentDraws, 0);
  assert.equal(savedOpponent?.opponentWinRate, 50);
  assert.equal(savedOpponent?.opponentAverageFinalPoints, 10);
  assert.equal(savedOpponent?.opponentHighestFinalPoints, 20);
  assert.equal(savedOpponent?.targetStats['20'].marks, 4);
  assert.equal(savedOpponent?.targetStats['20'].closingMarks, 3);
  assert.equal(savedOpponent?.targetStats['20'].scoringMarks, 1);
  assert.equal(savedOpponent?.targetStats['20'].points, 20);
  assert.equal(savedOpponent?.targetStats['19'].marks, 3);
  assert.equal(savedOpponent?.targetStats['19'].points, 0);
  const guestOpponent = stats.opponentStats.find((opponent) => !opponent.savedPlayerId);
  assert.equal(guestOpponent?.displayName, 'One-time guests');
  assert.equal(guestOpponent?.opponentWins, 0);
  assert.equal(guestOpponent?.opponentLosses, 0);
  assert.equal(guestOpponent?.opponentDraws, 1);
  assert.equal(guestOpponent?.targetStats['20'].marks, 3);
  assert.equal(stats.targetStats['20'].marks, 7);
  assert.equal(stats.targetStats['20'].points, 20);
  assert.equal(stats.skippedTargetGames, 0);
}

{
  const draw = completeDrawGame({ id: 'guest-stats-draw', startedAt: '2026-07-05T12:00:00.000Z' });
  draw.game.game_players[1].display_name = 'Alice';
  const win = completeWinGame({
    id: 'guest-stats-win',
    winner: 'opponent',
    opponentType: 'guest',
    startedAt: '2026-07-06T12:00:00.000Z',
  });
  win.game.game_players[1].display_name = 'Bob';
  const stats = historyData.calculateHistoryStats(
    [draw.game, win.game],
    [...draw.events, ...win.events],
    userId,
  );
  assert.equal(stats.opponentStats.length, 1, 'one-time guests must remain a combined group');
  const guests = stats.opponentStats[0];
  assert.equal(guests.key, 'one-time-guests');
  assert.equal(guests.games, 2);
  assert.equal(guests.opponentWins, 1);
  assert.equal(guests.opponentLosses, 0);
  assert.equal(guests.opponentDraws, 1);
  assert.equal(guests.opponentWinRate, 50);
  assert.equal(guests.opponentAverageFinalPoints, 10);
  assert.equal(guests.opponentHighestFinalPoints, 20);
  assert.equal(guests.targetStats['20'].marks, 7);
  assert.equal(guests.targetStats['20'].points, 20);
}

{
  const corrupted = completeWinGame({ id: 'stats-corrupted' });
  corrupted.events.push(makeEvent(corrupted.game, corrupted.events.length + 1, opponentPlayerId, '20'));
  const futureActive = { ...makeGame({ id: 'future-active' }), game_type: '501' };
  const futureAbandoned = { ...makeGame({ id: 'future-abandoned', status: 'abandoned' }), game_type: '501' };
  const stats = historyData.calculateHistoryStats(
    [corrupted.game, futureActive, futureAbandoned],
    corrupted.events,
    userId,
  );
  assert.equal(stats.totals.played, 0, 'a replay-corrupt completed game must not enter any aggregate');
  assert.equal(stats.totals.active, 0, 'future game types must not enter Cricket lifecycle totals');
  assert.equal(stats.totals.abandoned, 0);
  assert.equal(stats.skippedTargetGames, 1);
  assert.equal(stats.opponentStats.length, 0, 'corrupt games must not enter opponent aggregates');
}

{
  const { game, events } = completeWinGame({ id: 'game-contradictory-result' });
  game.game_results[0].is_winner = false;
  const summary = historyData.summariseGame(game, userId);
  assert.equal(summary.outcome, 'unknown');
  assert.equal(summary.isValidCompleted, false);
  const stats = historyData.calculateHistoryStats([game], events, userId);
  assert.equal(stats.totals.played, 0);
  assert.equal(stats.skippedTargetGames, 1, 'malformed completed games must be reported as excluded');
}

{
  const game = makeGame({ id: 'game-account-second' });
  game.game_players[0].player_order = 2;
  game.game_players[1].player_order = 1;
  const summary = historyData.summariseGame(game, userId);
  assert.equal(summary.accountPlayer.id, accountPlayerId);
  assert.equal(summary.opponent.id, opponentPlayerId);
}

{
  const game = makeGame({ id: 'game-incomplete-result', status: 'completed' });
  const summary = historyData.summariseGame(game, userId);
  assert.equal(summary.outcome, 'unknown');
  assert.equal(summary.isValidCompleted, false);
}

console.log('History data tests passed');
