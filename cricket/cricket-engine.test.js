const assert = require('node:assert/strict');
const engine = require('./cricket-engine.js');

function closeAllTargets(state, player) {
  for (const segment of engine.segments) state.hits[player][segment] = 3;
}

{
  let state = engine.createState();
  const first = engine.applyMark(state, 'p1', '20');
  assert.equal(first.applied, true);
  assert.equal(first.state.hits.p1['20'], 1);
  assert.equal(state.hits.p1['20'], 0, 'applyMark must not mutate its input');
}

{
  let state = engine.createState();
  for (let mark = 1; mark <= 3; mark += 1) {
    const result = engine.applyMark(state, 'p1', '20');
    assert.equal(result.applied, true);
    state = result.state;
    assert.equal(state.hits.p1['20'], mark);
    assert.equal(state.scores.p1, 0);
  }
}

{
  let state = engine.createState();
  state.hits.p1['20'] = 3;
  const scoring = engine.applyMark(state, 'p1', '20');
  assert.equal(scoring.state.hits.p1['20'], 3);
  assert.equal(scoring.state.scores.p1, 20);
  assert.equal(scoring.event.points_added, 20);
}

{
  let state = engine.createState();
  state.hits.p1.Bull = 3;
  const scoring = engine.applyMark(state, 'p1', 'Bull');
  assert.equal(scoring.state.scores.p1, 25);
  assert.equal(scoring.state.hits.p1.Bull, 3);
}

{
  let state = engine.createState();
  state.hits.p1['20'] = 3;
  state.hits.p2['20'] = 3;
  const ignored = engine.applyMark(state, 'p1', '20');
  assert.equal(ignored.applied, false, 'a target closed by both players must ignore further taps');
  assert.deepEqual(ignored.state, state);
}

{
  let state = engine.createState();
  state.hits.p1['19'] = 3;
  state = engine.applyMark(state, 'p1', '19').state;
  assert.equal(state.scores.p1, 19);
  state = engine.applyMark(state, 'p2', '19').state;
  state = engine.applyMark(state, 'p2', '19').state;
  state = engine.applyMark(state, 'p2', '19').state;
  assert.equal(state.hits.p2['19'], 3);
  assert.equal(state.scores.p1, 19, 'closing later must not remove previously earned points');
}

{
  const state = engine.createState();
  assert.equal(engine.applyMark(state, 'p1', '14').applied, false);
  assert.equal(engine.applyMark(state, 'p3', '20').applied, false);
}

{
  const state = engine.createState();
  closeAllTargets(state, 'p1');
  assert.equal(engine.findWinner(state), null, 'closing at a tied score is not a win');
  assert.equal(engine.isDraw(state), false, 'only one closed scorecard is not a draw');
  state.scores.p1 = 1;
  assert.equal(engine.findWinner(state), 'p1');
}

{
  const state = engine.createState();
  closeAllTargets(state, 'p1');
  state.scores.p1 = 40;
  state.scores.p2 = 60;
  assert.equal(engine.findWinner(state), null, 'a closed player who is behind has not won');
  const scoringState = engine.applyMark(state, 'p1', '20').state;
  assert.equal(scoringState.scores.p1, 60);
  assert.equal(engine.findWinner(scoringState), null, 'equal scores are not a win');
  const winningState = engine.applyMark(scoringState, 'p1', '20').state;
  assert.equal(engine.findWinner(winningState), 'p1');
}

{
  const state = engine.createState();
  closeAllTargets(state, 'p1');
  closeAllTargets(state, 'p2');
  assert.equal(engine.findWinner(state), null);
  assert.deepEqual(engine.findOutcome(state), { type: 'draw', winner: null });
}

console.log('Cricket engine tests passed');
