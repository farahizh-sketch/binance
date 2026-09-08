// api/supabase.js
// Vercel serverless function — all DB operations go through here.
// The service_role key is only on the server, never in the browser.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function getIST() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' })
    .replace(' ', 'T') + '+05:30';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, payload } = req.body;

  try {
    switch (action) {

      // ── AUTH ──────────────────────────────────────────────────────────────
      case 'login': {
        const { mobile, password } = payload;
        const { data, error } = await supabase
          .from('profiles').select('*').eq('mobile', mobile).single();
        if (error || !data) return res.json({ error: 'User not found' });
        if (data.password !== password) return res.json({ error: 'Incorrect Password', status: 401 });
        return res.json({ data });
      }

      // ── PROFILE ───────────────────────────────────────────────────────────
      case 'getProfile': {
        const { data, error } = await supabase
          .from('profiles').select('*').eq('mobile', payload.mobile).single();
        return res.json({ data, error });
      }
      case 'getAllProfiles': {
        const { data, error } = await supabase
          .from('profiles').select('*').eq('is_admin', false).order('mobile');
        return res.json({ data, error });
      }
      case 'updateProfile': {
        const { data, error } = await supabase
          .from('profiles').update(payload.data).eq('mobile', payload.mobile).select().single();
        return res.json({ data, error });
      }
      case 'createUser': {
        const { mobile, password, wallet_balance = 100000 } = payload;
        const { data, error } = await supabase
          .from('profiles').insert({ mobile, password, wallet_balance }).select().single();
        return res.json({ data, error });
      }

      // ── WALLET + LEDGER ───────────────────────────────────────────────────
      case 'updateWalletWithLedger': {
        const { mobile, newBalance, type, amount, narration } = payload;
        const [walletRes, ledgerRes] = await Promise.all([
          supabase.from('profiles')
            .update({ wallet_balance: newBalance }).eq('mobile', mobile).select().single(),
          supabase.from('ledger')
            .insert({ mobile, type, amount, balance_after: newBalance, narration, created_at: getIST() })
        ]);
        return res.json({ data: walletRes.data, error: walletRes.error || ledgerRes.error });
      }
      case 'getAllLedger': {
        const q = supabase.from('ledger').select('*').order('created_at', { ascending: false });
        if (payload.mobile) q.eq('mobile', payload.mobile);
        const { data, error } = await q;
        return res.json({ data, error });
      }
      case 'addJVEntry': {
        const { mobile, type, amount, narration } = payload;
        const { data: prof } = await supabase
          .from('profiles').select('wallet_balance').eq('mobile', mobile).single();
        if (!prof) return res.json({ error: 'User not found' });
        const newBalance = type === 'CREDIT'
          ? parseFloat(prof.wallet_balance) + amount
          : parseFloat(prof.wallet_balance) - amount;
        const [w, l] = await Promise.all([
          supabase.from('profiles').update({ wallet_balance: newBalance }).eq('mobile', mobile),
          supabase.from('ledger').insert({ mobile, type, amount, balance_after: newBalance, narration, created_at: getIST() })
        ]);
        return res.json({ error: w.error || l.error });
      }

      // ── POSITIONS ─────────────────────────────────────────────────────────
      case 'addPosition': {
        const { mobile, symbol, side, quantity, entry_price } = payload;
        const { data, error } = await supabase
          .from('positions')
          .insert({ mobile, symbol, side, quantity, entry_price, opened_at: getIST() })
          .select().single();
        return res.json({ data, error });
      }
      case 'deletePosition': {
        const { error } = await supabase.from('positions').delete().eq('id', payload.id);
        return res.json({ error });
      }
      case 'getPositions': {
        const { data, error } = await supabase
          .from('positions').select('*').eq('mobile', payload.mobile).order('opened_at', { ascending: false });
        return res.json({ data, error });
      }
      case 'getAllPositions': {
        const { data, error } = await supabase
          .from('positions').select('*').order('opened_at', { ascending: false });
        return res.json({ data, error });
      }

      // ── ORDERS ────────────────────────────────────────────────────────────
      case 'placeOrder': {
        const { mobile, symbol, side, quantity, price } = payload;
        const { data, error } = await supabase
          .from('orders')
          .insert({ mobile, symbol, side, quantity, price, created_at: getIST() })
          .select().single();
        return res.json({ data, error });
      }
      case 'getOrders': {
        const { data, error } = await supabase
          .from('orders').select('*').eq('mobile', payload.mobile).order('created_at', { ascending: false });
        return res.json({ data, error });
      }
      case 'getAllOrders': {
        const { data, error } = await supabase
          .from('orders').select('*').order('created_at', { ascending: false });
        return res.json({ data, error });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[API ERROR]', action, err);
    return res.status(500).json({ error: err.message });
  }
};
