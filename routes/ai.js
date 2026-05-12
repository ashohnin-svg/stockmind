const router = require('express').Router();
const fetch  = require('node-fetch');
const auth   = require('../middleware/auth');

const MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';

router.post('/', auth, async (req, res) => {
  const { system, message, maxTokens = 1500 } = req.body;
  if (!system || !message) return res.status(400).json({ error: 'system и message обязательны' });

  // Inject strong JSON-only instruction into system prompt
  const systemFinal = system +
    '\n\nCRITICAL RULE: Your entire response must be ONLY a valid JSON object. ' +
    'Do not write any text, explanation, greeting, or markdown before or after the JSON. ' +
    'Start your response with { and end with }. Nothing else.';

  try {
    const body = {
      model: MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemFinal },
        { role: 'user',   content: message }
      ]
    };

    // Enable JSON mode if model supports it (works for most Llama/Mistral models)
    body.response_format = { type: 'json_object' };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        'HTTP-Referer': process.env.SITE_URL || 'https://stockmind.app',
        'X-Title': 'StockMind'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      // If json_object mode not supported, retry without it
      if (response.status === 400 && err.error?.message?.includes('response_format')) {
        delete body.response_format;
        const r2 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
            'HTTP-Referer': process.env.SITE_URL || 'https://stockmind.app',
            'X-Title': 'StockMind'
          },
          body: JSON.stringify(body)
        });
        if (!r2.ok) {
          const e2 = await r2.json().catch(() => ({}));
          return res.status(r2.status).json({ error: `OpenRouter ${r2.status}: ${e2.error?.message || 'error'}` });
        }
        const d2 = await r2.json();
        return res.json({ text: d2.choices?.[0]?.message?.content || '' });
      }
      return res.status(response.status).json({
        error: `OpenRouter ${response.status}: ${err.error?.message || 'error'}`
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
