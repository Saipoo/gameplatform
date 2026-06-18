// ============================================================
// PLATO-LIKE MULTIPLAYER GAME PLATFORM - BACKEND SERVER
// Deploy on Render.com | DB: Neon PostgreSQL
// ============================================================

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// ─── CORS & SOCKET.IO ────────────────────────────────────────
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'https://localhost:3000'];

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());

const io = new Server(server, {
    cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'], credentials: true }
});

// ─── NEON DATABASE ───────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ─── AUTO CREATE TABLES ──────────────────────────────────────
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(30) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        avatar VARCHAR(10) DEFAULT '🎮',
        level INTEGER DEFAULT 1,
        xp INTEGER DEFAULT 0,
        coins INTEGER DEFAULT 100,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        friends TEXT[] DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS game_rooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(8) UNIQUE NOT NULL,
        game_type VARCHAR(50) NOT NULL,
        host_id UUID REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'waiting',
        max_players INTEGER DEFAULT 4,
        settings JSONB DEFAULT '{}',
        state JSONB DEFAULT '{}',
        players UUID[] DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS game_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID,
        game_type VARCHAR(50),
        players JSONB,
        winner_id UUID REFERENCES users(id),
        duration INTEGER,
        data JSONB DEFAULT '{}',
        played_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS leaderboard (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        game_type VARCHAR(50),
        score INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, game_type)
      );

      CREATE TABLE IF NOT EXISTS invites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        from_user_id UUID REFERENCES users(id),
        to_user_id UUID REFERENCES users(id),
        room_id UUID,
        room_code VARCHAR(8),
        game_type VARCHAR(50),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_rooms_code ON game_rooms(code);
      CREATE INDEX IF NOT EXISTS idx_invites_to_user ON invites(to_user_id, status);
    `);
        console.log('✅ Database tables initialized');
    } catch (err) {
        console.error('❌ DB init error:', err.message);
    } finally {
        client.release();
    }
}

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// ─── AUTH ROUTES ─────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password, avatar } = req.body;
    if (!username || !email || !password)
        return res.status(400).json({ error: 'All fields required' });
    if (username.length < 3 || username.length > 20)
        return res.status(400).json({ error: 'Username must be 3-20 chars' });
    try {
        const hash = await bcrypt.hash(password, 10);
        const { rows } = await pool.query(
            `INSERT INTO users (username, email, password_hash, avatar)
       VALUES ($1,$2,$3,$4) RETURNING id, username, email, avatar, level, xp, coins`,
            [username.toLowerCase(), email.toLowerCase(), hash, avatar || '🎮']
        );
        const token = jwt.sign({ id: rows[0].id, username: rows[0].username }, process.env.JWT_SECRET || 'secret123', { expiresIn: '7d' });
        res.json({ token, user: rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Username or email already taken' });
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const { rows } = await pool.query(
            'SELECT * FROM users WHERE username=$1 OR email=$1', [username.toLowerCase()]
        );
        if (!rows.length) return res.status(400).json({ error: 'User not found' });
        const valid = await bcrypt.compare(password, rows[0].password_hash);
        if (!valid) return res.status(400).json({ error: 'Wrong password' });
        await pool.query('UPDATE users SET last_seen=NOW() WHERE id=$1', [rows[0].id]);
        const token = jwt.sign({ id: rows[0].id, username: rows[0].username }, process.env.JWT_SECRET || 'secret123', { expiresIn: '7d' });
        const { password_hash, ...user } = rows[0];
        res.json({ token, user });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── USER ROUTES ─────────────────────────────────────────────
app.get('/api/users/me', authMiddleware, async (req, res) => {
    const { rows } = await pool.query(
        'SELECT id,username,email,avatar,level,xp,coins,wins,losses,friends,created_at FROM users WHERE id=$1',
        [req.user.id]
    );
    res.json(rows[0]);
});

app.get('/api/users/search/:q', authMiddleware, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT id,username,avatar,level,wins FROM users WHERE username ILIKE $1 AND id!=$2 LIMIT 10`,
        [`%${req.params.q}%`, req.user.id]
    );
    res.json(rows);
});

