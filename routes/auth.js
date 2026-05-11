const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { pool } = require('../db');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email.toLowerCase().trim(), hash]
    );
    // Create empty portfolio for new user
    await pool.query('INSERT INTO portfolios (user_id, data) VALUES ($1, $2)', [rows[0].id, '[]']);

    const token = jwt.sign({ id: rows[0].id, email: rows[0].email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, email: rows[0].email });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email уже зарегистрирован' });
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' });

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!rows.length) return res.status(401).json({ error: 'Неверный email или пароль' });

    const ok = await bcrypt.compare(password, rows[0].password);
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });

    const token = jwt.sign({ id: rows[0].id, email: rows[0].email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, email: rows[0].email });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
