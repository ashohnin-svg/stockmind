const router = require('express').Router();
const auth   = require('../middleware/auth');

// Dynamic import for ESM-compatible yahoo-finance2
async function getYF() {
  const mod = await import('yahoo-finance2');
  return mod.default;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;
}

function fmtBig(n) {
  if (n == null) return null;
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  return n.toString();
}
function pct(n) { return n != null ? Math.round(n * 1000) / 10 : null; }
function r2(n)  { return n != null ? Math.round(n * 100) / 100 : null; }

// GET /api/yahoo/:ticker
router.get('/prices/:tickers', auth, async (req, res) => {
  const tickers = req.params.tickers.split(',').map(t => t.trim().toUpperCase()).slice(0, 20);
  const yf = await getYF();
  yf.setGlobalConfig({ validation: { logErrors: false } });

  const results = {};
  await Promise.allSettled(tickers.map(async ticker => {
    try {
      const q = await yf.quote(ticker);
      const det = await yf.quoteSummary(ticker, {
        modules: ['summaryDetail', 'financialData']
      }).catch(() => ({}));
      const d = det.summaryDetail || {};

      const dy = q.dividendYield != null
        ? Math.round(q.dividendYield * 1000) / 10
        : (d.dividendYield != null ? Math.round(d.dividendYield * 1000) / 10 : null);

      results[ticker] = {
        price:    r2(q.regularMarketPrice),
        currency: q.currency || 'USD',
        divYield: dy,
        sector:   q.sector || (q.quoteType === 'ETF' ? 'ETF / Index' : null),
        name:     q.longName || q.shortName || ticker,
      };
    } catch(e) {
      results[ticker] = null;
    }
  }));

  res.json(results);
});

router.get('/:ticker', auth, async (req, res) => {
  const ticker = req.params.ticker.toUpperCase().trim();
  const yf = await getYF();
  yf.setGlobalConfig({ validation: { logErrors: false } });

  try {
    const [quote, summary, history] = await Promise.allSettled([
      yf.quote(ticker),
      yf.quoteSummary(ticker, {
        modules: ['defaultKeyStatistics','financialData','recommendationTrend','summaryDetail']
      }),
      yf.historical(ticker, {
        period1: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        period2: new Date(),
        interval: '1d'
      })
    ]);

    const q   = quote.status   === 'fulfilled' ? quote.value   : {};
    const s   = summary.status === 'fulfilled' ? summary.value : {};
    const h   = history.status === 'fulfilled' ? history.value : [];
    const fin  = s.financialData        || {};
    const stat = s.defaultKeyStatistics || {};
    const det  = s.summaryDetail        || {};
    const rec  = s.recommendationTrend  || {};

    const closes = h.map(d => d.close).filter(Boolean);
    const rsi = calcRSI(closes);

    let buy = null, hold = null, sell = null, consensus = null, target = null, upside = null;
    if (rec.trend && rec.trend.length > 0) {
      const latest = rec.trend[0];
      buy  = (latest.strongBuy || 0) + (latest.buy || 0);
      hold = latest.hold || 0;
      sell = (latest.sell || 0) + (latest.strongSell || 0);
      const total = buy + hold + sell;
      if (total > 0) {
        const score = (buy * 2 + hold * 1) / total;
        consensus = score >= 1.5 ? 'Buy' : score >= 0.75 ? 'Hold' : 'Sell';
      }
    }
    target = fin.targetMeanPrice ?? null;
    if (target && q.regularMarketPrice) {
      upside = r2((target - q.regularMarketPrice) / q.regularMarketPrice * 100);
    }

    res.json({
      ticker, name: q.longName || q.shortName || ticker,
      exchange: q.fullExchangeName || q.exchange || null,
      currency: q.currency || 'USD', isETF: q.quoteType === 'ETF',
      price: r2(q.regularMarketPrice), change: r2(q.regularMarketChange),
      changePct: r2(q.regularMarketChangePercent), marketCap: fmtBig(q.marketCap),
      week52High: r2(q.fiftyTwoWeekHigh), week52Low: r2(q.fiftyTwoWeekLow),
      peTTM: r2(q.trailingPE ?? stat.trailingPE), peFwd: r2(q.forwardPE ?? stat.forwardPE),
      pb: r2(stat.priceToBook), evEbitda: r2(stat.enterpriseToEbitda),
      divYield: q.dividendYield != null ? r2(q.dividendYield * 100)
              : (det.dividendYield != null ? r2(det.dividendYield * 100) : null),
      epsTTM: r2(q.epsTrailingTwelveMonths), epsFwd: r2(q.epsForward),
      revenueGrowth: pct(fin.revenueGrowth), grossMargin: pct(fin.grossMargins),
      netMargin: pct(fin.profitMargins), operatingMargin: pct(fin.operatingMargins),
      debtEq: r2(fin.debtToEquity != null ? fin.debtToEquity / 100 : null),
      roe: pct(fin.returnOnEquity), roa: pct(fin.returnOnAssets),
      freeCashflow: fmtBig(fin.freeCashflow),
      rsi, sma50: r2(q.fiftyDayAverage), sma200: r2(q.twoHundredDayAverage), beta: r2(stat.beta),
      analystConsensus: consensus, analystBuy: buy, analystHold: hold, analystSell: sell,
      analystTarget: r2(target), upside,
    });
  } catch(e) {
    console.error('Yahoo error:', ticker, e.message);
    res.status(500).json({ error: 'Ошибка Yahoo Finance: ' + e.message });
  }
});

module.exports = router;