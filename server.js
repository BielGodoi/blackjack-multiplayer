// server.js - Servidor Node.js para Blackjack Multiplayer
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Banco de dados simples em memória
const users = new Map();
const dailyBonuses = new Map();

// Estado do jogo
let gameState = {
  players: [],
  dealer: { cards: [], total: 0 },
  deck: [],
  totalCards: 312,
  cardsUsed: 0,
  currentPlayer: 0,
  status: 'lobby',
  roundSpeed: 2000,
  bettingTimeLeft: 0,
  bettingTimer: null
};

// Criar 6 baralhos
function createDeck() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  
  for (let i = 0; i < 6; i++) {
    suits.forEach(suit => {
      values.forEach(value => {
        deck.push({ suit, value, hidden: false });
      });
    });
  }
  
  return deck.sort(() => Math.random() - 0.5);
}

function needsShuffle() {
  return gameState.cardsUsed >= (gameState.totalCards * 0.5);
}

function calculateTotal(cards) {
  let total = 0;
  let aces = 0;
  
  cards.filter(c => !c.hidden).forEach(card => {
    if (card.value === 'A') {
      aces++;
      total += 11;
    } else if (['J', 'Q', 'K'].includes(card.value)) {
      total += 10;
    } else {
      total += parseInt(card.value);
    }
  });
  
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  
  return total;
}

function canSplit(player) {
  if (player.cards.length !== 2) return false;
  const card1 = player.cards[0].value;
  const card2 = player.cards[1].value;
  
  if (card1 === card2) return true;
  
  const figures = ['J', 'Q', 'K', '10'];
  if (figures.includes(card1) && figures.includes(card2)) return true;
  
  return false;
}

// Salvar saldo do usuário
function saveUserBalance(username, balance) {
  if (users.has(username)) {
    const user = users.get(username);
    user.balance = balance;
    users.set(username, user);
    console.log(`💾 Salvou saldo de ${username}: $${balance}`);
  }
}

