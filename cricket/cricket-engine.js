(function exposeCricketEngine(globalScope) {
  const segments = Object.freeze(['20', '19', '18', '17', '16', '15', 'Bull']);

  function emptyHits() {
    return Object.fromEntries(segments.map((segment) => [segment, 0]));
  }

  function createState() {
    return {
      hits: { p1: emptyHits(), p2: emptyHits() },
      scores: { p1: 0, p2: 0 },
    };
  }

  function cloneState(state) {
    return {
      hits: {
        p1: { ...state.hits.p1 },
        p2: { ...state.hits.p2 },
      },
      scores: { ...state.scores },
    };
  }

  function otherPlayer(player) {
    return player === 'p1' ? 'p2' : 'p1';
  }

  function segmentValue(segment) {
    return segment === 'Bull' ? 25 : Number(segment);
  }

  function isValidPlayer(player) {
    return player === 'p1' || player === 'p2';
  }

  function isValidSegment(segment) {
    return segments.includes(String(segment));
  }

  function applyMark(state, player, segment) {
    segment = String(segment);
    if (!isValidPlayer(player) || !isValidSegment(segment)) {
      return { applied: false, state, event: null };
    }

    const opponent = otherPlayer(player);
    const next = cloneState(state);
    let marksAdded = 0;
    let pointsAdded = 0;

    if (next.hits[player][segment] < 3) {
      next.hits[player][segment] += 1;
      marksAdded = 1;
    } else if (next.hits[opponent][segment] < 3) {
      pointsAdded = segmentValue(segment);
      next.scores[player] += pointsAdded;
    } else {
      return { applied: false, state, event: null };
    }

    return {
      applied: true,
      state: next,
      event: {
        segment,
        marks_added: marksAdded,
        points_added: pointsAdded,
        score_after: next.scores[player],
        hit_count_after: next.hits[player][segment],
        input_mode: 'scorecard_mark',
      },
    };
  }

  function applyRecordedEvent(state, player, payload) {
    return applyMark(state, player, payload?.segment).state;
  }

  function hasClosedScorecard(state, player) {
    return segments.every((segment) => state.hits[player][segment] >= 3);
  }

  function findWinner(state) {
    if (hasClosedScorecard(state, 'p1') && state.scores.p1 > state.scores.p2) return 'p1';
    if (hasClosedScorecard(state, 'p2') && state.scores.p2 > state.scores.p1) return 'p2';
    return null;
  }

  function isDraw(state) {
    return hasClosedScorecard(state, 'p1')
      && hasClosedScorecard(state, 'p2')
      && state.scores.p1 === state.scores.p2;
  }

  function findOutcome(state) {
    const winner = findWinner(state);
    if (winner) return { type: 'win', winner };
    if (isDraw(state)) return { type: 'draw', winner: null };
    return null;
  }

  const api = Object.freeze({
    segments,
    createState,
    cloneState,
    applyMark,
    applyRecordedEvent,
    hasClosedScorecard,
    findWinner,
    isDraw,
    findOutcome,
    otherPlayer,
    segmentValue,
  });

  globalScope.CricketEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
