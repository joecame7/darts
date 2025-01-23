// Path to images
const images = ['tally1.png', 'tally2.png', 'tally3.png'];

// Player hit counts for each segment (20, 19, ..., Bull)
const hits = {
    p1: { 20: 0, 19: 0, 18: 0, 17: 0, 16: 0, 15: 0, Bull: 0 },
    p2: { 20: 0, 19: 0, 18: 0, 17: 0, 16: 0, 15: 0, Bull: 0 },
};

// Array to keep track of the action history
const actionHistory = [];
  
// Reference to player scores in the DOM
const p1ScoreElem = document.getElementById('p1-score');
const p2ScoreElem = document.getElementById('p2-score');

// Add event listeners to the first and third columns
document.querySelectorAll('td:nth-child(1), td:nth-child(3)').forEach((cell) => {
    cell.addEventListener('click', () => {
        const player = cell.cellIndex === 0 ? 'p1' : 'p2'; // Determine player
        const segment = cell.parentElement.children[1].innerText; // Determine segment (20, 19, ...)
  
        // Prevent invalid segments
        if (!hits[player].hasOwnProperty(segment)) return;

        // Save the current state to the action history
        const currentHits = { ...hits[player] };
        const currentScore = player === 'p1' ? parseInt(p1ScoreElem.innerText) : parseInt(p2ScoreElem.innerText);

        actionHistory.push({
            player,
            segment,
            prevHits: currentHits,
            prevScore: currentScore,
            cell,
        });
  
        // Update the hit count
        const img = cell.querySelector('img');
        const currentIndex = img ? images.indexOf(img.src.split('/').pop()) : -1;
        const nextIndex = currentIndex < images.length - 1 ? currentIndex + 1 : currentIndex;

        if (nextIndex < 3) {
            hits[player][segment]++;
            if (!img) {
                const newImg = document.createElement('img');
                newImg.src = images[nextIndex];
                newImg.style.width = '50px';
                newImg.style.height = '50px';
                cell.appendChild(newImg);
            } else {
                img.src = images[nextIndex];
            }
        }
    
        // Update score logic
        updateScores(segment);
    });
});

// Undo button logic
document.getElementById('undo-btn').addEventListener('click', () => {
    
    // Get the last action from the history
    const lastAction = actionHistory.pop();
    const { player, segment, prevHits, prevScore, cell } = lastAction;
  
    // Restore the previous hits
    hits[player] = { ...prevHits };
  
    // Restore the previous score
    if (player === 'p1') {
        p1ScoreElem.innerText = prevScore;
    } else {
        p2ScoreElem.innerText = prevScore;
    }
  
    // Update the table cell visuals
    const img = cell.querySelector('img');
    const prevIndex = prevHits[segment] - 1;
  
    if (prevIndex < 0) {
        if (img) cell.removeChild(img); // Remove the image if no hits
    } else {
        if (!img) {
            const newImg = document.createElement('img');
            newImg.src = images[prevIndex];
            newImg.style.width = '30px';
            newImg.style.height = '30px';
            cell.appendChild(newImg);
        } else {
            img.src = images[prevIndex];
        }
    }
});

// Update player scores
function updateScores(segment) {
    const p1Hits = hits.p1[segment];
    const p2Hits = hits.p2[segment];
  
    // Check if Player 1 can score
    if (p1Hits > 3 && p2Hits < 3) {
        // Player 1 scores for extra hits beyond 3
        const extraHits = p1Hits - 3;
        p1ScoreElem.innerText =
            parseInt(p1ScoreElem.innerText) + extraHits * (segment === 'Bull' ? 25 : parseInt(segment));
        hits.p1[segment] = 3; // Cap hits at 3 for Player 1
    }
  
    // Check if Player 2 can score
    if (p2Hits > 3 && p1Hits < 3) {
        // Player 2 scores for extra hits beyond 3
        const extraHits = p2Hits - 3;
        p2ScoreElem.innerText =
            parseInt(p2ScoreElem.innerText) + extraHits * (segment === 'Bull' ? 25 : parseInt(segment));
        hits.p2[segment] = 3; // Cap hits at 3 for Player 2
    }
}

// Disable zoom operations
document.addEventListener('touchstart', function(e) {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });

document.addEventListener('dblclick', function(e) {
    e.preventDefault();
}, { passive: false });

// Disable pinch-to-zoom
document.addEventListener('gesturestart', function(e) {
    e.preventDefault();
});
