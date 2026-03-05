/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, Flag, SkipForward, Trophy, Info, Settings2, Users, Copy, Check, Undo2 } from 'lucide-react';
import confetti from 'canvas-confetti';
import { io, Socket } from 'socket.io-client';
import { 
  Intersection, 
  Player, 
  GameState, 
  BOARD_SIZE, 
  createEmptyBoard, 
  getLiberties, 
  getGroup, 
  boardToString,
  calculateScore
} from './goLogic';

const KOMI = 6.5;
const STONE_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3';

// Initialize socket outside component to avoid multiple connections
let socket: Socket;

export default function App() {
  const [gameState, setGameState] = useState<GameState>({
    board: createEmptyBoard(),
    turn: 'black',
    captures: { black: 0, white: 0 },
    history: [boardToString(createEmptyBoard())],
    passes: 0,
    isGameOver: false,
    winner: null,
    score: null,
    fullHistory: [],
  });

  const [boardSize, setBoardSize] = useState(19);
  const [showSettings, setShowSettings] = useState(false);
  const [roomId, setRoomId] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [playerColor, setPlayerColor] = useState<Player | 'spectator' | null>(null);
  const [takenRoles, setTakenRoles] = useState<Player[]>([]);

  const playStoneSound = useCallback(() => {
    const audio = new Audio(STONE_SOUND_URL);
    audio.volume = 0.5;
    audio.play().catch(e => console.log('Audio play blocked:', e));
  }, []);

  // Initialize Room from URL hash or generate new one
  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const id = hash || Math.random().toString(36).substring(2, 9);
    setRoomId(id);
    if (!hash) window.location.hash = id;

    socket = io();

    socket.on('connect', () => {
      socket.emit('join-room', id);
    });

    socket.on('game-state', (newState: GameState) => {
      setGameState(prev => {
        // If the board changed, play sound
        const boardChanged = JSON.stringify(prev.board) !== JSON.stringify(newState.board);
        if (boardChanged) {
          playStoneSound();
        }
        return newState;
      });
      setBoardSize(newState.board.length);
    });

    socket.on('player-roles', (roles: Record<string, string>) => {
      const taken = Object.values(roles).filter(r => r === 'black' || r === 'white') as Player[];
      setTakenRoles(taken);
    });

    return () => {
      socket.disconnect();
    };
  }, [playStoneSound]);

  const syncGame = useCallback((newState: GameState) => {
    setGameState(newState);
    playStoneSound();
    if (socket && roomId) {
      socket.emit('update-game', { roomId, state: newState });
    }
  }, [roomId, playStoneSound]);

  const resetGame = useCallback((size: number = boardSize) => {
    if (window.confirm('Are you sure you want to reset the game?')) {
      const newState = {
        board: createEmptyBoard(size),
        turn: 'black',
        captures: { black: 0, white: 0 },
        history: [boardToString(createEmptyBoard(size))],
        passes: 0,
        isGameOver: false,
        winner: null,
        score: null,
        fullHistory: [],
      };
      setBoardSize(size);
      setShowSettings(false);
      syncGame(newState);
    }
  }, [boardSize, syncGame]);

  const handleUndo = useCallback(() => {
    if (gameState.isGameOver || !gameState.fullHistory || gameState.fullHistory.length === 0) return;
    
    // A player can only undo their own move. 
    // This means it must currently be the opponent's turn.
    if (!playerColor || playerColor === 'spectator' || gameState.turn === playerColor) {
      return;
    }

    const previousStates = [...gameState.fullHistory];
    const lastState = previousStates.pop();

    if (lastState) {
      const newState = {
        ...lastState,
        fullHistory: previousStates
      };
      syncGame(newState);
    }
  }, [gameState, syncGame, playerColor]);

  const handlePass = useCallback(() => {
    if (gameState.isGameOver) return;
    
    // Check if it's the player's turn
    if (!playerColor || playerColor === 'spectator' || gameState.turn !== playerColor) {
      return;
    }

    const { fullHistory, ...currentStateSnapshot } = gameState;
    const newFullHistory = [...(fullHistory || []), currentStateSnapshot];

    const newPasses = gameState.passes + 1;
    let newState: GameState;

    if (newPasses >= 2) {
      const finalScore = calculateScore(gameState.board, KOMI);
      const winner = finalScore.black > finalScore.white ? 'black' : 'white';
      newState = {
        ...gameState,
        passes: newPasses,
        isGameOver: true,
        winner,
        score: finalScore,
        fullHistory: newFullHistory
      };
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 }
      });
    } else {
      newState = {
        ...gameState,
        turn: gameState.turn === 'black' ? 'white' : 'black',
        passes: newPasses,
        fullHistory: newFullHistory
      };
    }
    syncGame(newState);
  }, [gameState, syncGame, playerColor]);

  const handleResign = useCallback(() => {
    if (gameState.isGameOver) return;

    // Check if it's the player's turn to resign (or just if they are a player)
    if (!playerColor || playerColor === 'spectator' || gameState.turn !== playerColor) {
      return;
    }

    const { fullHistory, ...currentStateSnapshot } = gameState;
    const newFullHistory = [...(fullHistory || []), currentStateSnapshot];

    const winner = gameState.turn === 'black' ? 'white' : 'black';
    const newState = {
      ...gameState,
      isGameOver: true,
      winner,
      fullHistory: newFullHistory
    };
    syncGame(newState);
  }, [gameState, syncGame, playerColor]);

  const placeStone = useCallback((r: number, c: number) => {
    if (gameState.isGameOver || gameState.board[r][c] !== null) return;
    
    // Check if it's the player's turn
    if (!playerColor || playerColor === 'spectator' || gameState.turn !== playerColor) {
      return;
    }

    const player = gameState.turn;
    const opponent = player === 'black' ? 'white' : 'black';
    
    const newBoard = gameState.board.map(row => [...row]);
    newBoard[r][c] = player;

    let capturedCount = 0;
    const neighbors = [
      [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]
    ];

    for (const [nR, nC] of neighbors) {
      if (nR >= 0 && nR < boardSize && nC >= 0 && nC < boardSize) {
        if (newBoard[nR][nC] === opponent) {
          const liberties = getLiberties(newBoard, nR, nC);
          if (liberties.size === 0) {
            const group = getGroup(newBoard, nR, nC);
            capturedCount += group.size;
            group.forEach(pos => {
              const [gr, gc] = pos.split(',').map(Number);
              newBoard[gr][gc] = null;
            });
          }
        }
      }
    }

    const ownLiberties = getLiberties(newBoard, r, c);
    if (ownLiberties.size === 0 && capturedCount === 0) return;

    const boardStr = boardToString(newBoard);
    if (gameState.history.includes(boardStr)) return;

    const { fullHistory, ...currentStateSnapshot } = gameState;
    const newFullHistory = [...(fullHistory || []), currentStateSnapshot];

    const newState = {
      ...gameState,
      board: newBoard,
      turn: opponent,
      captures: {
        ...gameState.captures,
        [player]: gameState.captures[player] + capturedCount
      },
      history: [...gameState.history, boardStr],
      passes: 0,
      fullHistory: newFullHistory
    };
    syncGame(newState);
  }, [gameState, boardSize, syncGame, playerColor]);

  const copyRoomLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const selectRole = (role: Player | 'spectator') => {
    setPlayerColor(role);
    if (socket && roomId) {
      socket.emit('select-role', { roomId, role });
    }
  };

  const leaveSeat = () => {
    if (window.confirm('Are you sure you want to leave the room?')) {
      setPlayerColor(null);
      if (socket && roomId) {
        socket.emit('leave-role', roomId);
      }
    }
  };

  const starPoints = useMemo(() => {
    if (boardSize === 19) {
      return [
        [3, 3], [3, 9], [3, 15],
        [9, 3], [9, 9], [9, 15],
        [15, 3], [15, 9], [15, 15]
      ];
    } else if (boardSize === 13) {
      return [[3, 3], [3, 9], [6, 6], [9, 3], [9, 9]];
    } else if (boardSize === 9) {
      return [[2, 2], [2, 6], [4, 4], [6, 2], [6, 6]];
    }
    return [];
  }, [boardSize]);

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="max-w-5xl mx-auto px-6 py-8 flex flex-col md:flex-row justify-between items-center border-b border-black/10 gap-4">
        <div className="text-center md:text-left">
          <h1 className="text-4xl font-serif font-light tracking-tight">Alpha 叟</h1>
        </div>
        <div className="flex flex-col md:items-end gap-6">
          <div className="flex flex-wrap justify-center gap-4 items-center">
            <div className="flex flex-col items-center md:items-end gap-1.5">
              <div className="flex items-center gap-2 px-4 py-2 bg-black/5 rounded-full border border-black/5">
                <Users size={16} className="opacity-40" />
                <span className="text-xs font-mono opacity-60">Room: {roomId}</span>
                <button 
                  onClick={copyRoomLink}
                  className="ml-2 p-1 hover:bg-black/5 rounded-md transition-colors"
                  title="Copy Room Link"
                >
                  {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} className="opacity-40" />}
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 font-semibold text-center md:text-right">
                Copy and send this link to invite your friend
              </p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className="px-5 py-2 rounded-full bg-zinc-100 text-zinc-800 border border-zinc-200 hover:bg-zinc-200 transition-all text-sm font-bold shadow-sm active:scale-95"
              >
                Board Settings
              </button>
              <button 
                onClick={() => resetGame()}
                className="px-5 py-2 rounded-full bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-all text-sm font-bold shadow-sm active:scale-95"
              >
                Reset Game
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-12 items-start">
        {/* Color Selection Overlay */}
        <AnimatePresence>
          {playerColor === null && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-6"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white rounded-3xl p-10 max-w-md w-full shadow-2xl text-center"
              >
                <h2 className="text-3xl font-serif mb-2">Welcome to Alpha 叟</h2>
                <p className="text-zinc-500 mb-8">Choose your side to begin the match</p>
                
                <div className="grid grid-cols-1 gap-4">
                  <button 
                    onClick={() => selectRole('black')}
                    disabled={takenRoles.includes('black')}
                    className={`flex items-center justify-between p-6 rounded-2xl transition-all group ${
                      takenRoles.includes('black')
                        ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed border-2 border-transparent'
                        : 'bg-zinc-900 text-white hover:bg-black'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-8 h-8 rounded-full border ${
                        takenRoles.includes('black') ? 'bg-zinc-200 border-zinc-300' : 'bg-white/20 border-white/10'
                      }`} />
                      <span className="text-lg font-medium">Play as Black</span>
                    </div>
                    <span className="text-xs uppercase tracking-widest opacity-40 group-hover:opacity-100 transition-opacity">
                      {takenRoles.includes('black') ? 'Already Taken' : 'First Move'}
                    </span>
                  </button>
                  
                  <button 
                    onClick={() => selectRole('white')}
                    disabled={takenRoles.includes('white')}
                    className={`flex items-center justify-between p-6 rounded-2xl border-2 transition-all group ${
                      takenRoles.includes('white')
                        ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed border-zinc-200'
                        : 'bg-white border-zinc-200 text-zinc-900 hover:border-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-8 h-8 rounded-full border ${
                        takenRoles.includes('white') ? 'bg-zinc-200 border-zinc-300' : 'bg-zinc-100 border-zinc-200'
                      }`} />
                      <span className="text-lg font-medium">Play as White</span>
                    </div>
                    <span className="text-xs uppercase tracking-widest opacity-40 group-hover:opacity-100 transition-opacity">
                      {takenRoles.includes('white') ? 'Already Taken' : 'Second Move'}
                    </span>
                  </button>
                  
                  <button 
                    onClick={() => selectRole('spectator')}
                    className="mt-4 py-3 text-zinc-400 hover:text-zinc-900 transition-colors text-sm font-medium"
                  >
                    Continue as Spectator
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Game Board Section */}
        <div className="flex flex-col items-center">
          <div className="relative p-8 bg-[#DDBB88] rounded-sm shadow-2xl border-4 border-[#C4A474]">
            {/* Board Grid with Intersections */}
            <div 
              className="grid"
              style={{ 
                gridTemplateColumns: `repeat(${boardSize}, 1fr)`,
                gridTemplateRows: `repeat(${boardSize}, 1fr)`,
                width: 'min(80vw, 600px)',
                height: 'min(80vw, 600px)'
              }}
            >
              {gameState.board.map((row, r) => 
                row.map((cell, c) => (
                  <div 
                    key={`${r}-${c}`}
                    onClick={() => placeStone(r, c)}
                    className="relative flex items-center justify-center cursor-pointer group"
                  >
                    {/* Grid Lines */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      {/* Horizontal line */}
                      <div className={`h-[1px] bg-black/40 absolute 
                        ${c === 0 ? 'left-1/2 right-0' : c === boardSize - 1 ? 'left-0 right-1/2' : 'left-0 right-0'}`} 
                      />
                      {/* Vertical line */}
                      <div className={`w-[1px] bg-black/40 absolute 
                        ${r === 0 ? 'top-1/2 bottom-0' : r === boardSize - 1 ? 'top-0 bottom-1/2' : 'top-0 bottom-0'}`} 
                      />
                    </div>

                    {/* Star Points */}
                    {starPoints.some(([sr, sc]) => sr === r && sc === c) && (
                      <div className="absolute w-2 h-2 bg-black rounded-full z-0" />
                    )}

                    {/* Stone */}
                    <AnimatePresence>
                      {cell && (
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          className={`w-[85%] h-[85%] rounded-full shadow-lg z-10 ${
                            cell === 'black' 
                              ? 'bg-gradient-to-br from-zinc-800 to-black' 
                              : 'bg-gradient-to-br from-white to-zinc-200'
                          }`}
                        />
                      )}
                    </AnimatePresence>

                    {/* Hover Preview */}
                    {!cell && !gameState.isGameOver && playerColor === gameState.turn && (
                      <div className={`w-[85%] h-[85%] rounded-full opacity-0 group-hover:opacity-30 transition-opacity z-10 ${
                        gameState.turn === 'black' ? 'bg-black' : 'bg-white'
                      }`} />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <button 
              onClick={handleUndo}
              disabled={
                gameState.isGameOver || 
                !gameState.fullHistory || 
                gameState.fullHistory.length === 0 ||
                !playerColor || 
                playerColor === 'spectator' || 
                gameState.turn === playerColor
              }
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-white border border-black/10 hover:bg-black/5 disabled:opacity-30 transition-all font-medium"
            >
              <Undo2 size={18} />
              Undo
            </button>
            <button 
              onClick={handlePass}
              disabled={gameState.isGameOver}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-white border border-black/10 hover:bg-black/5 disabled:opacity-50 transition-all font-medium"
            >
              <SkipForward size={18} />
              Pass
            </button>
            <button 
              onClick={handleResign}
              disabled={gameState.isGameOver}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-white border border-black/10 hover:bg-black/5 disabled:opacity-50 transition-all font-medium text-red-600"
            >
              <Flag size={18} />
              Resign
            </button>
          </div>
        </div>

        {/* Sidebar Status */}
        <aside className="space-y-8">
          {/* Turn Indicator */}
          <div className="p-6 bg-white rounded-2xl shadow-sm border border-black/5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs uppercase tracking-widest opacity-50 font-semibold">Current Turn</h3>
              {playerColor && playerColor !== 'spectator' && (
                <span className="text-[10px] tracking-tighter px-2 py-1 bg-emerald-100 text-emerald-700 rounded-md font-bold">
                  You are {playerColor}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-full shadow-md transition-all duration-500 ${
                gameState.turn === 'black' 
                  ? 'bg-black scale-110' 
                  : 'bg-white border border-black/10'
              }`} />
              <div>
                <p className="text-xl font-medium capitalize">{gameState.turn}</p>
                <p className="text-sm opacity-60">
                  {gameState.passes === 1 ? 'Last player passed' : 'Thinking...'}
                </p>
              </div>
            </div>
          </div>

          {/* Captures */}
          <div className="p-6 bg-white rounded-2xl shadow-sm border border-black/5">
            <h3 className="text-xs uppercase tracking-widest opacity-50 mb-4 font-semibold">Captured Stones</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-black" />
                  <span className="font-medium">Black</span>
                </div>
                <span className="text-2xl font-serif">{gameState.captures.black}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-white border border-black/10" />
                  <span className="font-medium">White</span>
                </div>
                <span className="text-2xl font-serif">{gameState.captures.white}</span>
              </div>
            </div>
          </div>

          {/* Leave Room Button */}
          {playerColor && (
            <button 
              onClick={leaveSeat}
              className="w-full py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-md active:scale-[0.98]"
            >
              Leave Room
            </button>
          )}

          {/* Game Over Modal / Status */}
          <AnimatePresence>
            {gameState.isGameOver && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-8 bg-emerald-50 border border-emerald-200 rounded-2xl shadow-lg"
              >
                <div className="flex items-center gap-3 text-emerald-700 mb-4">
                  <Trophy size={24} />
                  <h3 className="text-lg font-bold">Game Over</h3>
                </div>
                
                <p className="text-3xl font-serif mb-2 capitalize">
                  {gameState.winner} Wins!
                </p>
                
                {gameState.score && (
                  <div className="space-y-1 text-sm opacity-80 mb-6">
                    <p>Black Score: {gameState.score.black.toFixed(1)}</p>
                    <p>White Score: {gameState.score.white.toFixed(1)} (incl. {KOMI} Komi)</p>
                  </div>
                )}

                <button 
                  onClick={() => resetGame()}
                  className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-colors shadow-md"
                >
                  Play Again
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Settings Overlay */}
          <AnimatePresence>
            {showSettings && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6"
                onClick={() => setShowSettings(false)}
              >
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl"
                  onClick={e => e.stopPropagation()}
                >
                  <h2 className="text-2xl font-serif mb-6">Board Settings</h2>
                  <div className="space-y-6">
                    <div>
                      <label className="text-xs uppercase tracking-widest opacity-50 font-bold mb-3 block">Board Size</label>
                      <div className="grid grid-cols-3 gap-3">
                        {[9, 13, 19].map(size => (
                          <button
                            key={size}
                            onClick={() => resetGame(size)}
                            className={`py-3 rounded-xl border-2 transition-all font-bold ${
                              boardSize === size 
                                ? 'border-black bg-black text-white' 
                                : 'border-black/10 hover:border-black/30'
                            }`}
                          >
                            {size}x{size}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="p-4 bg-zinc-50 rounded-xl flex gap-3 items-start">
                      <Info className="text-zinc-400 shrink-0" size={20} />
                      <p className="text-xs leading-relaxed text-zinc-600">
                        Changing the board size will reset the current game. 
                        Standard games use 19x19, while beginners often start with 9x9 or 13x13.
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="w-full mt-8 py-4 bg-zinc-100 rounded-2xl font-bold hover:bg-zinc-200 transition-colors"
                  >
                    Close
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </main>

      {/* Footer Info */}
      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-black/10 text-center opacity-40 text-sm">
        <p>© {new Date().getFullYear()} Alpha 叟 • Area Scoring Rules • Komi: {KOMI}</p>
      </footer>
    </div>
  );
}
