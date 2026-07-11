const assetBase = document.body.dataset.assetBase || '';
const images = ['tally1.png', 'tally2.png', 'tally3.png'].map((image) => `${assetBase}${image}`);

const hits = {
  p1: { 20: 0, 19: 0, 18: 0, 17: 0, 16: 0, 15: 0, Bull: 0 },
  p2: { 20: 0, 19: 0, 18: 0, 17: 0, 16: 0, 15: 0, Bull: 0 },
};
const actionHistory = [];
const p1ScoreElem = document.getElementById('p1-score');
const p2ScoreElem = document.getElementById('p2-score');

document.querySelectorAll('td:nth-child(1), td:nth-child(3)').forEach((cell) => {
  cell.addEventListener('click', () => {
    const player = cell.cellIndex === 0 ? 'p1' : 'p2';
    const segment = cell.parentElement.children[1].innerText;
    if (!Object.prototype.hasOwnProperty.call(hits[player], segment)) return;

    actionHistory.push({
      player,
      segment,
      prevHits: { ...hits[player] },
      prevScore: Number(player === 'p1' ? p1ScoreElem.innerText : p2ScoreElem.innerText),
      cell,
    });

    const img = cell.querySelector('img');
    const currentImage = img ? img.src.split('/').pop() : '';
    const currentIndex = currentImage ? images.findIndex((image) => image.endsWith(currentImage)) : -1;
    const nextIndex = currentIndex < images.length - 1 ? currentIndex + 1 : currentIndex;

    if (nextIndex < 3) {
      hits[player][segment]++;
      if (!img) {
        const newImg = document.createElement('img');
        newImg.src = images[nextIndex];
        cell.appendChild(newImg);
      } else {
        img.src = images[nextIndex];
      }
    }
    updateScores(segment);
  });
});

document.getElementById('undo-btn').addEventListener('click', () => {
  const lastAction = actionHistory.pop();
  if (!lastAction) return;
  const { player, segment, prevHits, prevScore, cell } = lastAction;
  hits[player] = { ...prevHits };
  (player === 'p1' ? p1ScoreElem : p2ScoreElem).innerText = prevScore;
  const img = cell.querySelector('img');
  const prevIndex = prevHits[segment] - 1;
  if (prevIndex < 0) {
    if (img) cell.removeChild(img);
  } else if (!img) {
    const newImg = document.createElement('img');
    newImg.src = images[prevIndex];
    cell.appendChild(newImg);
  } else {
    img.src = images[prevIndex];
  }
});

function updateScores(segment) {
  const p1Hits = hits.p1[segment];
  const p2Hits = hits.p2[segment];
  if (p1Hits > 3 && p2Hits < 3) {
    p1ScoreElem.innerText = Number(p1ScoreElem.innerText) + (p1Hits - 3) * (segment === 'Bull' ? 25 : Number(segment));
    hits.p1[segment] = 3;
  }
  if (p2Hits > 3 && p1Hits < 3) {
    p2ScoreElem.innerText = Number(p2ScoreElem.innerText) + (p2Hits - 3) * (segment === 'Bull' ? 25 : Number(segment));
    hits.p2[segment] = 3;
  }
}

document.addEventListener('touchstart', (event) => {
  if (event.touches.length > 1) event.preventDefault();
}, { passive: false });
document.addEventListener('dblclick', (event) => event.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (event) => event.preventDefault());
