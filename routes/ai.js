const router = require('express').Router();
const fetch  = require('node-fetch');
const auth   = require('../middleware/auth');

const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free';

// POST /api/ai  { system, message, maxTokens }
router.post('/', auth, async (req, res) => {
  const { system, message, maxTokens = 1500 } = req.body;
  if (!system || !message) return res.status(400).json({ error: 'system и message обязательны' });

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        'HTTP-Referer': process.env.SITE_URL || 'https://stockmind.app',
        'X-Title': 'StockMind'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: message }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: `OpenRouter ${response.status}: ${err.error?.message || 'неизвестная ошибка'}`
      });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    res.json({ text });

  } catch (e) {
    console.error('AI proxy error:', e);
    res.status(500).json({ error: 'Ошибка AI-прокси: ' + e.message });
  }
});

module.exports = router;
