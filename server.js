require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { initDB } = require('./db');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/portfolio', require('./routes/portfolio'));
app.use('/api/ai',        require('./routes/ai'));

// Health check
app.get('/api/health', (_, res) => res.json({ ok: true }));

// SPA fallback
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => app.listen(PORT, () => console.log(`🚀 StockMind running on :${PORT}`)))
  .catch(e => { console.error('DB init failed:', e); process.exit(1); });
