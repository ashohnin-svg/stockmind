const router  = require('express').Router();
const auth    = require('../middleware/auth');
const { pool } = require('../db');

// GET /api/portfolio — load user's portfolio
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT data FROM portfolios WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ portfolio: rows[0]?.data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка загрузки портфеля' });
  }
});

// POST /api/portfolio — save user's portfolio
router.post('/', auth, async (req, res) => {
  const { portfolio } = req.body;
  if (!Array.isArray(portfolio)) return res.status(400).json({ error: 'Неверный формат' });

  try {
    await pool.query(
      `INSERT INTO portfolios (user_id, data) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = NOW()`,
      [req.user.id, JSON.stringify(portfolio)]
    );

    // Ensure unique constraint exists (add if not)
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'portfolios_user_id_key'
        ) THEN
          ALTER TABLE portfolios ADD CONSTRAINT portfolios_user_id_key UNIQUE (user_id);
        END IF;
      END $$;
    `).catch(() => {}); // Ignore if already exists

    res.json({ ok: true });
  } catch (e) {
    // If upsert fails due to missing unique constraint, use update+insert
    try {
      const { rows } = await pool.query('SELECT id FROM portfolios WHERE user_id = $1', [req.user.id]);
      if (rows.length) {
        await pool.query('UPDATE portfolios SET data = $1, updated_at = NOW() WHERE user_id = $2',
          [JSON.stringify(portfolio), req.user.id]);
      } else {
        await pool.query('INSERT INTO portfolios (user_id, data) VALUES ($1, $2)',
          [req.user.id, JSON.stringify(portfolio)]);
      }
      res.json({ ok: true });
    } catch (e2) {
      console.error(e2);
      res.status(500).json({ error: 'Ошибка сохранения' });
    }
  }
});

module.exports = router;
