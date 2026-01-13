// server.js - BACKEND PURO (SEM JSX)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Servir arquivos estáticos da pasta 'public'
app.use(express.static('public'));

// ===== BANCO DE DADOS JSON =====
const DB_FILE = path.join(__dirname, 'database.json');

let database = {
  users: {},
  dailyBonuses: {},
  gameHistory: []
};

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      database = JSON.parse(data);
      console.log('✅ Banco de dados carregado!');
    } else {
      saveDatabase();
      console.log('✅ Novo banco de dados criado!');
    }
  } catch (err) {
    console.error('❌ Erro ao carregar banco:', err);
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(database, null, 2));
  } catch (err) {
    console.error('❌ Erro ao salvar banco:', err);
  }
}

function authenticateUser(username, password) {
  if (database.users[username]) {
    if (bcrypt.compareSync(password, database.users[username].password)) {
      database.users[username].lastLogin = new Date().toISOString();
      saveDatabase();
      return { success: true, user: database.users[username] };
    } else {
      return { success: false, message: 'Senha incorreta!' };
    }
  } else {
    const hashedPassword = bcrypt.hashSync(password, 10);
    database.users[username] = {
      username: username,
      password: hashedPassword,
      balance: 1000,
      totalWins: 0,
      totalLosses: 0,
      totalGames: 0,
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    saveDatabase();
    console.log(`🆕 Novo usuário: ${username} com $1000`);
    return { success: true, user: database.users[username] };
  }
}

function updateBalance(username, newBalance) {
  if (database.users[username]) {
    database.users[username].balance = newBalance;
    saveDatabase();
  }
}

function updateStats(username, won) {
  if (database.users[username]) {
    database.users[username].totalGames++;
    if (won) {
      database.users[username].totalWins++;
    } else {
      database.users[username].totalLosses++;
    }
    saveDatabase();
  }
}

function checkDailyBonus(username) {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  
  if (!database.dailyBonuses[username]) {
    database.dailyBonuses[username] = {
      lastBonus: now,
      bonusesToday: 1
    };
    saveDatabase();
    return { canClaim: true, remaining: 2 };
  }
  
  const bonus = database.dailyBonuses[username];
  const timeSinceLastBonus = now - bonus.lastBonus;
  
  if (timeSinceLastBonus < oneDay) {
    if (bonus.bonusesToday >= 3) {
      const timeLeft = oneDay - timeSinceLastBonus;
      const hours = Math.floor(timeLeft / (60 * 60 * 1000));
      const minutes = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
      return { canClaim: false, message: `Aguarde ${hours}h ${minutes}m` };
    } else {
      bonus.bonusesToday++;
      bonus.lastBonus = now;
      saveDatabase();
      return { canClaim: true, remaining: 3 - bonus.bonusesToday };
    }
  } else {
    bonus.bonusesToday = 1;
    bonus.lastBonus = now;
    saveDatabase();
    return { canClaim: true, remaining: 2 };
  }
}

loadDatabase();

// ===== ESTADO DO JOGO =====
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

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  console.log('✅ Jogador conectado:', socket.id);
  
  socket.emit('gameState', gameState);
  
  socket.on('login', (data) => {
    const { username, password } = data;
    
    if (!username || !password) {
      socket.emit('loginError', { message: 'Usuário e senha obrigatórios!' });
      return;
    }
    
    const result = authenticateUser(username, password);
    
    if (result.success) {
      socket.emit('loginSuccess', { 
        username: result.user.username, 
        balance: result.user.balance,
        stats: {
          totalGames: result.user.totalGames,
          totalWins: result.user.totalWins,
          totalLosses: result.user.totalLosses
        }
      });
    } else {
      socket.emit('loginError', { message: result.message });
    }
  });
  
  socket.on('claimDailyBonus', (data) => {
    const { username } = data;
    const result = checkDailyBonus(username);
    
    if (!result.canClaim) {
      socket.emit('bonusError', { message: result.message });
      return;
    }
    
    if (database.users[username]) {
      const bonusAmount = 500;
      const newBalance = database.users[username].balance + bonusAmount;
      
      updateBalance(username, newBalance);
      
      socket.emit('bonusSuccess', { 
        amount: bonusAmount, 
        newBalance: newBalance,
        remaining: result.remaining
      });
      
      const player = gameState.players.find(p => p.username === username);
      if (player) {
        player.balance = newBalance;
        io.emit('gameState', gameState);
      }
    }
  });
  
  socket.on('addPlayer', (data) => {
    if (gameState.players.length < 7 && gameState.status === 'lobby') {
      if (database.users[data.username]) {
        const user = database.users[data.username];
        
        const player = {
          id: socket.id,
          name: data.name,
          username: data.username,
          balance: user.balance,
          bet: 0,
          cards: [],
          total: 0,
          busted: false,
          blackjack: false,
          standing: false,
          result: null,
          lastWin: 0,
          betPlaced: false,
          canSplit: false,
          canDouble: false
        };
        
        gameState.players.push(player);
        io.emit('gameState', gameState);
        io.emit('notification', { message: `${data.name} entrou!` });
      }
    }
  });
  
  socket.on('startBetting', () => {
    if (gameState.players.length > 0 && gameState.status === 'lobby') {
      if (gameState.deck.length === 0 || needsShuffle()) {
        gameState.deck = createDeck();
        gameState.cardsUsed = 0;
      }
      
      gameState.status = 'betting';
      gameState.bettingTimeLeft = 30;
      
      gameState.players.forEach(p => {
        p.bet = 0;
        p.betPlaced = false;
        p.cards = [];
        p.busted = false;
        p.blackjack = false;
        p.standing = false;
        p.result = null;
        p.canSplit = false;
        p.canDouble = false;
      });
      
      io.emit('gameState', gameState);
      
      if (gameState.bettingTimer) clearInterval(gameState.bettingTimer);
      
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
              updateBalance(p.username, p.balance);
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
  
  socket.on('placeBet', (data) => {
    const player = gameState.players.find(p => p.id === socket.id);
    
    if (player && gameState.status === 'betting' && !player.betPlaced) {
      const betAmount = parseInt(data.amount);
      
      if (isNaN(betAmount) || betAmount <= 0) {
        socket.emit('betError', { message: 'Valor inválido!' });
        return;
      }
      
      if (betAmount > player.balance) {
        socket.emit('betError', { message: 'Saldo insuficiente!' });
        return;
      }
      
      if (player.bet + betAmount > 500) {
        socket.emit('betError', { message: 'Aposta máxima: $500' });
        return;
      }
      
      player.bet += betAmount;
      player.balance -= betAmount;
      
      io.emit('gameState', gameState);
    }
  });
  
  socket.on('confirmBet', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    
    if (player && gameState.status === 'betting' && !player.betPlaced) {
      if (player.bet < 5) {
        socket.emit('betError', { message: 'Aposta mínima: $5' });
        return;
      }
      
      player.betPlaced = true;
      updateBalance(player.username, player.balance);
      io.emit('gameState', gameState);
      io.emit('notification', { message: `✅ ${player.name} confirmou!` });
    }
  });
  
  socket.on('clearBet', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    
    if (player && gameState.status === 'betting' && !player.betPlaced) {
      player.balance += player.bet;
      player.bet = 0;
      io.emit('gameState', gameState);
    }
  });
  
  function startGame() {
    gameState.status = 'playing';
    gameState.currentPlayer = 0;
    
    gameState.players.forEach(p => {
      const card1 = gameState.deck.pop();
      const card2 = gameState.deck.pop();
      gameState.cardsUsed += 2;
      
      p.cards = [card1, card2];
      p.total = calculateTotal(p.cards);
      p.blackjack = p.total === 21;
      p.canSplit = canSplit(p) && p.balance >= p.bet;
      p.canDouble = p.balance >= p.bet;
      
      if (p.blackjack) {
        p.standing = true;
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
  
  socket.on('hit', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id) {
      const newCard = gameState.deck.pop();
      gameState.cardsUsed++;
      
      currentPlayer.cards.push(newCard);
      currentPlayer.total = calculateTotal(currentPlayer.cards);
      
      if (currentPlayer.total > 21) {
        currentPlayer.busted = true;
        io.emit('gameState', gameState);
        setTimeout(() => nextPlayer(), gameState.roundSpeed);
      } else {
        io.emit('gameState', gameState);
      }
    }
  });
  
  socket.on('stand', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id) {
      currentPlayer.standing = true;
      io.emit('gameState', gameState);
      setTimeout(() => nextPlayer(), gameState.roundSpeed * 0.5);
    }
  });
  
  socket.on('double', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id && currentPlayer.canDouble) {
      currentPlayer.balance -= currentPlayer.bet;
      currentPlayer.bet *= 2;
      updateBalance(currentPlayer.username, currentPlayer.balance);
      
      const newCard = gameState.deck.pop();
      gameState.cardsUsed++;
      currentPlayer.cards.push(newCard);
      currentPlayer.total = calculateTotal(currentPlayer.cards);
      
      if (currentPlayer.total > 21) {
        currentPlayer.busted = true;
      }
      
      currentPlayer.standing = true;
      io.emit('gameState', gameState);
      setTimeout(() => nextPlayer(), gameState.roundSpeed);
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
    
    gameState.players.forEach(p => {
      let newBalance = p.balance;
      let winAmount = 0;
      
      if (p.busted) {
        winAmount = 0;
      } else if (p.blackjack && dealerTotal !== 21) {
        winAmount = p.bet + Math.floor(p.bet * 1.5);
      } else if (dealerTotal > 21) {
        winAmount = p.bet * 2;
      } else if (p.total > dealerTotal) {
        winAmount = p.bet * 2;
      } else if (p.total === dealerTotal) {
        winAmount = p.bet;
      }
      
      newBalance += winAmount;
      const profit = winAmount - p.bet;
      
      if (profit > 0) {
        p.result = p.blackjack ? `🎰 BLACKJACK! +$${profit}` : `✅ GANHOU +$${profit}`;
      } else if (profit === 0 && !p.busted) {
        p.result = `⚪ EMPATE`;
      } else {
        p.result = `❌ PERDEU -$${p.bet}`;
      }
      
      p.balance = newBalance;
      p.lastWin = Math.max(0, profit);
      
      updateBalance(p.username, newBalance);
      updateStats(p.username, profit > 0);
    });
    
    gameState.status = 'finished';
    io.emit('gameState', gameState);
  }
  
  socket.on('newRound', () => {
    if (gameState.status === 'finished') {
      gameState.players.forEach(p => {
        p.bet = 0;
        p.betPlaced = false;
        p.cards = [];
        p.total = 0;
        p.busted = false;
        p.blackjack = false;
        p.standing = false;
        p.result = null;
        p.canSplit = false;
        p.canDouble = false;
      });
      
      gameState.dealer = { cards: [], total: 0 };
      gameState.currentPlayer = 0;
      gameState.status = 'betting';
      gameState.bettingTimeLeft = 30;
      
      if (needsShuffle()) {
        gameState.deck = createDeck();
        gameState.cardsUsed = 0;
      }
      
      io.emit('gameState', gameState);
      
      if (gameState.bettingTimer) clearInterval(gameState.bettingTimer);
      
      gameState.bettingTimer = setInterval(() => {
        gameState.bettingTimeLeft--;
        io.emit('bettingTimer', { timeLeft: gameState.bettingTimeLeft });
        
        if (gameState.bettingTimeLeft <= 0) {
          clearInterval(gameState.bettingTimer);
          
          const playersWhoBet = gameState.players.filter(p => p.betPlaced);
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
      updateBalance(player.username, player.balance);
      gameState.players = gameState.players.filter(p => p.id !== socket.id);
      io.emit('gameState', gameState);
    }
  });
  
  socket.on('disconnect', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (player) {
      updateBalance(player.username, player.balance);
    }
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    io.emit('gameState', gameState);
  });
});

server.listen(PORT, () => {
  console.log(`🎰 Servidor rodando na porta ${PORT}`);
  console.log(`💾 Banco de dados: database.json`);
});
