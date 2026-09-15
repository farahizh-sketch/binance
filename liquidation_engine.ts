import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const LIQUIDATION_THRESHOLD = 0.95;

Deno.serve(async () => {
  try {
    const { data: positions, error: posErr } = await supabase.from('positions').select('*');
    if (posErr) throw posErr;
    if (!positions?.length) return new Response(JSON.stringify({ message: 'No open positions' }), { status: 200 });

    const { data: prices } = await supabase.from('live_prices').select('symbol, bid, ask, updated_at');
    const priceMap: Record<string, any> = {};
    (prices || []).forEach((p: any) => { priceMap[p.symbol] = p; });

    const byUser: Record<string, any[]> = {};
    positions.forEach((pos: any) => {
      if (!byUser[pos.mobile]) byUser[pos.mobile] = [];
      byUser[pos.mobile].push(pos);
    });

    const mobiles = Object.keys(byUser);
    const { data: profiles } = await supabase.from('profiles').select('mobile, wallet_balance').in('mobile', mobiles);
    const walletMap: Record<string, number> = {};
    (profiles || []).forEach((p: any) => { walletMap[p.mobile] = parseFloat(p.wallet_balance); });

    const liquidated: string[] = [];

    for (const [mobile, userPositions] of Object.entries(byUser)) {
      const wallet = walletMap[mobile] ?? 0;
      if (wallet <= 0) continue;

      let totalPnl = 0;
      for (const pos of userPositions) {
        const price = priceMap[pos.symbol];
        if (!price) continue;
        const ageMs = Date.now() - new Date(price.updated_at).getTime();
        if (ageMs > 30000) continue; // skip stale prices
        const qty     = parseFloat(pos.quantity);
        const isShort = qty < 0;
        const ltp     = isShort ? price.ask : price.bid;
        const pnl     = isShort
          ? (pos.entry_price - ltp) * Math.abs(qty)
          : (ltp - pos.entry_price) * Math.abs(qty);
        totalPnl += pnl;
      }

      if (totalPnl <= -(wallet * LIQUIDATION_THRESHOLD)) {
        console.log(`[LIQUIDATION] ${mobile} PnL: ${totalPnl.toFixed(2)}, Wallet: ${wallet}`);
        let newWallet = wallet;

        for (const pos of userPositions) {
          const price = priceMap[pos.symbol];
          if (!price) continue;
          const qty        = parseFloat(pos.quantity);
          const isShort    = qty < 0;
          const absQty     = Math.abs(qty);
          const closePrice = isShort ? price.ask : price.bid;
          const pnl        = isShort
            ? (pos.entry_price - closePrice) * absQty
            : (closePrice - pos.entry_price) * absQty;
          newWallet = Math.max(0, newWallet + pnl);

          await supabase.from('positions').delete().eq('id', pos.id);
          await supabase.from('orders').insert({ mobile, symbol: pos.symbol, side: 'SELL', quantity: pos.quantity, price: closePrice, created_at: new Date().toISOString() });
          await supabase.from('ledger').insert({ mobile, type: pnl >= 0 ? 'CREDIT' : 'DEBIT', amount: Math.abs(pnl), balance_after: Math.max(0, newWallet), narration: `LIQUIDATION - ${pos.symbol} x${absQty} @ ${closePrice} | P&L: ${pnl.toFixed(2)}`, created_at: new Date().toISOString() });
        }

        await supabase.from('profiles').update({ wallet_balance: Math.max(0, newWallet) }).eq('mobile', mobile);
        liquidated.push(mobile);
      }
    }

    return new Response(JSON.stringify({ checked: mobiles.length, liquidated }), { status: 200 });
  } catch (err) {
    console.error('[LIQUIDATION ERROR]', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
