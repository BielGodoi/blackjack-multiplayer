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

// Estado do jogo
let gameState = {
  players: [],
  dealer: { cards: [], total: 0 },
  deck: [],
  currentPlayer: 0,
  status: 'lobby', // lobby, playing, finished
  roomCode: 'BLACKJACK'
};

// Criar baralho
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

// Calcular total
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

// Conexão de jogadores
io.on('connection', (socket) => {
  console.log('Novo jogador conectado:', socket.id);
  
  // Enviar estado atual
  socket.emit('gameState', gameState);
  
  // Adicionar jogador
  socket.on('addPlayer', (data) => {
    if (gameState.players.length < 7 && gameState.status === 'lobby') {
      const player = {
        id: socket.id,
        name: data.name,
        bet: data.bet,
        balance: 1000,
        cards: [],
        total: 0,
        busted: false,
        blackjack: false,
        standing: false,
        result: null
      };
      
      gameState.players.push(player);
      io.emit('gameState', gameState);
      io.emit('playerJoined', { name: data.name });
    }
  });
  
  // Iniciar jogo
  socket.on('startGame', () => {
    if (gameState.players.length > 0 && gameState.status === 'lobby') {
      gameState.deck = createDeck();
      gameState.status = 'playing';
      gameState.currentPlayer = 0;
      
      // Distribuir cartas
      gameState.players = gameState.players.map(p => ({
        ...p,
        cards: [gameState.deck.pop(), gameState.deck.pop()],
        busted: false,
        blackjack: false,
        standing: false,
        result: null
      }));
      
      gameState.players.forEach(p => {
        p.total = calculateTotal(p.cards);
        p.blackjack = p.total === 21;
        if (p.blackjack) p.standing = true;
      });
      
      // Cartas do dealer
      gameState.dealer = {
        cards: [gameState.deck.pop(), { ...gameState.deck.pop(), hidden: true }],
        total: 0
      };
      gameState.dealer.total = calculateTotal([gameState.dealer.cards[0]]);
      
      io.emit('gameState', gameState);
    }
  });
  
  // Pedir carta
  socket.on('hit', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id && !currentPlayer.standing && !currentPlayer.busted) {
      const newCard = gameState.deck.pop();
      currentPlayer.cards.push(newCard);
      currentPlayer.total = calculateTotal(currentPlayer.cards);
      
      if (currentPlayer.total > 21) {
        currentPlayer.busted = true;
        setTimeout(() => nextPlayer(), 1500);
      }
      
      io.emit('gameState', gameState);
    }
  });
  
  // Parar
  socket.on('stand', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id) {
      currentPlayer.standing = true;
      io.emit('gameState', gameState);
      setTimeout(() => nextPlayer(), 800);
    }
  });
  
  // Próximo jogador
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
  
  // Dealer joga
  function dealerPlay() {
    gameState.dealer.cards = gameState.dealer.cards.map(c => ({ ...c, hidden: false }));
    gameState.dealer.total = calculateTotal(gameState.dealer.cards);
    io.emit('gameState', gameState);
    
    const dealerInterval = setInterval(() => {
      if (gameState.dealer.total < 17) {
        const newCard = gameState.deck.pop();
        gameState.dealer.cards.push(newCard);
        gameState.dealer.total = calculateTotal(gameState.dealer.cards);
        io.emit('gameState', gameState);
      } else {
        clearInterval(dealerInterval);
        setTimeout(() => determineWinners(), 1500);
      }
    }, 1200);
  }
  
  // Determinar vencedores
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
      
      return { ...p, balance: newBalance, result };
    });
    
    gameState.status = 'finished';
    io.emit('gameState', gameState);
  }
  
  // Reset jogo
  socket.on('resetGame', () => {
    gameState.players = gameState.players.map(p => ({
      ...p,
      cards: [],
      total: 0,
      busted: false,
      blackjack: false,
      standing: false,
      result: null
    }));
    gameState.dealer = { cards: [], total: 0 };
    gameState.currentPlayer = 0;
    gameState.status = 'lobby';
    io.emit('gameState', gameState);
  });
  
  // Desconexão
  socket.on('disconnect', () => {
    console.log('Jogador desconectado:', socket.id);
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    io.emit('gameState', gameState);
  });
});

server.listen(PORT, () => {
  console.log(`🎰 Servidor Blackjack rodando na porta ${PORT}`);
  console.log(`🌐 Acesse: http://localhost:${PORT}`);
});