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

app.use(express.static('public'));

const users = new Map();

let gameState = {
  players: [],
  dealer: { cards: [], total: 0 },
  deck: [],
  totalCards: 312,
  cardsUsed: 0,
  currentPlayer: 0,
  status: 'lobby',
  roundSpeed: 2000
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

io.on('connection', (socket) => {
  console.log('Novo jogador conectado:', socket.id);
  
  socket.emit('gameState', gameState);
  
  socket.on('login', (data) => {
    const { username, password } = data;
    
    if (!username || !password) {
      socket.emit('loginError', { message: 'Usuário e senha são obrigatórios!' });
      return;
    }
    
    if (users.has(username)) {
      const user = users.get(username);
      if (user.password === password) {
        socket.emit('loginSuccess', { username, balance: user.balance });
      } else {
        socket.emit('loginError', { message: 'Senha incorreta!' });
      }
    } else {
      users.set(username, { password, balance: 1000 });
      socket.emit('loginSuccess', { username, balance: 1000 });
    }
  });
  
  socket.on('addPlayer', (data) => {
    if (gameState.players.length < 7) {
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
    }
  });
  
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
      io.emit('notification', { message: '💰 Façam suas apostas!' });
    }
  });
  
  socket.on('placeBet', (data) => {
    const player = gameState.players.find(p => p.id === socket.id);
    
    if (player && gameState.status === 'betting' && !player.betPlaced) {
      const betAmount = parseInt(data.amount);
      
      if (betAmount >= 5 && betAmount <= player.balance) {
        player.bet = betAmount;
        player.balance -= betAmount; // DESCONTA O SALDO IMEDIATAMENTE
        player.betPlaced = true;
        io.emit('gameState', gameState);
        io.emit('notification', { message: `${player.name} apostou ${betAmount}` });
        
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
    
    if (needsShuffle()) {
      io.emit('notification', { message: '⚠️ Próxima rodada: Baralhos serão embaralhados!' });
    }
    
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
      
      currentPlayer.canSplit = false;
      currentPlayer.canDouble = false;
      currentPlayer.playingFirstHand = true;
      
      io.emit('gameState', gameState);
      io.emit('notification', { message: `${currentPlayer.name} dividiu! Jogando MÃO 1...` });
    }
  });
  
  socket.on('double', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id && currentPlayer.canDouble && 
        currentPlayer.cards.length === 2 && !currentPlayer.doubled && !currentPlayer.splitHand) {
      
      currentPlayer.balance -= currentPlayer.bet;
      currentPlayer.bet *= 2;
      currentPlayer.doubled = true;
      
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
  
  socket.on('hit', () => {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    
    if (currentPlayer && currentPlayer.id === socket.id) {
      const newCard = gameState.deck.pop();
      gameState.cardsUsed++;
      
      if (currentPlayer.splitHand && currentPlayer.playingFirstHand) {
        // Jogando primeira mão do split
        currentPlayer.cards.push(newCard);
        currentPlayer.total = calculateTotal(currentPlayer.cards);
        currentPlayer.canDouble = false;
        currentPlayer.canSplit = false;
        
        if (currentPlayer.total > 21) {
          currentPlayer.busted = true;
          currentPlayer.playingFirstHand = false;
          io.emit('gameState', gameState);
          io.emit('notification', { message: `MÃO 1 estourou! Jogando MÃO 2...` });
          setTimeout(() => io.emit('gameState', gameState), 1000);
        } else {
          io.emit('gameState', gameState);
        }
      } else if (currentPlayer.splitHand && !currentPlayer.playingFirstHand) {
        // Jogando segunda mão do split
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
        // Sem split - jogo normal
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
        // Parar primeira mão, ir para segunda
        currentPlayer.playingFirstHand = false;
        io.emit('gameState', gameState);
        io.emit('notification', { message: `MÃO 1 parada! Jogando MÃO 2...` });
      } else if (currentPlayer.splitHand && !currentPlayer.playingFirstHand) {
        // Parar segunda mão
        currentPlayer.splitStanding = true;
        currentPlayer.standing = true;
        io.emit('gameState', gameState);
        setTimeout(() => nextPlayer(), gameState.roundSpeed * 0.5);
      } else {
        // Sem split
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
    
    gameState.players = gameState.players.map(p => {
      let newBalance = p.balance;
      let result = '';
      
      // Avaliar primeira mão
      let firstHandWin = 0;
      if (p.busted) {
        firstHandWin = -p.bet;
      } else if (p.blackjack && dealerTotal !== 21) {
        firstHandWin = Math.floor(p.bet * 1.5);
      } else if (dealerTotal > 21) {
        firstHandWin = p.bet;
      } else if (p.total > dealerTotal) {
        firstHandWin = p.bet;
      } else if (p.total === dealerTotal) {
        firstHandWin = 0;
      } else {
        firstHandWin = -p.bet;
      }
      
      // Avaliar segunda mão (se tiver split)
      let secondHandWin = 0;
      if (p.splitHand) {
        if (p.splitBusted) {
          secondHandWin = -p.bet;
        } else if (dealerTotal > 21) {
          secondHandWin = p.bet;
        } else if (p.splitTotal > dealerTotal) {
          secondHandWin = p.bet;
        } else if (p.splitTotal === dealerTotal) {
          secondHandWin = 0;
        } else {
          secondHandWin = -p.bet;
        }
      }
      
      const totalWin = firstHandWin + secondHandWin;
      newBalance += totalWin;
      
      if (p.splitHand) {
        const h1 = firstHandWin > 0 ? `M1:+$${firstHandWin}` : firstHandWin === 0 ? 'M1:EMPATE' : `M1:-$${Math.abs(firstHandWin)}`;
        const h2 = secondHandWin > 0 ? `M2:+$${secondHandWin}` : secondHandWin === 0 ? 'M2:EMPATE' : `M2:-$${Math.abs(secondHandWin)}`;
        result = `${h1} | ${h2} | Total: ${totalWin >= 0 ? '+' : ''}$${totalWin}`;
      } else {
        if (firstHandWin > 0) {
          result = p.blackjack ? `BLACKJACK! +$${firstHandWin}` : `GANHOU! +$${firstHandWin}`;
        } else if (firstHandWin === 0) {
          result = 'EMPATE $0';
        } else {
          result = `PERDEU -$${Math.abs(firstHandWin)}`;
        }
      }
      
      if (users.has(p.username)) {
        users.get(p.username).balance = newBalance;
      }
      
      return { ...p, balance: newBalance, result };
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
      
      if (needsShuffle()) {
        gameState.deck = createDeck();
        gameState.cardsUsed = 0;
        io.emit('notification', { message: '🔀 Baralhos embaralhados!' });
      }
      
      io.emit('gameState', gameState);
      io.emit('notification', { message: '💰 Nova rodada! Façam suas apostas!' });
    }
  });
  
  socket.on('leaveTable', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (player) {
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