app.get('/api/users/:username/profile', async (req, res) => {
    const { rows } = await pool.query(
        'SELECT id,username,avatar,level,xp,wins,losses,created_at FROM users WHERE username=$1',
        [req.params.username.toLowerCase()]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
});

app.post('/api/users/add-friend', authMiddleware, async (req, res) => {
    const { friendUsername } = req.body;
    const { rows: fr } = await pool.query('SELECT id FROM users WHERE username=$1', [friendUsername.toLowerCase()]);
    if (!fr.length) return res.status(404).json({ error: 'User not found' });
    await pool.query(`UPDATE users SET friends=array_append(friends,$1::text) WHERE id=$2 AND NOT ($1=ANY(friends))`,
        [fr[0].id, req.user.id]);
    res.json({ success: true });
});

// ─── LEADERBOARD ROUTES ──────────────────────────────────────
app.get('/api/leaderboard/:game', async (req, res) => {
    const { rows } = await pool.query(
        `SELECT u.username,u.avatar,u.level,l.score FROM leaderboard l
     JOIN users u ON u.id=l.user_id WHERE l.game_type=$1
     ORDER BY l.score DESC LIMIT 20`,
        [req.params.game]
    );
    res.json(rows);
});

app.get('/api/leaderboard', async (req, res) => {
    const { rows } = await pool.query(
        `SELECT u.username,u.avatar,u.level,u.wins,u.xp FROM users u ORDER BY u.xp DESC LIMIT 20`
    );
    res.json(rows);
});

// ─── ROOM ROUTES ─────────────────────────────────────────────
app.post('/api/rooms/create', authMiddleware, async (req, res) => {
    const { gameType, maxPlayers, settings } = req.body;
    const code = Math.random().toString(36).substr(2, 6).toUpperCase();
    const { rows } = await pool.query(
        `INSERT INTO game_rooms (code,game_type,host_id,max_players,settings,players)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [code, gameType, req.user.id, maxPlayers || 4, settings || {}, [req.user.id]]
    );
    res.json(rows[0]);
});

app.get('/api/rooms/:code', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM game_rooms WHERE code=$1', [req.params.code.toUpperCase()]);
    if (!rows.length) return res.status(404).json({ error: 'Room not found' });
    res.json(rows[0]);
});

app.get('/api/rooms', async (req, res) => {
    const { rows } = await pool.query(
        `SELECT r.*,u.username as host_name FROM game_rooms r
     JOIN users u ON u.id=r.host_id WHERE r.status='waiting'
     ORDER BY r.created_at DESC LIMIT 30`
    );
    res.json(rows);
});

// ─── INVITE ROUTES ───────────────────────────────────────────
app.post('/api/invites/send', authMiddleware, async (req, res) => {
    const { toUsername, roomCode, gameType } = req.body;
    const { rows: tu } = await pool.query('SELECT id FROM users WHERE username=$1', [toUsername.toLowerCase()]);
    if (!tu.length) return res.status(404).json({ error: 'User not found' });
    const { rows: room } = await pool.query('SELECT id FROM game_rooms WHERE code=$1', [roomCode]);
    const { rows } = await pool.query(
        `INSERT INTO invites (from_user_id,to_user_id,room_id,room_code,game_type)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.id, tu[0].id, room[0]?.id, roomCode, gameType]
    );
    // Emit invite notification via socket
    const toSocketId = onlineUsers.get(tu[0].id);
    if (toSocketId) {
        io.to(toSocketId).emit('invite_received', {
            from: req.user.username, roomCode, gameType, inviteId: rows[0].id
        });
    }
    res.json({ success: true });
});

