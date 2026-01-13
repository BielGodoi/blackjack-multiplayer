import React, { useState, useEffect } from 'react';
import { Play, Plus, Minus, RefreshCw, LogOut } from 'lucide-react';

export default function BlackjackGame() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [balance, setBalance] = useState(1000);
  const [currentBet, setCurrentBet] = useState(0);
  const [betConfirmed, setBetConfirmed] = useState(false);
  const [gameStatus, setGameStatus] = useState('lobby'); // lobby, betting, playing, finished
  const [timer, setTimer] = useState(30);
  const [playerCards, setPlayerCards] = useState([]);
  const [dealerCards, setDealerCards] = useState([]);
  const [playerTotal, setPlayerTotal] = useState(0);
  const [dealerTotal, setDealerTotal] = useState(0);
  const [message, setMessage] = useState('');
  const [isPlayerTurn, setIsPlayerTurn] = useState(false);
  const [gameResult, setGameResult] = useState('');

  // Simular timer de apostas
  useEffect(() => {
    if (gameStatus === 'betting' && timer > 0) {
      const interval = setInterval(() => {
        setTimer(prev => {
          if (prev <= 1) {
            if (betConfirmed) {
              startGame();
            } else {
              setGameStatus('lobby');
              setCurrentBet(0);
              showMessage('Tempo esgotado!');
            }
            return 30;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [gameStatus, timer, betConfirmed]);

  const showMessage = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleLogin = () => {
    if (username && password) {
      setIsLoggedIn(true);
      showMessage('Login bem-sucedido! Saldo: $1000');
    }
  };

  const handleJoinTable = () => {
    if (playerName) {
      setGameStatus('lobby');
      showMessage(`${playerName} entrou na mesa!`);
    }
  };

  const startBetting = () => {
    setGameStatus('betting');
    setTimer(30);
    setCurrentBet(0);
    setBetConfirmed(false);
    setPlayerCards([]);
    setDealerCards([]);
    setGameResult('');
    showMessage('Faça suas apostas! 30 segundos');
  };

  const placeBet = (amount) => {
    if (betConfirmed) {
      showMessage('Aposta já confirmada!');
      return;
    }
    
    if (currentBet + amount > balance) {
      showMessage('Saldo insuficiente!');
      return;
    }
    
    if (currentBet + amount > 500) {
      showMessage('Aposta máxima: $500');
      return;
    }
    
    setCurrentBet(prev => prev + amount);
    showMessage(`+$${amount} adicionado`);
  };

  const confirmBet = () => {
    if (currentBet < 5) {
      showMessage('Aposta mínima: $5');
      return;
    }
    
    setBalance(prev => prev - currentBet);
    setBetConfirmed(true);
    showMessage(`Aposta confirmada: $${currentBet}`);
  };

  const clearBet = () => {
    if (!betConfirmed) {
      setCurrentBet(0);
      showMessage('Aposta limpa');
    }
  };

  const createCard = (value, suit) => ({ value, suit });

  const getCardValue = (card) => {
    if (card.value === 'A') return 11;
    if (['J', 'Q', 'K'].includes(card.value)) return 10;
    return parseInt(card.value);
  };

  const calculateTotal = (cards) => {
    let total = 0;
    let aces = 0;
    
    cards.forEach(card => {
      if (card.hidden) return;
      const value = getCardValue(card);
      total += value;
      if (card.value === 'A') aces++;
    });
    
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    
    return total;
  };

  const getRandomCard = () => {
    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const suits = ['♥', '♦', '♣', '♠'];
    return createCard(
      values[Math.floor(Math.random() * values.length)],
      suits[Math.floor(Math.random() * suits.length)]
    );
  };

  const startGame = () => {
    setGameStatus('playing');
    
    // Distribuir cartas
    const pCards = [getRandomCard(), getRandomCard()];
    const dCards = [getRandomCard(), { ...getRandomCard(), hidden: true }];
    
    setPlayerCards(pCards);
    setDealerCards(dCards);
    
    const pTotal = calculateTotal(pCards);
    const dTotal = calculateTotal([dCards[0]]);
    
    setPlayerTotal(pTotal);
    setDealerTotal(dTotal);
    
    if (pTotal === 21) {
      endGame('blackjack');
    } else {
      setIsPlayerTurn(true);
      showMessage('Sua vez! Pedir ou Parar?');
    }
  };

  const hit = () => {
    const newCard = getRandomCard();
    const newCards = [...playerCards, newCard];
    setPlayerCards(newCards);
    
    const total = calculateTotal(newCards);
    setPlayerTotal(total);
    
    if (total > 21) {
      setIsPlayerTurn(false);
      endGame('bust');
    } else if (total === 21) {
      stand();
    }
  };

  const stand = () => {
    setIsPlayerTurn(false);
    
    // Revelar carta escondida do dealer
    const revealedCards = dealerCards.map(c => ({ ...c, hidden: false }));
    setDealerCards(revealedCards);
    
    let dTotal = calculateTotal(revealedCards);
    setDealerTotal(dTotal);
    
    // Dealer pega cartas até 17
    setTimeout(() => {
      dealerPlay(revealedCards, dTotal);
    }, 1000);
  };

  const dealerPlay = (cards, total) => {
    if (total < 17) {
      const newCard = getRandomCard();
      const newCards = [...cards, newCard];
      setDealerCards(newCards);
      
      const newTotal = calculateTotal(newCards);
      setDealerTotal(newTotal);
      
      setTimeout(() => dealerPlay(newCards, newTotal), 1000);
    } else {
      determineWinner(total);
    }
  };

  const determineWinner = (dTotal) => {
    const pTotal = playerTotal;
    let result = '';
    let winAmount = 0;
    
    if (pTotal > 21) {
      result = `❌ PERDEU -$${currentBet}`;
    } else if (dTotal > 21) {
      result = `✅ GANHOU +$${currentBet}`;
      winAmount = currentBet * 2;
    } else if (pTotal > dTotal) {
      result = `✅ GANHOU +$${currentBet}`;
      winAmount = currentBet * 2;
    } else if (pTotal === dTotal) {
      result = `⚪ EMPATE`;
      winAmount = currentBet;
    } else {
      result = `❌ PERDEU -$${currentBet}`;
    }
    
    setBalance(prev => prev + winAmount);
    setGameResult(result);
    setGameStatus('finished');
    showMessage(result);
  };

  const endGame = (type) => {
    if (type === 'blackjack') {
      const winAmount = Math.floor(currentBet * 2.5);
      setBalance(prev => prev + winAmount);
      setGameResult(`🎰 BLACKJACK! +$${winAmount - currentBet}`);
      showMessage('BLACKJACK!');
    } else if (type === 'bust') {
      setGameResult(`❌ ESTOUROU! -$${currentBet}`);
      showMessage('Você estourou!');
    }
    setGameStatus('finished');
  };

  const newRound = () => {
    startBetting();
  };

  // Renderizar carta
  const renderCard = (card, index) => {
    if (card.hidden) {
      return (
        <div key={index} className="w-16 h-24 bg-gradient-to-br from-red-800 to-red-900 rounded-lg border-2 border-yellow-500 flex items-center justify-center">
          <div className="text-yellow-500 text-2xl">?</div>
        </div>
      );
    }
    
    const isRed = card.suit === '♥' || card.suit === '♦';
    return (
      <div key={index} className="w-16 h-24 bg-white rounded-lg border-2 border-gray-300 flex flex-col items-center justify-between p-2">
        <span className={`text-lg font-bold ${isRed ? 'text-red-600' : 'text-gray-900'}`}>
          {card.value}
        </span>
        <span className={`text-2xl ${isRed ? 'text-red-600' : 'text-gray-900'}`}>
          {card.suit}
        </span>
        <span className={`text-lg font-bold ${isRed ? 'text-red-600' : 'text-gray-900'}`}>
          {card.value}
        </span>
      </div>
    );
  };

  // LOGIN SCREEN
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-900 flex items-center justify-center p-4">
        <div className="bg-gray-900 p-8 rounded-2xl border-4 border-yellow-500 max-w-md w-full">
          <h1 className="text-4xl font-bold text-yellow-500 text-center mb-8">🎰 BLACKJACK</h1>
          <input
            type="text"
            placeholder="Usuário"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full p-4 mb-4 bg-gray-800 text-white rounded-lg border-2 border-gray-700 focus:border-yellow-500 outline-none"
          />
          <input
            type="password"
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
            className="w-full p-4 mb-6 bg-gray-800 text-white rounded-lg border-2 border-gray-700 focus:border-yellow-500 outline-none"
          />
          <button
            onClick={handleLogin}
            className="w-full p-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xl transition-all"
          >
            ENTRAR
          </button>
          <p className="text-gray-400 text-center mt-4 text-sm">Novo jogador? Será criado com $1000</p>
        </div>
      </div>
    );
  }

  // JOIN TABLE SCREEN
  if (!playerName) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-900">
        <div className="bg-gray-900 p-4 border-b-4 border-yellow-500 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-yellow-500">BLACKJACK</h1>
          <span className="text-white">👤 {username}</span>
        </div>
        <div className="flex items-center justify-center min-h-[calc(100vh-80px)] p-4">
          <div className="bg-gray-900 p-8 rounded-2xl border-4 border-yellow-500 max-w-md w-full">
            <h2 className="text-3xl font-bold text-yellow-500 text-center mb-8">ENTRAR NA MESA</h2>
            <input
              type="text"
              placeholder="Seu apelido na mesa"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleJoinTable()}
              className="w-full p-4 mb-6 bg-gray-800 text-white rounded-lg border-2 border-gray-700 focus:border-yellow-500 outline-none"
            />
            <button
              onClick={handleJoinTable}
              className="w-full p-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xl transition-all"
            >
              ENTRAR
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-900">
      {/* Header */}
      <div className="bg-gray-900 p-4 border-b-4 border-yellow-500 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-yellow-500">BLACKJACK</h1>
        <div className="flex gap-4 items-center">
          <span className="text-white">👤 {username}</span>
          {gameStatus === 'lobby' && (
            <button
              onClick={() => setPlayerName('')}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-all"
            >
              SAIR
            </button>
          )}
        </div>
      </div>

      {/* Notification */}
      {message && (
        <div className="fixed top-20 right-4 bg-yellow-500 text-gray-900 px-6 py-3 rounded-lg font-bold shadow-lg z-50 animate-pulse">
          {message}
        </div>
      )}

      <div className="container mx-auto p-4 pb-32">
        {/* LOBBY */}
        {gameStatus === 'lobby' && (
          <div className="text-center py-20">
            <h2 className="text-4xl font-bold text-yellow-500 mb-8">MESA DE BLACKJACK</h2>
            <div className="bg-gray-900 p-8 rounded-2xl border-4 border-yellow-500 inline-block">
              <div className="text-white text-2xl mb-6">
                <div className="mb-2">Jogador: <span className="text-yellow-500 font-bold">{playerName}</span></div>
                <div>Saldo: <span className="text-green-500 font-bold">${balance}</span></div>
              </div>
            </div>
            <button
              onClick={startBetting}
              className="mt-8 px-12 py-6 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-3xl transition-all flex items-center gap-3 mx-auto"
            >
              <Play size={32} /> INICIAR RODADA
            </button>
          </div>
        )}

        {/* BETTING */}
        {gameStatus === 'betting' && (
          <div className="text-center py-10">
            <div className="bg-red-600 text-white text-4xl font-bold py-4 px-8 rounded-lg inline-block mb-8">
              {timer}s
            </div>

            <div className="flex gap-6 justify-center mb-8">
              <div className="w-20 h-20 bg-red-600 hover:bg-red-700 rounded-full border-4 border-white flex items-center justify-center text-white font-bold text-xl cursor-pointer transition-all hover:scale-110 active:scale-95"
                   onClick={() => placeBet(5)}>
                $5
              </div>
              <div className="w-20 h-20 bg-blue-600 hover:bg-blue-700 rounded-full border-4 border-white flex items-center justify-center text-white font-bold text-xl cursor-pointer transition-all hover:scale-110 active:scale-95"
                   onClick={() => placeBet(10)}>
                $10
              </div>
              <div className="w-20 h-20 bg-green-600 hover:bg-green-700 rounded-full border-4 border-white flex items-center justify-center text-white font-bold text-xl cursor-pointer transition-all hover:scale-110 active:scale-95"
                   onClick={() => placeBet(25)}>
                $25
              </div>
              <div className="w-20 h-20 bg-purple-600 hover:bg-purple-700 rounded-full border-4 border-white flex items-center justify-center text-white font-bold text-xl cursor-pointer transition-all hover:scale-110 active:scale-95"
                   onClick={() => placeBet(50)}>
                $50
              </div>
              <div className="w-20 h-20 bg-gray-900 hover:bg-gray-800 rounded-full border-4 border-yellow-500 flex items-center justify-center text-yellow-500 font-bold text-xl cursor-pointer transition-all hover:scale-110 active:scale-95"
                   onClick={() => placeBet(100)}>
                $100
              </div>
            </div>

            <div className="bg-gray-900 p-8 rounded-2xl border-4 border-yellow-500 inline-block mb-6 min-w-[300px]">
              <div className="text-yellow-500 text-6xl font-bold mb-2">${currentBet}</div>
              <div className="text-gray-400">Sua Aposta</div>
            </div>

            {!betConfirmed ? (
              <div className="flex gap-4 justify-center">
                <button
                  onClick={clearBet}
                  className="px-10 py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xl transition-all"
                >
                  LIMPAR
                </button>
                <button
                  onClick={confirmBet}
                  className="px-10 py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xl transition-all"
                >
                  CONFIRMAR
                </button>
              </div>
            ) : (
              <div className="text-green-500 text-2xl font-bold">✅ Aposta Confirmada!</div>
            )}
          </div>
        )}

        {/* PLAYING / FINISHED */}
        {(gameStatus === 'playing' || gameStatus === 'finished') && (
          <div>
            {/* Dealer */}
            <div className="text-center mb-12">
              <div className="text-yellow-500 text-2xl font-bold mb-4">🎩 DEALER</div>
              <div className="flex gap-2 justify-center mb-4">
                {dealerCards.map((card, i) => renderCard(card, i))}
              </div>
              {gameStatus === 'finished' && (
                <div className="text-white text-xl font-bold">Total: {dealerTotal}</div>
              )}
            </div>

            {/* Player */}
            <div className="bg-gray-900 p-6 rounded-2xl border-4 border-yellow-500 max-w-2xl mx-auto">
              <div className="flex justify-between items-center mb-4">
                <span className="text-white text-xl font-bold">{playerName}</span>
                <span className="text-yellow-500 text-xl font-bold">${balance}</span>
              </div>
              <div className="flex gap-2 justify-center mb-4">
                {playerCards.map((card, i) => renderCard(card, i))}
              </div>
              <div className="text-center">
                <div className="text-white text-2xl font-bold mb-2">Total: {playerTotal}</div>
                {gameResult && (
                  <div className="text-2xl font-bold mt-4">{gameResult}</div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            {isPlayerTurn && gameStatus === 'playing' && (
              <div className="flex gap-4 justify-center mt-8">
                <button
                  onClick={hit}
                  className="px-10 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xl transition-all"
                >
                  🃏 PEDIR
                </button>
                <button
                  onClick={stand}
                  className="px-10 py-4 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-lg text-xl transition-all"
                >
                  ✋ PARAR
                </button>
              </div>
            )}

            {gameStatus === 'finished' && (
              <div className="text-center mt-8">
                <button
                  onClick={newRound}
                  className="px-12 py-6 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-2xl transition-all flex items-center gap-3 mx-auto"
                >
                  <RefreshCw size={28} /> PRÓXIMA RODADA
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Stats */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-r from-amber-900 to-amber-800 border-t-4 border-yellow-500 p-6">
        <div className="container mx-auto flex justify-around">
          <div className="text-center">
            <div className="text-yellow-500 text-xs font-bold mb-1">BALANCE</div>
            <div className="text-white text-3xl font-bold">${balance.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-yellow-500 text-xs font-bold mb-1">TOTAL BET</div>
            <div className="text-white text-3xl font-bold">${currentBet.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-yellow-500 text-xs font-bold mb-1">TOTAL WIN</div>
            <div className="text-white text-3xl font-bold">$0.00</div>
          </div>
        </div>
      </div>
    </div>
  );
}
