// server.js - Servidor Node.js para Blackjack Multiplayer
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Servir arquivos estáticos
app.use(express.static('public'));

// Banco de dados simples em memória (em produção, use MongoDB ou PostgreSQL)
const users = new Map(); // username -> { password, balance }

// Estado do jogo
let gameState = {
  players: [],
  dealer: { cards: [], total: 0 },
  deck: [],
  totalCards: 312,
  cardsUsed: 0,
  currentPlayer: 0,
  status: 'lobby', // lobby, betting, playing, finished
  roundSpeed: 2000 // Velocidade das animações (2 segundos)
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

// Verificar se pode dividir (split)
function canSplit(player) {
  if (player.cards.length !== 2) return false;
  const card1 = player.cards[0].value;
  const card2 = player.cards[1].value;
  
  // Verificar se são cartas do mesmo valor
  if (card1 === card2) return true;
  
  // Verificar se ambas são figuras (J, Q, K valem 10)
  const figures = ['J', 'Q', 'K', '10'];
  if (figures.includes(card1) && figures.includes(card2)) return true;
  
  return false;
}

io.on('connection', (socket) => {
  console.log('Novo jogador conectado:', socket.id);
  
  socket.emit('gameState', gameState);
  
  // Login
  socket.on('login', (data) => {
    const { username, password } = data;
    
    if (!username || !password) {
      socket.emit('loginError', { message: 'Usuário e senha são obrigatórios!' });
      return;
    }
    
    if (users.has(username)) {
      // Verificar senha
      const user = users.get(username);
      if (user.password === password) {
        socket.emit('loginSuccess', { username, balance: user.balance });
      } else {
        socket.emit('loginError', { message: 'Senha incorreta!' });
      }
    } else {
      // Criar novo usuário
      users.set(username, { password, balance: 1000 });
      socket.emit('loginSuccess', { username, balance: 1000 });
    }
  });
  
  // Adicionar jogador
  socket.on('addPlayer', (data) => {
    if (gameState.players.length < 7) {
      // Recuperar saldo do usuário
      const user = users.get(data.username);
      const balance = user ? user.balance : 1000;
      
      const player = {
        id: socket.id,
        name: data.name,
        username: data.username,
        balance: balance,
        bet: 0,
        cards: [],
        splitHand: null, // Para mão dividida
        total: 0,
        busted: false,
        blackjack: false,
        standing: false,
        result: null,
        betPlaced: false,
        doubled: false,
        canSplit: false,
        canDouble: false
      };
      
      gameState.players.push(player);
      io.emit('gameState', gameState);
      io.emit('notification', { message: `${data.name} entrou na mesa!` });
    }
  });
  
  // Iniciar fase de apostas
  socket.on('startBetting', () => {
    if (gameState.players.length > 0) {
      if (gameState.deck.length === 0 || needsShuffle()) {
        gameState.deck = createDeck();
        gameState.cardsUsed = 0;
        io.emit('notification', { message: '🔀 Baralhos embaralhados! (6 baralhos)' });
      }
      
      gameState.status = 'betting';
      gameState.players.forEach(p => {
        p.bet = 0;
        p.betPlaced = false;
        p.cards = [];
        p.splitHand = null;
        p.busted = false;
        p.blackjack = false;
        p.standing = false;
        p.result = null;
        p.doubled = false;
        p.canSplit = false;
        p.canDouble = false;
      });
      io.emit('gameState', gameState);
      io.emit('notification', { message: '💰 Façam suas apostas!' });
    }
  });
  
  // Fazer aposta
  socket.on('placeBet', (data) => {
    const player = gameState.players.find(p => p.id === socket.id);
    
    if (player && gameState.status === 'betting' && !player.betPlaced) {
      const betAmount = parseInt(data.amount);
      
      if (betAmount >= 5 && betAmount <= player.balance) {
        player.bet = betAmount;
        player.betPlaced = true;
        io.emit('gameState', gameState);
        io.emit('notification', { message: `${player.name} apostou $${betAmount}` });
        
        const allBetsPlaced = gameState.players.every(p => p.betPlaced);
        if (allBetsPlaced) {
          setTimeout(() => startGame(), gameState.roundSpeed);
        }
      }
    }
  });
  
  function startGame() {
    if (gameState.status !== 'betting') return;
    
    gameState.status = 'playing';
    gameState.currentPlayer = 0;
    
    // Distribuir cartas
    gameState.players = gameState.players.map(p => {
      const card1 = gameState.deck.pop();
      const card2 = gameState.deck.pop();
      gameState.cardsUsed += 2;
      
      return {
        ...p,
        cards: [card1, card2],
        splitHand: null,
        busted: false,
        blackjack: false,
        standing: false,
        result: null,
        doubled: false
      };
    });
    
    gameState.players.forEach(p => {
      p.total = calculateTotal(p.cards);
      p.blackjack = p.total === 21;
      p.canSplit = canSplit(p) && p.balance >= p.bet;
      p.canDouble = p.balance >= p.bet;
      
      // Se tiver blackjack, não pula a vez ainda (jogador pode ter split)
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
    
    if (needsShuffle()) {
      io.emit('notification', { message: '⚠️ Próxima rodada: Baralhos serão embaralhados!' });
    }
    
    // Avançar para o próximo jogador se o atual tiver blackjack
    setTimeout(() => skipBlackjackPlayers(), 500);
  }
  
  // Pular jogadores com blackjack automaticamente
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
  
  // Dividir (Split)
  socket.on('split', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id && currentPlayer.canSplit && !currentPlayer.splitHand) {
      // Criar segunda mão
      currentPlayer.splitHand = {
        cards: [currentPlayer.cards.pop()],
        total: 0,
        busted: false,
        standing: false
      };
      
      // Adicionar carta em cada mão
      const newCard1 = gameState.deck.pop();
      const newCard2 = gameState.deck.pop();
      gameState.cardsUsed += 2;
      
      currentPlayer.cards.push(newCard1);
      currentPlayer.splitHand.cards.push(newCard2);
      
      currentPlayer.total = calculateTotal(currentPlayer.cards);
      currentPlayer.splitHand.total = calculateTotal(currentPlayer.splitHand.cards);
      
      // Duplicar aposta
      currentPlayer.balance -= currentPlayer.bet;
      
      currentPlayer.canSplit = false;
      currentPlayer.canDouble = false;
      
      io.emit('gameState', gameState);
      io.emit('notification', { message: `${currentPlayer.name} dividiu a mão!` });
    }
  });
  
  // Dobrar (Double)
  socket.on('double', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id && currentPlayer.canDouble && 
        currentPlayer.cards.length === 2 && !currentPlayer.doubled) {
      
      // Duplicar aposta
      currentPlayer.balance -= currentPlayer.bet;
      currentPlayer.bet *= 2;
      currentPlayer.doubled = true;
      
      // Receber apenas mais uma carta
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
      io.emit('notification', { message: `${currentPlayer.name} dobrou a aposta!` });
      
      setTimeout(() => nextPlayer(), gameState.roundSpeed);
    }
  });
  
  // Pedir carta
  socket.on('hit', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id && !currentPlayer.standing && !currentPlayer.busted) {
      const newCard = gameState.deck.pop();
      gameState.cardsUsed++;
      
      currentPlayer.cards.push(newCard);
      currentPlayer.total = calculateTotal(currentPlayer.cards);
      currentPlayer.canDouble = false;
      currentPlayer.canSplit = false;
      
      if (currentPlayer.total > 21) {
        currentPlayer.busted = true;
        
        // Se tiver mão dividida, jogar ela
        if (currentPlayer.splitHand && !currentPlayer.splitHand.standing) {
          io.emit('gameState', gameState);
          io.emit('notification', { message: `Jogando segunda mão...` });
          setTimeout(() => {}, 500);
        } else {
          setTimeout(() => nextPlayer(), gameState.roundSpeed);
        }
      }
      
      io.emit('gameState', gameState);
    }
  });
  
  // Parar
  socket.on('stand', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id) {
      currentPlayer.standing = true;
      
      // Se tiver mão dividida e ainda não jogou ela
      if (currentPlayer.splitHand && !currentPlayer.splitHand.standing) {
        io.emit('gameState', gameState);
        io.emit('notification', { message: `Jogando segunda mão...` });
      } else {
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
    
    gameState.players = gameState.players.map(p => {
      let newBalance = p.balance;
      let result = '';
      
      if (p.busted) {
        newBalance -= p.bet;
        result = `PERDEU -$${p.bet}`;
      } else if (p.blackjack && dealerTotal !== 21) {
        const win = Math.floor(p.bet * 1.5);
        newBalance += win;
        result = `BLACKJACK! +$${win}`;
      } else if (dealerTotal > 21) {
        newBalance += p.bet;
        result = `GANHOU! +$${p.bet}`;
      } else if (p.total > dealerTotal) {
        newBalance += p.bet;
        result = `GANHOU! +$${p.bet}`;
      } else if (p.total === dealerTotal) {
        result = 'EMPATE $0';
      } else {
        newBalance -= p.bet;
        result = `PERDEU -$${p.bet}`;
      }
      
      // Salvar saldo no "banco de dados"
      if (users.has(p.username)) {
        users.get(p.username).balance = newBalance;
      }
      
      return { ...p, balance: newBalance, result };
    });
    
    gameState.status = 'finished';
    io.emit('gameState', gameState);
  }
  
  // Nova rodada (infinitas rodadas)
  socket.on('newRound', () => {
    if (gameState.status === 'finished') {
      // Manter jogadores e saldos
      gameState.players = gameState.players.map(p => ({
        ...p,
        bet: 0,
        betPlaced: false,
        cards: [],
        splitHand: null,
        total: 0,
        busted: false,
        blackjack: false,
        standing: false,
        result: null,
        doubled: false,
        canSplit: false,
        canDouble: false
      }));
      
      gameState.dealer = { cards: [], total: 0 };
      gameState.currentPlayer = 0;
      gameState.status = 'betting';
      
      if (needsShuffle()) {
        gameState.deck = createDeck();
        gameState.cardsUsed = 0;
        io.emit('notification', { message: '🔀 Baralhos embaralhados!' });
      }
      
      io.emit('gameState', gameState);
      io.emit('notification', { message: '💰 Nova rodada! Façam suas apostas!' });
    }
  });
  
  // Sair da mesa
  socket.on('leaveTable', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (player) {
      // Salvar saldo final
      if (users.has(player.username)) {
        users.get(player.username).balance = player.balance;
      }
      gameState.players = gameState.players.filter(p => p.id !== socket.id);
      io.emit('gameState', gameState);
      io.emit('notification', { message: `${player.name} saiu da mesa` });
    }
  });
  
  socket.on('disconnect', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (player) {
      if (users.has(player.username)) {
        users.get(player.username).balance = player.balance;
      }
      io.emit('notification', { message: `${player.name} desconectou` });
    }
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    io.emit('gameState', gameState);
  });
});

server.listen(PORT, () => {
  console.log(`🎰 Servidor Blackjack rodando na porta ${PORT}`);
  console.log(`🌐 Acesse: http://localhost:${PORT}`);
  console.log(`🃏 6 baralhos (312 cartas) - Reembaralha aos 50%`);
});