app.get('/api/invites', authMiddleware, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT i.*,u.username as from_username,u.avatar as from_avatar
     FROM invites i JOIN users u ON u.id=i.from_user_id
     WHERE i.to_user_id=$1 AND i.status='pending' ORDER BY i.created_at DESC`,
        [req.user.id]
    );
    res.json(rows);
});

// ─── IN-MEMORY STATE ─────────────────────────────────────────
const rooms = new Map();        // roomCode -> room state
const onlineUsers = new Map();  // userId -> socketId
const socketUsers = new Map();  // socketId -> userId

// ─── GAME ENGINES ────────────────────────────────────────────

// UNO Engine
function createUnoDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const deck = [];
    colors.forEach(c => {
        [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 'skip', 'skip', 'reverse', 'reverse', 'draw2', 'draw2'].forEach(v => {
            deck.push({ color: c, value: String(v) });
        });
    });
    ['wild', 'wild', 'wild', 'wild', 'wild4', 'wild4', 'wild4', 'wild4'].forEach(v => {
        deck.push({ color: 'wild', value: v });
    });
    return deck.sort(() => Math.random() - 0.5);
}

function initUno(players) {
    const deck = createUnoDeck();
    const hands = {};
    players.forEach(p => { hands[p] = deck.splice(0, 7); });
    let topCard = deck.pop();
    while (topCard.color === 'wild') { deck.unshift(topCard); topCard = deck.pop(); }
    return { deck, discard: [topCard], hands, currentPlayer: players[0], direction: 1, players, drawPile: 0, winner: null };
}

function playUnoCard(state, playerId, card, chosenColor) {
    const top = state.discard[state.discard.length - 1];
    const hand = state.hands[playerId];
    const cardIdx = hand.findIndex(c => c.color === card.color && c.value === card.value);
    if (cardIdx === -1) return { error: 'Card not in hand' };
    const canPlay = card.color === 'wild' || card.color === top.color || card.value === top.value ||
        (top.color === 'wild' && top.chosenColor && card.color === top.chosenColor);
    if (!canPlay) return { error: 'Cannot play that card' };
    hand.splice(cardIdx, 1);
    if (card.color === 'wild') card.chosenColor = chosenColor || 'red';
    state.discard.push(card);
    if (hand.length === 0) { state.winner = playerId; return state; }
    const pi = state.players.indexOf(playerId);
    let next = (pi + state.direction + state.players.length) % state.players.length;
    if (card.value === 'skip') next = (next + state.direction + state.players.length) % state.players.length;
    if (card.value === 'reverse') state.direction *= -1;
    if (card.value === 'draw2') { for (let i = 0; i < 2; i++) state.hands[state.players[next]].push(state.deck.pop() || { color: 'red', value: '0' }); }
    if (card.value === 'wild4') { for (let i = 0; i < 4; i++) state.hands[state.players[next]].push(state.deck.pop() || { color: 'red', value: '0' }); }
    state.currentPlayer = state.players[next];
    return state;
}

// Word Jumble Engine
const WORD_LIST = ['ELEPHANT', 'COMPUTER', 'PLATFORM', 'KEYBOARD', 'SUNSHINE', 'BIRTHDAY', 'FOOTBALL', 'HOSPITAL', 'MOUNTAIN', 'INTERNET', 'LANGUAGE', 'SWIMMING', 'HOSPITAL', 'DIAMOND', 'CAPTAIN', 'JOURNEY', 'VICTORY', 'FANTASY', 'THUNDER', 'COURAGE'];
function createJumble() {
    const word = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
    const jumbled = word.split('').sort(() => Math.random() - 0.5).join('');
    return { word, jumbled, hint: `${word.length} letters`, solved: false };
}

// Riddle Engine
const RIDDLES = [
    { q: "I have cities, but no houses live there. I have mountains, but no trees grow. I have water, but no fish swim. What am I?", a: "map" },
    { q: "The more you take, the more you leave behind. What am I?", a: "footsteps" },
    { q: "I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?", a: "echo" },
    { q: "What has hands but can't clap?", a: "clock" },
    { q: "I'm light as a feather, but the strongest person can't hold me for more than 5 minutes. What am I?", a: "breath" },
    { q: "What gets wetter as it dries?", a: "towel" },
    { q: "I have a head and a tail, but no body. What am I?", a: "coin" },
    { q: "What comes once in a minute, twice in a moment, but never in a thousand years?", a: "letter m" },
    { q: "Forward I'm heavy, backward I'm not. What am I?", a: "ton" },
    { q: "What can you catch but not throw?", a: "cold" }
];

// Math Tricks
const MATH_TRICKS = [
    { q: "Think of a number. Double it. Add 10. Halve it. Subtract your original number. Your answer is:", a: 5 },
    { q: "What is 15% of 200?", a: 30 },
    { q: "If you have 8 apples and give away 1/4, how many remain?", a: 6 },
    { q: "What is the next prime after 17?", a: 19 },
    { q: "A bat and ball cost $1.10. The bat costs $1 more than the ball. How much does the ball cost (in cents)?", a: 5 }
];

// Crossword (simple 5×5)
function createCrossword() {
    return {
        grid: [
            ['C', 'A', 'T', '_', '_'],
            ['_', 'P', '_', '_', '_'],
            ['_', 'P', 'I', 'G', '_'],
            ['_', 'L', '_', 'O', '_'],
            ['_', 'E', 'G', 'G', '_']
        ],
        clues: {
            across: [
                { num: 1, row: 0, col: 0, len: 3, clue: 'A furry pet that purrs' },
                { num: 3, row: 2, col: 1, len: 3, clue: 'A farm animal that oinks' },
                { num: 5, row: 4, col: 2, len: 2, clue: 'Chicken product, breakfast staple' }
            ],
            down: [
                { num: 2, row: 0, col: 1, len: 5, clue: 'A fruit with a shiny red/green skin' },
                { num: 4, row: 2, col: 3, len: 3, clue: 'A deity, worshipped being' }
            ]
        },
        answers: { across: { 1: 'CAT', 3: 'PIG', 5: 'GG' }, down: { 2: 'APPLE', 4: 'GOD' } }
    };
}

// Memory Game
function createMemoryGame(pairs = 8) {
    const emojis = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🦆'];
    const selected = emojis.slice(0, pairs);
    const cards = [...selected, ...selected].map((emoji, i) => ({ id: i, emoji, flipped: false, matched: false }));
    return { cards: cards.sort(() => Math.random() - 0.5), currentPlayer: 0, scores: {}, firstCard: null, secondCard: null };
}

// Cannon War Engine
function initCannonWar(players) {
    return {
        players: players.map((p, i) => ({
            id: p, health: 100, position: i === 0 ? 50 : 650,
            angle: i === 0 ? 45 : 135, power: 50, ammo: 10, side: i
        })),
        projectiles: [], wind: (Math.random() - 0.5) * 10,
        currentPlayer: players[0], turn: 0
    };
}

// Tennis Engine
function initTennis(players) {
    return {
        players, scores: { [players[0]]: 0, [players[1]]: 0 },
        sets: { [players[0]]: 0, [players[1]]: 0 },
        ball: { x: 400, y: 300, vx: 3, vy: 2 },
        paddles: { [players[0]]: 280, [players[1]]: 280 },
        serving: players[0]
    };
}

// Trivia Questions
const TRIVIA = [
    { q: "What is the capital of France?", options: ["London", "Berlin", "Paris", "Madrid"], a: 2, cat: "Geography" },
    { q: "Which planet is closest to the sun?", options: ["Venus", "Mercury", "Earth", "Mars"], a: 1, cat: "Science" },
    { q: "Who painted the Mona Lisa?", options: ["Picasso", "Da Vinci", "Rembrandt", "Monet"], a: 1, cat: "Art" },
    { q: "What year did World War II end?", options: ["1943", "1944", "1945", "1946"], a: 2, cat: "History" },
    { q: "How many sides does a hexagon have?", options: ["5", "6", "7", "8"], a: 1, cat: "Math" },
    { q: "What is H2O commonly known as?", options: ["Salt", "Water", "Oxygen", "Hydrogen"], a: 1, cat: "Science" },
    { q: "Which country invented pizza?", options: ["Spain", "Greece", "Italy", "France"], a: 2, cat: "Food" },
    { q: "What is the largest ocean?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], a: 3, cat: "Geography" },
    { q: "Who wrote Romeo and Juliet?", options: ["Dickens", "Shakespeare", "Tolstoy", "Austen"], a: 1, cat: "Literature" },
    { q: "What is 12 × 12?", options: ["132", "144", "124", "148"], a: 1, cat: "Math" }
];

// Fun Friday Games - Truth or Dare
const TRUTH_OR_DARE = {
    truths: [
        "What's the most embarrassing thing that's ever happened to you?",
        "Who was your first crush?",
        "What's the worst gift you've ever received?",
        "Have you ever cheated on a test?",
        "What's your most irrational fear?",
        "What's the last lie you told?",
        "If you could trade lives with anyone here, who would it be?",
        "What's a secret you've never told your parents?"
    ],
    dares: [
        "Do your best dance move for 30 seconds!",
        "Speak in an accent for the next 3 rounds",
        "Tell a joke (it must make someone laugh)",
        "Send a funny emoji to the last person in your contacts",
        "Do 10 jumping jacks right now",
        "Say the alphabet backwards",
        "Make a funny face and hold it for 10 seconds",
        "Tell everyone what you had for breakfast in the most dramatic way possible"
    ]
};

// ─── SOCKET.IO HANDLERS ──────────────────────────────────────
io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    // Auth
    socket.on('authenticate', async ({ token }) => {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
            socket.userId = decoded.id;
            socket.username = decoded.username;
            onlineUsers.set(decoded.id, socket.id);
            socketUsers.set(socket.id, decoded.id);
            socket.emit('authenticated', { userId: decoded.id, username: decoded.username });
            // Broadcast online status
            io.emit('user_online', { userId: decoded.id, username: decoded.username });
        } catch { socket.emit('auth_error', 'Invalid token'); }
    });

    // Create Room
    socket.on('create_room', async ({ gameType, maxPlayers, settings }) => {
        const code = Math.random().toString(36).substr(2, 6).toUpperCase();
        const room = {
            code, gameType, hostId: socket.userId, hostName: socket.username,
            status: 'waiting', maxPlayers: maxPlayers || 4,
            players: [{ id: socket.userId, name: socket.username, ready: false }],
            settings: settings || {}, state: null, spectators: []
        };
        rooms.set(code, room);
        socket.join(code);
        socket.roomCode = code;
        socket.emit('room_created', room);
    });

    // Join Room
    socket.on('join_room', async ({ code }) => {
        const room = rooms.get(code.toUpperCase());
        if (!room) { socket.emit('error', 'Room not found'); return; }
        if (room.status !== 'waiting') { socket.emit('error', 'Game already started'); return; }
        if (room.players.length >= room.maxPlayers) { socket.emit('error', 'Room is full'); return; }
        const exists = room.players.find(p => p.id === socket.userId);
        if (!exists) room.players.push({ id: socket.userId, name: socket.username, ready: false });
        socket.join(code.toUpperCase());
        socket.roomCode = code.toUpperCase();
        io.to(code.toUpperCase()).emit('player_joined', { players: room.players, room });
    });

    // Ready
    socket.on('player_ready', ({ code }) => {
        const room = rooms.get(code);
        if (!room) return;
        const player = room.players.find(p => p.id === socket.userId);
        if (player) player.ready = true;
        io.to(code).emit('player_ready_update', room.players);
    });

    // Start Game
    socket.on('start_game', ({ code }) => {
        const room = rooms.get(code);
        if (!room || room.hostId !== socket.userId) return;
        const playerIds = room.players.map(p => p.id);
        const playerNames = {};
        room.players.forEach(p => { playerNames[p.id] = p.name; });

        switch (room.gameType) {
            case 'uno': room.state = initUno(playerIds); break;
            case 'cannon': room.state = initCannonWar(playerIds); break;
            case 'tennis': room.state = initTennis(playerIds); break;
            case 'memory': room.state = createMemoryGame(); room.state.scores = {}; playerIds.forEach(p => room.state.scores[p] = 0); room.state.currentPlayerIdx = 0; room.state.players = playerIds; break;
            case 'trivia': room.state = { questions: [...TRIVIA].sort(() => Math.random() - 0.5).slice(0, 10), current: 0, scores: {}, players: playerIds, answered: {}, timer: 30 }; playerIds.forEach(p => room.state.scores[p] = 0); break;
            case 'riddle': room.state = { riddles: [...RIDDLES].sort(() => Math.random() - 0.5), current: 0, scores: {}, players: playerIds, solved: false }; playerIds.forEach(p => room.state.scores[p] = 0); break;
            case 'jumble': room.state = { ...createJumble(), scores: {}, players: playerIds, solved: false }; playerIds.forEach(p => room.state.scores[p] = 0); break;
            case 'mathquiz': room.state = { tricks: [...MATH_TRICKS].sort(() => Math.random() - 0.5), current: 0, scores: {}, players: playerIds }; playerIds.forEach(p => room.state.scores[p] = 0); break;
            case 'crossword': room.state = { ...createCrossword(), players: playerIds, scores: {} }; playerIds.forEach(p => room.state.scores[p] = 0); break;
            case 'truth_dare': room.state = { players: playerIds, playerNames, currentIdx: 0, mode: null, content: null, round: 0 }; break;
            case 'drawing': room.state = { players: playerIds, playerNames, strokes: [], word: '', drawerId: playerIds[0], round: 0, scores: {}, guesses: [] }; playerIds.forEach(p => room.state.scores[p] = 0); break;
        }

        room.status = 'playing';
        io.to(code).emit('game_started', { gameType: room.gameType, state: room.state, players: room.players });
    });

    // ─── GAME ACTIONS ─────────────────────────────────────────

    // UNO
    socket.on('uno_play', ({ code, card, chosenColor }) => {
        const room = rooms.get(code);
        if (!room || room.state.currentPlayer !== socket.userId) return;
        const newState = playUnoCard(room.state, socket.userId, card, chosenColor);
        if (newState.error) { socket.emit('error', newState.error); return; }
        room.state = newState;
        io.to(code).emit('uno_update', room.state);
        if (room.state.winner) {
            io.to(code).emit('game_over', { winner: socket.username, winnerId: socket.userId });
            updateStats(socket.userId, room.players.map(p => p.id).filter(id => id !== socket.userId));
        }
    });

    socket.on('uno_draw', ({ code }) => {
        const room = rooms.get(code);
        if (!room || room.state.currentPlayer !== socket.userId) return;
        const card = room.state.deck.pop() || { color: 'red', value: '0' };
        room.state.hands[socket.userId].push(card);
        const pi = room.state.players.indexOf(socket.userId);
        const next = (pi + room.state.direction + room.state.players.length) % room.state.players.length;
        room.state.currentPlayer = room.state.players[next];
        io.to(code).emit('uno_update', room.state);
    });

    // Cannon War
    socket.on('cannon_fire', ({ code, angle, power }) => {
        const room = rooms.get(code);
        if (!room) return;
        const player = room.state.players.find(p => p.id === socket.userId);
        if (!player) return;
        player.angle = angle; player.power = power;
        const rad = (angle * Math.PI) / 180;
        const vx = power * Math.cos(rad) * (player.side === 0 ? 1 : -1);
        const vy = -power * Math.sin(rad);
        const proj = { x: player.position, y: 400, vx, vy, playerId: socket.userId, id: uuidv4() };
        room.state.projectiles.push(proj);
        io.to(code).emit('cannon_update', room.state);
        // Simulate hit
        const opp = room.state.players.find(p => p.id !== socket.userId);
        if (opp) {
            const hitChance = 0.6 + (power / 500);
            if (Math.random() < hitChance) {
                opp.health = Math.max(0, opp.health - 20);
                if (opp.health <= 0) {
                    io.to(code).emit('game_over', { winner: socket.username, winnerId: socket.userId });
                    updateStats(socket.userId, [opp.id]);
                }
            }
        }
        const pi = room.state.players.indexOf(player);
        const nextPi = (pi + 1) % room.state.players.length;
        room.state.currentPlayer = room.state.players[nextPi].id;
        io.to(code).emit('cannon_update', room.state);
    });

    // Tennis
    socket.on('tennis_move', ({ code, y }) => {
        const room = rooms.get(code);
        if (!room) return;
        room.state.paddles[socket.userId] = Math.max(0, Math.min(500, y));
        io.to(code).emit('tennis_update', room.state);
    });

    // Trivia
    socket.on('trivia_answer', ({ code, answerIdx }) => {
        const room = rooms.get(code);
        if (!room) return;
        const q = room.state.questions[room.state.current];
        if (!room.state.answered[socket.userId]) {
            room.state.answered[socket.userId] = answerIdx;
            if (answerIdx === q.a) room.state.scores[socket.userId] = (room.state.scores[socket.userId] || 0) + 10;
        }
        if (Object.keys(room.state.answered).length >= room.state.players.length) {
            room.state.current++;
            room.state.answered = {};
            if (room.state.current >= room.state.questions.length) {
                const winner = Object.entries(room.state.scores).sort((a, b) => b[1] - a[1])[0];
                const winnerPlayer = room.players.find(p => p.id === winner[0]);
                io.to(code).emit('game_over', { winner: winnerPlayer?.name, winnerId: winner[0], scores: room.state.scores });
                updateStats(winner[0], room.state.players.filter(p => p !== winner[0]));
            } else {
                io.to(code).emit('trivia_update', room.state);
            }
        } else {
            io.to(code).emit('trivia_update', room.state);
        }
    });

    // Riddle
    socket.on('riddle_guess', ({ code, guess }) => {
        const room = rooms.get(code);
        if (!room || room.state.solved) return;
        const riddle = room.state.riddles[room.state.current];
        if (guess.toLowerCase().trim() === riddle.a.toLowerCase()) {
            room.state.scores[socket.userId] = (room.state.scores[socket.userId] || 0) + 10;
            room.state.solved = true;
            io.to(code).emit('riddle_solved', { solvedBy: socket.username, answer: riddle.a, scores: room.state.scores });
            setTimeout(() => {
                room.state.current++;
                room.state.solved = false;
                if (room.state.current >= room.state.riddles.length) {
                    const winner = Object.entries(room.state.scores).sort((a, b) => b[1] - a[1])[0];
                    const winnerPlayer = room.players.find(p => p.id === winner[0]);
                    io.to(code).emit('game_over', { winner: winnerPlayer?.name, winnerId: winner[0], scores: room.state.scores });
                } else {
                    io.to(code).emit('riddle_update', room.state);
                }
            }, 3000);
        } else {
            socket.emit('wrong_guess', { guess });
        }
    });

    // Word Jumble
    socket.on('jumble_guess', ({ code, guess }) => {
        const room = rooms.get(code);
        if (!room || room.state.solved) return;
        if (guess.toUpperCase() === room.state.word) {
            room.state.scores[socket.userId] = (room.state.scores[socket.userId] || 0) + 10;
            room.state.solved = true;
            io.to(code).emit('jumble_solved', { solvedBy: socket.username, word: room.state.word, scores: room.state.scores });
            setTimeout(() => {
                Object.assign(room.state, createJumble());
                room.state.solved = false;
                io.to(code).emit('jumble_update', room.state);
            }, 3000);
        } else {
            socket.emit('wrong_guess', { guess });
        }
    });

    // Memory Game
    socket.on('memory_flip', ({ code, cardId }) => {
        const room = rooms.get(code);
        if (!room) return;
        const state = room.state;
        if (state.players[state.currentPlayerIdx] !== socket.userId) return;
        const card = state.cards.find(c => c.id === cardId);
        if (!card || card.flipped || card.matched) return;
        card.flipped = true;
        if (!state.firstCard) {
            state.firstCard = cardId;
        } else {
            state.secondCard = cardId;
            const fc = state.cards.find(c => c.id === state.firstCard);
            const sc = state.cards.find(c => c.id === state.secondCard);
            if (fc.emoji === sc.emoji) {
                fc.matched = sc.matched = true;
                state.scores[socket.userId] = (state.scores[socket.userId] || 0) + 1;
                state.firstCard = state.secondCard = null;
                if (state.cards.every(c => c.matched)) {
                    const winner = Object.entries(state.scores).sort((a, b) => b[1] - a[1])[0];
                    const winnerPlayer = room.players.find(p => p.id === winner[0]);
                    io.to(code).emit('game_over', { winner: winnerPlayer?.name, winnerId: winner[0], scores: state.scores });
                }
            } else {
                setTimeout(() => {
                    fc.flipped = sc.flipped = false;
                    state.firstCard = state.secondCard = null;
                    state.currentPlayerIdx = (state.currentPlayerIdx + 1) % state.players.length;
                    io.to(code).emit('memory_update', state);
                }, 1200);
            }
        }
        io.to(code).emit('memory_update', state);
    });

    // Math Quiz
    socket.on('math_answer', ({ code, answer }) => {
        const room = rooms.get(code);
        if (!room) return;
        const trick = room.state.tricks[room.state.current];
        if (parseInt(answer) === trick.a) {
            room.state.scores[socket.userId] = (room.state.scores[socket.userId] || 0) + 10;
            room.state.current++;
            if (room.state.current >= room.state.tricks.length) {
                const winner = Object.entries(room.state.scores).sort((a, b) => b[1] - a[1])[0];
                const winnerPlayer = room.players.find(p => p.id === winner[0]);
                io.to(code).emit('game_over', { winner: winnerPlayer?.name, winnerId: winner[0], scores: room.state.scores });
            } else {
                io.to(code).emit('math_update', room.state);
            }
        } else {
            socket.emit('wrong_guess', { answer });
        }
    });

    // Truth or Dare
    socket.on('truth_or_dare_choose', ({ code, choice }) => {
        const room = rooms.get(code);
        if (!room) return;
        const state = room.state;
        const list = choice === 'truth' ? TRUTH_OR_DARE.truths : TRUTH_OR_DARE.dares;
        state.mode = choice;
        state.content = list[Math.floor(Math.random() * list.length)];
        io.to(code).emit('truth_dare_reveal', state);
    });

    socket.on('truth_dare_next', ({ code }) => {
        const room = rooms.get(code);
        if (!room) return;
        const state = room.state;
        state.currentIdx = (state.currentIdx + 1) % state.players.length;
        state.mode = null; state.content = null; state.round++;
        io.to(code).emit('truth_dare_update', state);
    });

    // Drawing (Pictionary-like)
    socket.on('draw_stroke', ({ code, stroke }) => {
        const room = rooms.get(code);
        if (!room) return;
        room.state.strokes.push(stroke);
        socket.to(code).emit('draw_update', { stroke });
    });

    socket.on('draw_guess', ({ code, guess }) => {
        const room = rooms.get(code);
        if (!room || socket.userId === room.state.drawerId) return;
        if (guess.toLowerCase() === room.state.word.toLowerCase()) {
            room.state.scores[socket.userId] = (room.state.scores[socket.userId] || 0) + 10;
            io.to(code).emit('draw_correct', { guesser: socket.username, word: room.state.word });
        } else {
            io.to(code).emit('draw_wrong_guess', { guesser: socket.username, guess });
        }
    });

    // Chat
    socket.on('room_chat', ({ code, message }) => {
        io.to(code).emit('chat_message', {
            from: socket.username, message,
            timestamp: new Date().toISOString()
        });
    });

    // Leave Room
    socket.on('leave_room', ({ code }) => {
        const room = rooms.get(code);
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.userId);
            if (room.players.length === 0) rooms.delete(code);
            else io.to(code).emit('player_left', { playerId: socket.userId, players: room.players });
        }
        socket.leave(code);
    });

    // Disconnect
    socket.on('disconnect', () => {
        const userId = socketUsers.get(socket.id);
        if (userId) {
            onlineUsers.delete(userId);
            socketUsers.delete(socket.id);
            io.emit('user_offline', { userId });
        }
        if (socket.roomCode) {
            const room = rooms.get(socket.roomCode);
            if (room) {
                room.players = room.players.filter(p => p.id !== socket.userId);
                io.to(socket.roomCode).emit('player_left', { playerId: socket.userId, players: room.players });
            }
        }
    });
});

// ─── HELPER FUNCTIONS ────────────────────────────────────────
async function updateStats(winnerId, loserIds) {
    try {
        await pool.query('UPDATE users SET wins=wins+1, xp=xp+50 WHERE id=$1', [winnerId]);
        if (loserIds.length) {
            await pool.query('UPDATE users SET losses=losses+1 WHERE id=ANY($1)', [loserIds]);
        }
    } catch (err) {
        console.error('Stats update error:', err.message);
    }
}

// ─── HEALTH CHECK ────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/', (req, res) => res.json({ name: 'GamePlatform API', version: '1.0.0' }));

// ─── START SERVER ────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
initDB().then(() => {
    server.listen(PORT, () => console.log(`🎮 GamePlatform Server running on port ${PORT}`));
});