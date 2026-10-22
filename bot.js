/**
 * ============================================================================
 * 🌌 DIGITALMARKET BOT (Promociones, Campañas y Cupones Festivos)
 * ============================================================================
 */

'use strict';

const API_URL = process.env.API_URL || 'https://digitalmarket-backend.onrender.com';
const BOT_TOKEN = process.env.BOT_TOKEN || '8743289252:AAFkSdl8O8VtQlvkRpnvHbwZShApI65XSNw';
const OFFICIAL_CHANNEL_URL = process.env.OFFICIAL_CHANNEL_URL || 'https://t.me/DigitalMarketOfertas';

async function callBackend(endpoint, method = 'GET', body = null) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API_URL}${endpoint}`, opts);
    return await res.json();
  } catch (err) {
    console.error('Error comunicándose con el Backend API:', err.message);
    return null;
  }
}

async function callTelegram(method, payload = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`❌ [Telegram API Error en ${method}]:`, data.description);
      return null;
    }
    return data.result;
  } catch (err) {
    console.error(`❌ [Error de red en Telegram ${method}]:`, err.message);
    return null;
  }
}

let offset = 0;
const couponSessions = new Map();

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '⭐ Artículos Digitales', callback_data: 'shop:digital' },
        { text: '📦 Artículos Físicos', callback_data: 'shop:physical' },
      ],
      [
        { text: '🛒 Mi Carrito', callback_data: 'cart:view' },
        { text: '🎁 Promociones y Campañas', callback_data: 'menu:promos' },
      ],
      [
        { text: '🛟 Soporte', callback_data: 'menu:support' }
      ]
    ]
  };
}

async function poll() {
  console.log('🤖 Bot de Telegram con Campañas y Cupones iniciado...');
  const me = await callTelegram('getMe');
  if (me && me.username) console.log(`✅ ¡Bot conectado como @${me.username}!`);

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`).catch(() => {});

  while (true) {
    try {
      const updates = await callTelegram('getUpdates', { offset, timeout: 25 });
      if (Array.isArray(updates)) {
        for (const u of updates) {
          offset = u.update_id + 1;
          await handleUpdate(u);
        }
      } else {
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      console.error('Error en polling:', err.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function handleUpdate(u) {
  if (u.pre_checkout_query) {
    await callTelegram('answerPreCheckoutQuery', { pre_checkout_query_id: u.pre_checkout_query.id, ok: true });
    return;
  }

  if (u.message && u.message.successful_payment) {
    const chatId = u.message.chat.id;
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: `✅ <b>¡Pago con Telegram Stars recibido!</b>

Tu orden ha sido procesada con éxito.`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]] }
    });
    return;
  }

  if (u.message && u.message.text) {
    const msg = u.message;
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text.trim();

    if (couponSessions.has(telegramId) && !text.startsWith('/')) {
      couponSessions.delete(telegramId);
      const resCoupon = await callBackend('/cart/apply-coupon', 'POST', { telegramId, code: text });
      
      let replyMsg = '';
      if (resCoupon && resCoupon.success) {
        replyMsg = `✅ <b>¡Campaña Festiva Aplicada con Éxito!</b>
Disfrutas de un <b>${resCoupon.discount.percent_off}% de descuento</b> (${resCoupon.discount.festival_name}).`;
      } else {
        replyMsg = `❌ <b>No se pudo aplicar el cupón:</b> ${resCoupon?.error || 'Código inválido o requisitos no cumplidos.'}`;
      }

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: replyMsg,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛒 Ver Carrito', callback_data: 'cart:view' }],
            [{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]
          ]
        }
      });
      return;
    }

    await callBackend('/users/sync', 'POST', { telegramId, fullName: msg.from.first_name, username: msg.from.username || null });

    if (text.startsWith('/start') || text.startsWith('/menu')) {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `🌌 <b>Bienvenido a DigitalMarket Bot</b>

⚡ Tienda con campañas de ofertas y cupones de descuento activos.`,
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard()
      });
    }
  } else if (u.callback_query) {
    const cb = u.callback_query;
    const chatId = cb.message.chat.id;
    const telegramId = cb.from.id;
    const data = cb.data;

    if (data === 'shop:digital' || data === 'shop:physical') {
      const type = data === 'shop:digital' ? 'DIGITAL' : 'PHYSICAL';
      const products = await callBackend(`/products?type=${type}`);
      let text = `📂 <b>Catálogo (${type}):</b>

`;
      const rows = [];
      if (products && Array.isArray(products)) {
        for (const p of products) {
          const c = p.conversions;
          text += `▫️ <b>${p.name}</b>
` +
                  `   • USD: <b>${p.price_usd} $</b>
` +
                  `   • RUB: ~${c.RUB} ₽ | CUP: ~${c.CUP} CUP
` +
                  `<i>${p.description}</i>

`;
          rows.push([{ text: `➕ Añadir ${p.name}`, callback_data: `buy:${p.id}` }]);
        }
      }
      rows.push([{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]);
      await callTelegram('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
    } else if (data.startsWith('buy:')) {
      const productId = Number(data.split(':')[1]);
      await callBackend('/cart/add', 'POST', { telegramId, productId, quantity: 1 });
      await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ Añadido al carrito' });
    } else if (data === 'cart:view') {
      const cart = await callBackend(`/cart/${telegramId}`);
      let text = `🛒 <b>Tu Carrito de Compras:</b>

`;
      const keyboardRows = [];

      if (cart && cart.items && cart.items.length > 0) {
        for (const item of cart.items) {
          const c = item.conversions;
          text += `▫️ <b>${item.name}</b> (x${item.quantity}) — ${item.total_usd} USD
`;
        }
        
        const tc = cart.conversions;
        if (cart.discountCode) {
          text += `
🎟️ Cupón aplicado: <code>${cart.discountCode}</code> (-${cart.discountUSD} USD)
`;
        }

        text += `
⚡ <b>Total a Pagar:</b>
` +
                `   • <b>${cart.totalUSD} USD</b>
` +
                `   • 🇷🇺 RUB: <b>~${tc.RUB} ₽</b>
` +
                `   • 🇨🇺 CUP: <b>~${tc.CUP} CUP</b>

`;

        text += `💳 <b>Selecciona tu Pasarela de Pago:</b>
`;

        keyboardRows.push([{ text: '🎟️ Canjear Cupón de Campaña', callback_data: 'cart:coupon_prompt' }]);
        keyboardRows.push([{ text: '⚡ USDT (Automatizado vía Bybit API)', callback_data: 'pay:usdt' }]);
        keyboardRows.push([{ text: '⭐ Telegram Stars', callback_data: 'pay:stars' }]);
        keyboardRows.push([{ text: '🇷🇺 SBP / Tarjeta RUB (Rusia)', callback_data: 'pay:sbp' }]);
        keyboardRows.push([{ text: '🇨🇺 Transfermóvil CUP / Clásica (Cuba)', callback_data: 'pay:transfermovil' }]);
        keyboardRows.push([{ text: '🗑️ Vaciar Carrito', callback_data: 'cart:clear' }]);
      } else {
        text += `⚪ <i>Tu carrito está vacío.</i>`;
      }

      keyboardRows.push([{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]);
      await callTelegram('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboardRows } });
    } else if (data === 'cart:clear') {
      await callBackend(`/cart/${telegramId}`, 'DELETE');
      await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: '🗑️ Carrito vaciado' });
      await callTelegram('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: `🛒 <b>Tu Carrito:</b> Vacío.`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]] } });
    } else if (data === 'cart:coupon_prompt') {
      couponSessions.set(telegramId, true);
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        text: `🎟️ <b>Canjear Cupón Festivo</b>
Escribe el código de tu cupón de campaña (ej. <code>MAMAS20</code>, <code>XMAS30</code>, <code>BLACKFRIDAY35</code>):

<i>(Se requiere un mínimo de 2 artículos en el carrito).</i>`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [ [{ text: '❌ Cancelar', callback_data: 'cart:view' }] ] }
      });
    } else if (data === 'menu:promos') {
      const discounts = await callBackend('/discounts');
      let text = `🎁 <b>Campañas y Ofertas Festivas Activas</b>
━━━━━━━━━━━━━━━━━━━━
Aprovecha nuestros cupones estacionales (requieren min. 2 artículos):

`;
      if (discounts && Array.isArray(discounts)) {
        for (const d of discounts) {
          text += `🎉 <b>${d.festival_name}</b>
` +
                  `   ▫️ Código: <code>${d.code}</code>
` +
                  `   ▫️ Descuento: <b>${d.percent_off}% OFF</b>

`;
        }
      }
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 Unirse al Canal Oficial de Ofertas', url: OFFICIAL_CHANNEL_URL }],
            [{ text: '🛒 Ir a mi Carrito', callback_data: 'cart:view' }],
            [{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]
          ]
        }
      });
    } else if (data.startsWith('pay:')) {
      const methodMap = {
        'pay:usdt': 'USDT_BYBIT',
        'pay:stars': 'TELEGRAM_STARS',
        'pay:sbp': 'SBP_RUB',
        'pay:transfermovil': 'TRANSFERMOVIL'
      };
      const provider = methodMap[data] || 'USDT_BYBIT';
      const checkoutRes = await callBackend('/orders/checkout', 'POST', { telegramId, provider });

      if (checkoutRes && checkoutRes.success) {
        const c = checkoutRes.conversions;
        let msg = `✅ <b>¡Orden Generada (#${checkoutRes.order.order_code})!</b>

`;

        if (provider === 'USDT_BYBIT') {
          msg += `⚡ <b>Pago USDT Automatizado (Bybit API):</b>
` +
                 `Monto a pagar: <b>${checkoutRes.totalUSD} USD (USDT)</b>
` +
                 `Envía los USDT a nuestra dirección oficial en red TRC20/TON y la API validará tu depósito automáticamente.`;
        } else if (provider === 'TELEGRAM_STARS') {
          const stars = Math.max(1, Math.ceil((checkoutRes.order.total_cents / 100) * 50));
          await callTelegram('sendInvoice', {
            chat_id: chatId,
            title: `Orden #${checkoutRes.order.order_code}`,
            description: `Pago digital de artículos (${checkoutRes.totalUSD} USD)`,
            payload: checkoutRes.order.order_code,
            currency: 'XTR',
            prices: [{ label: 'Estrellas', amount: stars }]
          });
          return;
        } else if (provider === 'SBP_RUB') {
          msg += `🇷🇺 <b>Datos de Pago SBP / RUB:</b>
` +
                 `Monto exacto: <b>~${c.RUB} RUB (₽)</b>  <i>(Base: ${checkoutRes.totalUSD} USD)</i>

` +
                 `• Teléfono SBP: <code>+79252481911</code>
` +
                 `• O tarjeta directa: <code>2200 2479 5577 1879</code>

` +
                 `<i>Envía tu comprobante con el código de orden #${checkoutRes.order.order_code} para validación.</i>`;
        } else if (provider === 'TRANSFERMOVIL') {
          msg += `🇨🇺 <b>Datos de Pago Transfermóvil (Cuba):</b>
` +
                 `Monto exacto:
` +
                 `• CUP: <b>~${c.CUP} CUP</b>
` +
                 `• MLC / Clásica: <b>~${c.MLC} / ~${c.CLASICA}</b>  <i>(Base: ${checkoutRes.totalUSD} USD)</i>

` +
                 `• Tarjeta CUP: <code>9204 1299 7694 7558</code>
` +
                 `• Tarjeta Clásica/MLC: <code>9760 0390 0983 2477</code>

` +
                 `<i>Envía la captura del comprobante con la orden #${checkoutRes.order.order_code}.</i>`;
        }

        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: cb.message.message_id,
          text: msg,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]] }
        });
      }
    } else if (data === 'menu:support') {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: `🛟 <b>Soporte Técnico:</b>
Escríbenos ante cualquier duda con tu pago.`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Menú Principal', callback_data: 'menu:home' }]] } });
    } else if (data === 'menu:home') {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: `🌌 <b>Menú Principal</b>`, parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() });
    }
  }
}

if (require.main === module) { poll(); }
