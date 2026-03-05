/**
 * Go Game Logic and Types
 */

export type Player = 'black' | 'white';
export type Intersection = Player | null;

export interface GameState {
  board: Intersection[][];
  turn: Player;
  captures: { black: number; white: number };
  history: string[]; // Board states as strings for Ko rule
  passes: number;
  isGameOver: boolean;
  winner: Player | 'draw' | null;
  score: { black: number; white: number } | null;
  fullHistory?: any[]; // To store previous states for undo
}

export const BOARD_SIZE = 19;

export function createEmptyBoard(size: number = BOARD_SIZE): Intersection[][] {
  return Array(size).fill(null).map(() => Array(size).fill(null));
}

export function boardToString(board: Intersection[][]): string {
  return board.map(row => row.map(cell => cell || '.').join('')).join('\n');
}

export function getLiberties(board: Intersection[][], r: number, c: number): Set<string> {
  const size = board.length;
  const player = board[r][c];
  if (!player) return new Set();

  const group = new Set<string>();
  const liberties = new Set<string>();
  const stack = [[r, c]];
  group.add(`${r},${c}`);

  while (stack.length > 0) {
    const [currR, currC] = stack.pop()!;
    const neighbors = [
      [currR - 1, currC],
      [currR + 1, currC],
      [currR, currC - 1],
      [currR, currC + 1],
    ];

    for (const [nR, nC] of neighbors) {
      if (nR >= 0 && nR < size && nC >= 0 && nC < size) {
        if (board[nR][nC] === null) {
          liberties.add(`${nR},${nC}`);
        } else if (board[nR][nC] === player && !group.has(`${nR},${nC}`)) {
          group.add(`${nR},${nC}`);
          stack.push([nR, nC]);
        }
      }
    }
  }

  return liberties;
}

export function getGroup(board: Intersection[][], r: number, c: number): Set<string> {
  const size = board.length;
  const player = board[r][c];
  if (!player) return new Set();

  const group = new Set<string>();
  const stack = [[r, c]];
  group.add(`${r},${c}`);

  while (stack.length > 0) {
    const [currR, currC] = stack.pop()!;
    const neighbors = [
      [currR - 1, currC],
      [currR + 1, currC],
      [currR, currC - 1],
      [currR, currC + 1],
    ];

    for (const [nR, nC] of neighbors) {
      if (nR >= 0 && nR < size && nC >= 0 && nC < size) {
        if (board[nR][nC] === player && !group.has(`${nR},${nC}`)) {
          group.add(`${nR},${nC}`);
          stack.push([nR, nC]);
        }
      }
    }
  }

  return group;
}

export function calculateScore(board: Intersection[][], komi: number = 6.5): { black: number; white: number } {
  const size = board.length;
  const visited = new Set<string>();
  let blackTerritory = 0;
  let whiteTerritory = 0;
  let blackStones = 0;
  let whiteStones = 0;

  // Area Scoring (Chinese Rules)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === 'black') blackStones++;
      else if (board[r][c] === 'white') whiteStones++;
      
      if (board[r][c] === null && !visited.has(`${r},${c}`)) {
        const territory = new Set<string>();
        const stack = [[r, c]];
        territory.add(`${r},${c}`);
        visited.add(`${r},${c}`);

        let touchesBlack = false;
        let touchesWhite = false;

        const currentTerritoryGroup = [[r, c]];
        while (currentTerritoryGroup.length > 0) {
          const [currR, currC] = currentTerritoryGroup.pop()!;
          const neighbors = [
            [currR - 1, currC],
            [currR + 1, currC],
            [currR, currC - 1],
            [currR, currC + 1],
          ];

          for (const [nR, nC] of neighbors) {
            if (nR >= 0 && nR < size && nC >= 0 && nC < size) {
              if (board[nR][nC] === 'black') touchesBlack = true;
              else if (board[nR][nC] === 'white') touchesWhite = true;
              else if (board[nR][nC] === null && !visited.has(`${nR},${nC}`)) {
                visited.add(`${nR},${nC}`);
                territory.add(`${nR},${nC}`);
                currentTerritoryGroup.push([nR, nC]);
              }
            }
          }
        }

        if (touchesBlack && !touchesWhite) {
          blackTerritory += territory.size;
        } else if (touchesWhite && !touchesBlack) {
          whiteTerritory += territory.size;
        }
      }
    }
  }

  return {
    black: blackStones + blackTerritory,
    white: whiteStones + whiteTerritory + komi
  };
}
