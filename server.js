// server.js - Servidor Node.js para Blackjack Multiplayer com Banco de Dados
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
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

app.use(express.static('public'));

// ===== BANCO DE DADOS =====
const db = new sqlite3.Database('./blackjack.db', (err) => {
  if (err) {
    console.error('❌ Erro ao conectar no banco de dados:', err);
  } else {
    console.log('✅ Banco de dados conectado!');
    initDatabase();
  }
});

// Criar tabelas
function initDatabase() {
  // Tabela de usuários
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      balance REAL DEFAULT 1000,
      total_wins INTEGER DEFAULT 0,
      total_losses INTEGER DEFAULT 0,
      total_games INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Erro ao criar tabela users:', err);
    else console.log('✅ Tabela users criada/verificada');
  });

  // Tabela de bônus diários
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_bonuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      last_bonus DATETIME DEFAULT CURRENT_TIMESTAMP,
      bonuses_today INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `, (err) => {
    if (err) console.error('Erro ao criar tabela daily_bonuses:', err);
    else console.log('✅ Tabela daily_bonuses criada/verificada');
  });

  // Tabela de histórico de jogos
  db.run(`
    CREATE TABLE IF NOT EXISTS game_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bet_amount REAL NOT NULL,
      win_amount REAL NOT NULL,
      result TEXT NOT NULL,
      cards TEXT,
      dealer_cards TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `, (err) => {
    if (err) console.error('Erro ao criar tabela game_history:', err);
    else console.log('✅ Tabela game_history criada/verificada');
  });
}

// ===== FUNÇÕES DO BANCO DE DADOS =====

// Criar novo usuário
function createUser(username, password, callback) {
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.run(
    'INSERT INTO users (username, password, balance) VALUES (?, ?, ?)',
    [username, hashedPassword, 1000],
    function(err) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, { id: this.lastID, username, balance: 1000 });
      }
    }
  );
}

// Buscar usuário
function getUser(username, callback) {
  db.get('SELECT * FROM users WHERE username = ?', [username], callback);
}

// Atualizar saldo
function updateBalance(username, newBalance, callback) {
  db.run(
    'UPDATE users SET balance = ? WHERE username = ?',
    [newBalance, username],
    callback
  );
}

// Atualizar último login
function updateLastLogin(username) {
  db.run(
    'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE username = ?',
    [username]
  );
}

// Salvar histórico de jogo
function saveGameHistory(username, betAmount, winAmount, result, cards, dealerCards) {
  db.get('SELECT id FROM users WHERE username = ?', [username], (err, user) => {
    if (!err && user) {
      db.run(
        'INSERT INTO game_history (user_id, bet_amount, win_amount, result, cards, dealer_cards) VALUES (?, ?, ?, ?, ?, ?)',
        [user.id, betAmount, winAmount, result, JSON.stringify(cards), JSON.stringify(dealerCards)]
      );
    }
  });
}

// Atualizar estatísticas
function updateStats(username, won) {
  db.run(`
    UPDATE users 
    SET total_games = total_games + 1,
        total_wins = total_wins + ?,
        total_losses = total_losses + ?
    WHERE username = ?
  `, [won ? 1 : 0, won ? 0 : 1, username]);
}

// Bônus diário
function checkDailyBonus(username, callback) {
  db.get('SELECT id FROM users WHERE username = ?', [username], (err, user) => {
    if (err || !user) return callback(err);
    
    db.get(
      'SELECT * FROM daily_bonuses WHERE user_id = ?',
      [user.id],
      (err, bonus) => {
        if (err) return callback(err);
        
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        
        if (!bonus) {
          // Primeiro bônus
          db.run(
            'INSERT INTO daily_bonuses (user_id, bonuses_today) VALUES (?, ?)',
            [user.id, 1],
            () => callback(null, { canClaim: true, remaining: 2 })
          );
        } else {
          const lastBonus = new Date(bonus.last_bonus).getTime();
          
          if (now - lastBonus < oneDay) {
            // Ainda no mesmo dia
            if (bonus.bonuses_today >= 3) {
              const timeLeft = oneDay - (now - lastBonus);
              const hours = Math.floor(timeLeft / (60 * 60 * 1000));
              const minutes = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
              callback(null, { canClaim: false, message: `Aguarde ${hours}h ${minutes}m` });
            } else {
              db.run(
                'UPDATE daily_bonuses SET bonuses_today = bonuses_today + 1, last_bonus = CURRENT_TIMESTAMP WHERE user_id = ?',
                [user.id],
                () => callback(null, { canClaim: true, remaining: 2 - bonus.bonuses_today })
              );
            }
          } else {
            // Novo dia
            db.run(
              'UPDATE daily_bonuses SET bonuses_today = 1, last_bonus = CURRENT_TIMESTAMP WHERE user_id = ?',
              [user.id],
              () => callback(null, { canClaim: true, remaining: 2 })
            );
          }
        }
      }
    );
  });
}

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

// ===== FUNÇÕES DO JOGO =====
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
  
  // LOGIN
  socket.on('login', (data) => {
    const { username, password } = data;
    
    console.log(`🔐 Tentativa de login: ${username}`);
    
    if (!username || !password) {
      socket.emit('loginError', { message: 'Usuário e senha obrigatórios!' });
      return;
    }
    
    getUser(username, (err, user) => {
      if (err) {
        socket.emit('loginError', { message: 'Erro no servidor!' });
        return;
      }
      
      if (user) {
        // Usuário existe - verificar senha
        if (bcrypt.compareSync(password, user.password)) {
          updateLastLogin(username);
          console.log(`✅ Login bem-sucedido: ${username}, Saldo: $${user.balance}`);
          socket.emit('loginSuccess', { 
            username: user.username, 
            balance: user.balance,
            stats: {
              totalGames: user.total_games,
              totalWins: user.total_wins,
              totalLosses: user.total_losses
            }
          });
        } else {
          console.log(`❌ Senha incorreta: ${username}`);
          socket.emit('loginError', { message: 'Senha incorreta!' });
        }
      } else {
        // Criar novo usuário
        createUser(username, password, (err, newUser) => {
          if (err) {
            socket.emit('loginError', { message: 'Erro ao criar usuário!' });
          } else {
            console.log(`🆕 Novo usuário: ${username} com $1000`);
            socket.emit('loginSuccess', { 
              username: newUser.username, 
              balance: newUser.balance,
              stats: { totalGames: 0, totalWins: 0, totalLosses: 0 }
            });
          }
        });
      }
    });
  });
  
  // BÔNUS DIÁRIO
  socket.on('claimDailyBonus', (data) => {
    const { username } = data;
    
    checkDailyBonus(username, (err, result) => {
      if (err) {
        socket.emit('bonusError', { message: 'Erro ao resgatar bônus!' });
        return;
      }
      
      if (!result.canClaim) {
        socket.emit('bonusError', { message: result.message });
        return;
      }
      
      getUser(username, (err, user) => {
        if (err || !user) return;
        
        const bonusAmount = 500;
        const newBalance = user.balance + bonusAmount;
        
        updateBalance(username, newBalance, () => {
          socket.emit('bonusSuccess', { 
            amount: bonusAmount, 
            newBalance: newBalance,
            remaining: result.remaining
          });
          
          // Atualizar jogador na mesa
          const player = gameState.players.find(p => p.username === username);
          if (player) {
            player.balance = newBalance;
            io.emit('gameState', gameState);
          }
          
          console.log(`🎁 ${username} ganhou $${bonusAmount}. Novo saldo: $${newBalance}`);
        });
      });
    });
  });
  
  // ADICIONAR JOGADOR
  socket.on('addPlayer', (data) => {
    if (gameState.players.length < 7 && gameState.status === 'lobby') {
      getUser(data.username, (err, user) => {
        if (err || !user) return;
        
        const player = {
          id: socket.id,
          name: data.name,
          username: data.username,
          balance: user.balance,
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
        io.emit('notification', { message: `${data.name} entrou!` });
        console.log(`👤 ${data.name} entrou com $${user.balance}`);
      });
    }
  });
  
  // INICIAR APOSTAS
  socket.on('startBetting', () => {
    if (gameState.players.length > 0 && gameState.status === 'lobby') {
      if (gameState.deck.length === 0 || needsShuffle()) {
        gameState.deck = createDeck();
        gameState.cardsUsed = 0;
        io.emit('notification', { message: '🔀 Baralhos embaralhados!' });
      }
      
      gameState.status = 'betting';
      gameState.bettingTimeLeft = 30;
      
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
  
  // APOSTAR
  socket.on('placeBet', (data) => {
    const player = gameState.players.find(p => p.id === socket.id);
    
    if (player && gameState.status === 'betting' && !player.betPlaced) {
      const betAmount = parseInt(data.amount);
      
      console.log(`💵 ${player.name} clicou na ficha de $${betAmount}`);
      
      if (betAmount < 5 || betAmount > 500 || betAmount > player.balance || player.bet + betAmount > 500) {
        socket.emit('betError', { message: 'Aposta inválida!' });
        return;
      }
      
      player.bet += betAmount;
      player.balance -= betAmount;
      
      console.log(`✅ ${player.name} apostou $${betAmount}. Total: $${player.bet}`);
      
      io.emit('gameState', gameState);
    }
  });
  
  // CONFIRMAR APOSTA
  socket.on('confirmBet', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    
    if (player && gameState.status === 'betting' && !player.betPlaced && player.bet >= 5) {
      player.betPlaced = true;
      updateBalance(player.username, player.balance);
      io.emit('gameState', gameState);
      io.emit('notification', { message: `✅ ${player.name} confirmou $${player.bet}!` });
    }
  });
  
  // LIMPAR APOSTA
  socket.on('clearBet', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    
    if (player && gameState.status === 'betting' && !player.betPlaced) {
      player.balance += player.bet;
      player.bet = 0;
      io.emit('gameState', gameState);
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
  
  // HIT, STAND, SPLIT, DOUBLE (continuando...)
  socket.on('hit', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id) {
      const newCard = gameState.deck.pop();
      gameState.cardsUsed++;
      
      if (currentPlayer.splitHand && currentPlayer.playingFirstHand) {
        currentPlayer.cards.push(newCard);
        currentPlayer.total = calculateTotal(currentPlayer.cards);
        
        if (currentPlayer.total > 21) {
          currentPlayer.busted = true;
          currentPlayer.playingFirstHand = false;
          io.emit('gameState', gameState);
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
      } else {
        currentPlayer.standing = true;
        io.emit('gameState', gameState);
        setTimeout(() => nextPlayer(), gameState.roundSpeed * 0.5);
      }
    }
  });
  
  socket.on('split', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id && currentPlayer.canSplit) {
      currentPlayer.splitHand = { cards: [currentPlayer.cards.pop()] };
      
      const newCard1 = gameState.deck.pop();
      const newCard2 = gameState.deck.pop();
      gameState.cardsUsed += 2;
      
      currentPlayer.cards.push(newCard1);
      currentPlayer.splitHand.cards.push(newCard2);
      
      currentPlayer.total = calculateTotal(currentPlayer.cards);
      currentPlayer.splitTotal = calculateTotal(currentPlayer.splitHand.cards);
      
      currentPlayer.balance -= currentPlayer.bet;
      updateBalance(currentPlayer.username, currentPlayer.balance);
      
      currentPlayer.canSplit = false;
      currentPlayer.canDouble = false;
      currentPlayer.playingFirstHand = true;
      
      io.emit('gameState', gameState);
    }
  });
  
  socket.on('double', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id && currentPlayer.canDouble) {
      currentPlayer.balance -= currentPlayer.bet;
      currentPlayer.bet *= 2;
      currentPlayer.doubled = true;
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
    
    console.log('🏆 Determinando vencedores...');
    
    gameState.players = gameState.players.map(p => {
      let newBalance = p.balance;
      let result = '';
      let winAmount = 0;
      
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
      winAmount = profit;
      
      if (p.splitHand) {
        result = `M1: ${(firstHandWin - p.bet) >= 0 ? '+' : ''}$${firstHandWin - p.bet} | M2: ${(secondHandWin - p.bet) >= 0 ? '+' : ''}$${secondHandWin - p.bet}`;
      } else {
        if (profit > 0) {
          result = p.blackjack ? `🎰 BLACKJACK! +$${profit}` : `✅ GANHOU +$${profit}`;
        } else if (profit === 0 && !p.busted) {
          result = `⚪ EMPATE (devolveu $${p.bet})`;
        } else {
          result = `❌ PERDEU -$${betTotal}`;
        }
      }
      
      // Salvar no banco de dados
      updateBalance(p.username, newBalance);
      updateStats(p.username, profit > 0);
      saveGameHistory(p.username, betTotal, profit, result, p.cards, gameState.dealer.cards);
      
      console.log(`${p.name}: ${result} (Saldo: $${newBalance})`);
      
      return { ...p, balance: newBalance, result, lastWin: profit };
    });
    
    gameState.status = 'finished';
    io.emit('gameState', gameState);
  }
  
  socket.on('newRound', () => {
    if (gameState.status === 'finished') {
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