io.on('connection', (socket) => {
  console.log('✅ Novo jogador conectado:', socket.id);
  
  socket.emit('gameState', gameState);
  
  // Login
  socket.on('login', (data) => {
    const { username, password } = data;
    
    console.log(`🔐 Tentativa de login: ${username}`);
    
    if (!username || !password) {
      socket.emit('loginError', { message: 'Usuário e senha são obrigatórios!' });
      return;
    }
    
    if (users.has(username)) {
      const user = users.get(username);
      if (user.password === password) {
        console.log(`✅ Login bem-sucedido: ${username}, Saldo: $${user.balance}`);
        socket.emit('loginSuccess', { username, balance: user.balance });
      } else {
        console.log(`❌ Senha incorreta para: ${username}`);
        socket.emit('loginError', { message: 'Senha incorreta!' });
      }
    } else {
      console.log(`🆕 Novo usuário criado: ${username} com $1000`);
      users.set(username, { password, balance: 1000 });
      socket.emit('loginSuccess', { username, balance: 1000 });
    }
  });
  
  // Bônus diário
  socket.on('claimDailyBonus', (data) => {
    const { username } = data;
    const user = users.get(username);
    
    if (!user) {
      socket.emit('bonusError', { message: 'Usuário não encontrado!' });
      return;
    }
    
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    
    let bonusData = dailyBonuses.get(username) || { lastBonus: 0, bonusesToday: 0 };
    
    if (now - bonusData.lastBonus < oneDay) {
      const timeLeft = oneDay - (now - bonusData.lastBonus);
      const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
      const minutesLeft = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
      socket.emit('bonusError', { message: `Aguarde ${hoursLeft}h ${minutesLeft}m para o próximo bônus!` });
      return;
    }
    
    if (now - bonusData.lastBonus >= oneDay) {
      bonusData.bonusesToday = 0;
    }
    
    if (bonusData.bonusesToday >= 3) {
      socket.emit('bonusError', { message: 'Você já resgatou 3 bônus hoje!' });
      return;
    }
    
    const bonusAmount = 500;
    user.balance += bonusAmount;
    bonusData.lastBonus = now;
    bonusData.bonusesToday++;
    
    dailyBonuses.set(username, bonusData);
    users.set(username, user);
    
    socket.emit('bonusSuccess', { 
      amount: bonusAmount, 
      newBalance: user.balance,
      remaining: 3 - bonusData.bonusesToday
    });
    
    // Atualizar saldo do jogador na mesa
    const player = gameState.players.find(p => p.username === username);
    if (player) {
      player.balance = user.balance;
      io.emit('gameState', gameState);
    }
    
    console.log(`🎁 ${username} ganhou $${bonusAmount}. Novo saldo: $${user.balance}`);
  });
  
  // Adicionar jogador
  socket.on('addPlayer', (data) => {
    if (gameState.players.length < 7 && gameState.status === 'lobby') {
      const user = users.get(data.username);
      const balance = user ? user.balance : 1000;
      
      const player = {
        id: socket.id,
        name: data.name,
        username: data.username,
        balance: balance,
        bet: 0,
        cards: [],
        splitHand: null,
        total: 0,
        splitTotal: 0,
        busted: false,
        splitBusted: false,
        blackjack: false,
        standing: false,
        splitStanding: false,
        result: null,
        betPlaced: false,
        doubled: false,
        canSplit: false,
        canDouble: false,
        playingFirstHand: true
      };
      
      gameState.players.push(player);
      io.emit('gameState', gameState);
      io.emit('notification', { message: `${data.name} entrou na mesa!` });
      console.log(`👤 ${data.name} (${data.username}) entrou na mesa com $${balance}`);
    }
  });
  
  // Iniciar fase de apostas
  socket.on('startBetting', () => {
    if (gameState.players.length > 0 && gameState.status === 'lobby') {
      if (gameState.deck.length === 0 || needsShuffle()) {
        gameState.deck = createDeck();
        gameState.cardsUsed = 0;
        io.emit('notification', { message: '🔀 Baralhos embaralhados!' });
      }
      
      gameState.status = 'betting';
      gameState.bettingTimeLeft = 30;
      
      // Resetar apostas
      gameState.players.forEach(p => {
        p.bet = 0;
        p.betPlaced = false;
        p.cards = [];
        p.splitHand = null;
        p.busted = false;
        p.splitBusted = false;
        p.blackjack = false;
        p.standing = false;
        p.splitStanding = false;
        p.result = null;
        p.doubled = false;
        p.canSplit = false;
        p.canDouble = false;
        p.playingFirstHand = true;
      });
      
      io.emit('gameState', gameState);
      io.emit('notification', { message: '💰 30 segundos para apostar!' });
      
      console.log('🎲 Fase de apostas iniciada');
      
      // Timer de apostas
      if (gameState.bettingTimer) {
        clearInterval(gameState.bettingTimer);
      }
      
      gameState.bettingTimer = setInterval(() => {
        gameState.bettingTimeLeft--;
        io.emit('bettingTimer', { timeLeft: gameState.bettingTimeLeft });
        
        if (gameState.bettingTimeLeft <= 0) {
          clearInterval(gameState.bettingTimer);
          
          const playersWhoBet = gameState.players.filter(p => p.betPlaced);
          const playersWhoDidnt = gameState.players.filter(p => !p.betPlaced);
          
          // Devolver apostas não confirmadas
          playersWhoDidnt.forEach(p => {
            if (p.bet > 0) {
              p.balance += p.bet;
              saveUserBalance(p.username, p.balance);
              p.bet = 0;
            }
          });
          
          if (playersWhoDidnt.length > 0) {
            io.emit('notification', { 
              message: `${playersWhoDidnt.map(p => p.name).join(', ')} não confirmaram!` 
            });
          }
          
          gameState.players = playersWhoBet;
          
          if (gameState.players.length > 0) {
            setTimeout(() => startGame(), 2000);
          } else {
            gameState.status = 'lobby';
            io.emit('gameState', gameState);
            io.emit('notification', { message: 'Ninguém apostou! Voltando ao lobby...' });
          }
        }
      }, 1000);
    }
  });
  
  // Fazer aposta
  socket.on('placeBet', (data) => {
    const player = gameState.players.find(p => p.id === socket.id);
    
    if (player && gameState.status === 'betting' && !player.betPlaced) {
      const betAmount = parseInt(data.amount);
      
      console.log(`💵 ${player.name} clicou na ficha de $${betAmount}`);
      
      if (betAmount < 5) {
        socket.emit('betError', { message: 'Aposta mínima: $5' });
        return;
      }
      if (betAmount > 500) {
        socket.emit('betError', { message: 'Aposta máxima: $500' });
        return;
      }
      if (betAmount > player.balance) {
        socket.emit('betError', { message: 'Saldo insuficiente!' });
        return;
      }
      if (player.bet + betAmount > 500) {
        socket.emit('betError', { message: 'Aposta total máxima: $500' });
        return;
      }
      
      player.bet += betAmount;
      player.balance -= betAmount;
      
      console.log(`✅ ${player.name} apostou $${betAmount}. Total: $${player.bet}, Saldo: $${player.balance}`);
      
      io.emit('gameState', gameState);
      socket.emit('notification', { message: `Você apostou $${betAmount}!` });
    }
  });
  
  // Confirmar aposta
  socket.on('confirmBet', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    
    if (player && gameState.status === 'betting' && !player.betPlaced) {
      if (player.bet < 5) {
        socket.emit('betError', { message: 'Aposta mínima: $5' });
        return;
      }
      
      player.betPlaced = true;
      saveUserBalance(player.username, player.balance);
      io.emit('gameState', gameState);
      io.emit('notification', { message: `✅ ${player.name} confirmou $${player.bet}!` });
      console.log(`✅ ${player.name} confirmou aposta de $${player.bet}`);
    }
  });
  
  // Limpar aposta
  socket.on('clearBet', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    
    if (player && gameState.status === 'betting' && !player.betPlaced) {
      player.balance += player.bet;
      player.bet = 0;
      io.emit('gameState', gameState);
      console.log(`🗑️ ${player.name} limpou a aposta`);
    }
  });
  
  function startGame() {
    if (gameState.status !== 'betting') return;
    
    gameState.status = 'playing';
    gameState.currentPlayer = 0;
    
    console.log('🎴 Distribuindo cartas...');
    
    gameState.players = gameState.players.map(p => {
      const card1 = gameState.deck.pop();
      const card2 = gameState.deck.pop();
      gameState.cardsUsed += 2;
      
      return {
        ...p,
        cards: [card1, card2],
        splitHand: null,
        busted: false,
        splitBusted: false,
        blackjack: false,
        standing: false,
        splitStanding: false,
        result: null,
        doubled: false,
        playingFirstHand: true
      };
    });
    
    gameState.players.forEach(p => {
      p.total = calculateTotal(p.cards);
      p.blackjack = p.total === 21;
      p.canSplit = canSplit(p) && p.balance >= p.bet;
      p.canDouble = p.balance >= p.bet;
      
      if (p.blackjack) {
        p.standing = true;
        p.canSplit = false;
        p.canDouble = false;
      }
    });
    
    const dealerCard1 = gameState.deck.pop();
    const dealerCard2 = { ...gameState.deck.pop(), hidden: true };
    gameState.cardsUsed += 2;
    
    gameState.dealer = {
      cards: [dealerCard1, dealerCard2],
      total: calculateTotal([dealerCard1])
    };
    
    io.emit('gameState', gameState);
    io.emit('notification', { message: '🎴 Cartas distribuídas!' });
    
    setTimeout(() => skipBlackjackPlayers(), 500);
  }
  
  function skipBlackjackPlayers() {
    while (gameState.currentPlayer < gameState.players.length && 
           gameState.players[gameState.currentPlayer].blackjack) {
      gameState.currentPlayer++;
    }
    
    if (gameState.currentPlayer >= gameState.players.length) {
      dealerPlay();
    } else {
      io.emit('gameState', gameState);
    }
  }
  
  // Split, Double, Hit, Stand (continuando na próxima mensagem devido ao limite de caracteres...)
  
  socket.on('split', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id && currentPlayer.canSplit && !currentPlayer.splitHand) {
      currentPlayer.splitHand = {
        cards: [currentPlayer.cards.pop()]
      };
      
      const newCard1 = gameState.deck.pop();
      const newCard2 = gameState.deck.pop();
      gameState.cardsUsed += 2;
      
      currentPlayer.cards.push(newCard1);
      currentPlayer.splitHand.cards.push(newCard2);
      
      currentPlayer.total = calculateTotal(currentPlayer.cards);
      currentPlayer.splitTotal = calculateTotal(currentPlayer.splitHand.cards);
      
      currentPlayer.balance -= currentPlayer.bet;
      saveUserBalance(currentPlayer.username, currentPlayer.balance);
      
      currentPlayer.canSplit = false;
      currentPlayer.canDouble = false;
      currentPlayer.playingFirstHand = true;
      
      io.emit('gameState', gameState);
      io.emit('notification', { message: `${currentPlayer.name} dividiu!` });
    }
  });
  
  socket.on('double', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id && currentPlayer.canDouble && 
        currentPlayer.cards.length === 2 && !currentPlayer.doubled && !currentPlayer.splitHand) {
      
      currentPlayer.balance -= currentPlayer.bet;
      currentPlayer.bet *= 2;
      currentPlayer.doubled = true;
      saveUserBalance(currentPlayer.username, currentPlayer.balance);
      
      const newCard = gameState.deck.pop();
      gameState.cardsUsed++;
      currentPlayer.cards.push(newCard);
      currentPlayer.total = calculateTotal(currentPlayer.cards);
      
      if (currentPlayer.total > 21) {
        currentPlayer.busted = true;
      }
      
      currentPlayer.standing = true;
      currentPlayer.canSplit = false;
      currentPlayer.canDouble = false;
      
      io.emit('gameState', gameState);
      io.emit('notification', { message: `${currentPlayer.name} dobrou!` });
      
      setTimeout(() => nextPlayer(), gameState.roundSpeed);
    }
  });
  
  socket.on('hit', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id) {
      const newCard = gameState.deck.pop();
      gameState.cardsUsed++;
      
      if (currentPlayer.splitHand && currentPlayer.playingFirstHand) {
        currentPlayer.cards.push(newCard);
        currentPlayer.total = calculateTotal(currentPlayer.cards);
        currentPlayer.canDouble = false;
        currentPlayer.canSplit = false;
        
        if (currentPlayer.total > 21) {
          currentPlayer.busted = true;
          currentPlayer.playingFirstHand = false;
          io.emit('gameState', gameState);
          io.emit('notification', { message: `MÃO 1 estourou!` });
          setTimeout(() => io.emit('gameState', gameState), 1000);
        } else {
          io.emit('gameState', gameState);
        }
      } else if (currentPlayer.splitHand && !currentPlayer.playingFirstHand) {
        currentPlayer.splitHand.cards.push(newCard);
        currentPlayer.splitTotal = calculateTotal(currentPlayer.splitHand.cards);
        
        if (currentPlayer.splitTotal > 21) {
          currentPlayer.splitBusted = true;
          io.emit('gameState', gameState);
          setTimeout(() => nextPlayer(), gameState.roundSpeed);
        } else {
          io.emit('gameState', gameState);
        }
      } else {
        currentPlayer.cards.push(newCard);
        currentPlayer.total = calculateTotal(currentPlayer.cards);
        currentPlayer.canDouble = false;
        currentPlayer.canSplit = false;
        
        if (currentPlayer.total > 21) {
          currentPlayer.busted = true;
          io.emit('gameState', gameState);
          setTimeout(() => nextPlayer(), gameState.roundSpeed);
        } else {
          io.emit('gameState', gameState);
        }
      }
    }
  });
  
  socket.on('stand', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id) {
      if (currentPlayer.splitHand && currentPlayer.playingFirstHand) {
        currentPlayer.playingFirstHand = false;
        io.emit('gameState', gameState);
        io.emit('notification', { message: `Jogando MÃO 2...` });
      } else if (currentPlayer.splitHand && !currentPlayer.playingFirstHand) {
        currentPlayer.splitStanding = true;
        currentPlayer.standing = true;
        io.emit('gameState', gameState);
        setTimeout(() => nextPlayer(), gameState.roundSpeed * 0.5);
      } else {
        currentPlayer.standing = true;
        io.emit('gameState', gameState);
        setTimeout(() => nextPlayer(), gameState.roundSpeed * 0.5);
      }
    }
  });
  
  function nextPlayer() {
    let next = gameState.currentPlayer + 1;
    
    while (next < gameState.players.length && 
           (gameState.players[next].standing || 
            gameState.players[next].busted || 
            gameState.players[next].blackjack)) {
      next++;
    }
    
    if (next < gameState.players.length) {
      gameState.currentPlayer = next;
      io.emit('gameState', gameState);
    } else {
      dealerPlay();
    }
  }
  
  function dealerPlay() {
    gameState.dealer.cards = gameState.dealer.cards.map(c => ({ ...c, hidden: false }));
    gameState.dealer.total = calculateTotal(gameState.dealer.cards);
    io.emit('gameState', gameState);
    
    setTimeout(() => {
      const dealerInterval = setInterval(() => {
        if (gameState.dealer.total < 17) {
          const newCard = gameState.deck.pop();
          gameState.cardsUsed++;
          
          gameState.dealer.cards.push(newCard);
          gameState.dealer.total = calculateTotal(gameState.dealer.cards);
          io.emit('gameState', gameState);
        } else {
          clearInterval(dealerInterval);
          setTimeout(() => determineWinners(), gameState.roundSpeed);
        }
      }, gameState.roundSpeed);
    }, gameState.roundSpeed);
  }
  
  function determineWinners() {
    const dealerTotal = gameState.dealer.total;
    
    console.log('🏆 Determinando vencedores...');
    
    gameState.players = gameState.players.map(p => {
      let newBalance = p.balance;
      let result = '';
      
      // Primeira mão
      let firstHandWin = 0;
      if (p.busted) {
        firstHandWin = 0;
      } else if (p.blackjack && dealerTotal !== 21) {
        firstHandWin = p.bet + Math.floor(p.bet * 1.5);
      } else if (dealerTotal > 21) {
        firstHandWin = p.bet * 2;
      } else if (p.total > dealerTotal) {
        firstHandWin = p.bet * 2;
      } else if (p.total === dealerTotal) {
        firstHandWin = p.bet;
      } else {
        firstHandWin = 0;
      }
      
      // Segunda mão (split)
      let secondHandWin = 0;
      if (p.splitHand) {
        if (p.splitBusted) {
          secondHandWin = 0;
        } else if (dealerTotal > 21) {
          secondHandWin = p.bet * 2;
        } else if (p.splitTotal > dealerTotal) {
          secondHandWin = p.bet * 2;
        } else if (p.splitTotal === dealerTotal) {
          secondHandWin = p.bet;
        } else {
          secondHandWin = 0;
        }
      }
      
      const totalWin = firstHandWin + secondHandWin;
      newBalance += totalWin;
      
      const betTotal = p.splitHand ? p.bet * 2 : p.bet;
      const profit = totalWin - betTotal;
      
      if (p.splitHand) {
        const h1Profit = firstHandWin - p.bet;
        const h2Profit = secondHandWin - p.bet;
        result = `M1: ${h1Profit >= 0 ? '+' : ''}$${h1Profit} | M2: ${h2Profit >= 0 ? '+' : ''}$${h2Profit}`;
      } else {
        if (profit > 0) {
          result = p.blackjack ? `🎰 BLACKJACK! +$${profit}` : `✅ GANHOU +$${profit}`;
        } else if (profit === 0 && !p.busted) {
          result = `⚪ EMPATE (devolveu $${p.bet})`;
        } else {
          result = `❌ PERDEU -$${betTotal}`;
        }
      }
      
      saveUserBalance(p.username, newBalance);
      
      console.log(`${p.name}: ${result} (Saldo: $${newBalance})`);
      
      return { ...p, balance: newBalance, result };
    });
    
    gameState.status = 'finished';
    io.emit('gameState', gameState);
  }
  
  socket.on('newRound', () => {
    if (gameState.status === 'finished') {
      // Manter jogadores mas resetar dados da rodada
      gameState.players = gameState.players.map(p => ({
        ...p,
        bet: 0,
        betPlaced: false,
        cards: [],
        splitHand: null,
        total: 0,
        splitTotal: 0,
        busted: false,
        splitBusted: false,
        blackjack: false,
        standing: false,
        splitStanding: false,
        result: null,
        doubled: false,
        canSplit: false,
        canDouble: false,
        playingFirstHand: true
      }));
      
      gameState.dealer = { cards: [], total: 0 };
      gameState.currentPlayer = 0;
      gameState.status = 'betting';
      gameState.bettingTimeLeft = 30;
      
      if (needsShuffle()) {
        gameState.deck = createDeck();
        gameState.cardsUsed = 0;
        io.emit('notification', { message: '🔀 Baralhos embaralhados!' });
      }
      
      io.emit('gameState', gameState);
      io.emit('notification', { message: '💰 Nova rodada! 30 segundos!' });
      
      // Reiniciar timer
      if (gameState.bettingTimer) {
        clearInterval(gameState.bettingTimer);
      }
      
      gameState.bettingTimer = setInterval(() => {
        gameState.bettingTimeLeft--;
        io.emit('bettingTimer', { timeLeft: gameState.bettingTimeLeft });
        
        if (gameState.bettingTimeLeft <= 0) {
          clearInterval(gameState.bettingTimer);
          
          const playersWhoBet = gameState.players.filter(p => p.betPlaced);
          const playersWhoDidnt = gameState.players.filter(p => !p.betPlaced);
          
          playersWhoDidnt.forEach(p => {
            if (p.bet > 0) {
              p.balance += p.bet;
              saveUserBalance(p.username, p.balance);
              p.bet = 0;
            }
          });
          
          gameState.players = playersWhoBet;
          
          if (gameState.players.length > 0) {
            setTimeout(() => startGame(), 2000);
          } else {
            gameState.status = 'lobby';
            io.emit('gameState', gameState);
          }
        }
      }, 1000);
    }
  });
  
  socket.on('leaveTable', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (player) {
      saveUserBalance(player.username, player.balance);
      gameState.players = gameState.players.filter(p => p.id !== socket.id);
      io.emit('gameState', gameState);
      io.emit('notification', { message: `${player.name} saiu` });
      console.log(`🚪 ${player.name} saiu. Saldo salvo: $${player.balance}`);
    }
  });
  
  socket.on('disconnect', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (player) {
      saveUserBalance(player.username, player.balance);
      io.emit('notification', { message: `${player.name} desconectou` });
      console.log(`❌ ${player.name} desconectou. Saldo salvo: $${player.balance}`);
    }
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    io.emit('gameState', gameState);
  });
});

server.listen(PORT, () => {
  console.log(`🎰 Servidor Blackjack rodando na porta ${PORT}`);
  console.log(`🌐 Acesse: http://localhost:${PORT}`);
  console.log(`🃏 6 baralhos (312 cartas)`);
});
