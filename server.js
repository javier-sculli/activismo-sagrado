// Servidor de Activismo Sagrado.
// - Sirve el sitio estático desde /public (con URLs limpias, igual que `serve`).
// - Expone el webhook de Mercado Pago en POST /api/mp-webhook.
//
// Variables de entorno (en Railway, NUNCA en el código):
//   SUPABASE_URL                 (ej. https://xxxx.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY    (clave secreta service_role)
//   MP_ACCESS_TOKEN              (Access Token de Mercado Pago, productivo)
//   MP_WEBHOOK_SECRET            (opcional: secret del webhook para validar firma)
//   SIMULATE_SECRET              (opcional: para simular un pago en pruebas)
//   ADMIN_PASSWORD               (clave compartida para ver /admin: el panel de inscriptos)
//   BECA_CODE                    (código secreto para inscripciones becadas con aporte libre)

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  MP_ACCESS_TOKEN,
  MP_WEBHOOK_SECRET,
  SIMULATE_SECRET,
  ADMIN_PASSWORD,
  BECA_CODE,
} = process.env;

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

// Precio por plan (en pesos). El monto real lo decide el server, nunca el cliente.
const PLAN_PRICES = { minimo: 45000, estandar: 65000, abundante: 85000 };

// Taller "La Post Humanidad": economía del regalo, sin cuenta, monto libre.
const TALLER_SLUG = 'taller-ia-la-post-humanidad';
const TALLER_MIN_APORTE = 1000;
const TALLER_MAX_APORTE = 2000000; // tope de sanidad ante errores de tipeo, no un límite de negocio

// Mapa monto -> plan, como último recurso si no viene plan explícito.
function planFromAmount(amount) {
  const a = Math.round(Number(amount) || 0);
  if (a >= 80000) return 'abundante';
  if (a >= 60000) return 'estandar';
  if (a >= 40000) return 'minimo';
  return null;
}

// Marca una inscripción como pagada. Matchea, en orden de confianza:
//   1) user_id (viene en external_reference / metadata) — 100% confiable
//   2) email del pagador
// Si no encuentra fila, la crea como pagada.
async function marcarPagado({ userId, email, paymentId, amount, plan }) {
  if (!supabase) return { ok: false, reason: 'sin supabase' };

  const patch = {
    status: 'paid',
    mp_payment_id: paymentId ? String(paymentId) : null,
    paid_at: new Date().toISOString(),
  };
  if (plan) patch.plan = plan; // permite fijar el plan (ej. 'becado') al confirmar

  // 1) Por user_id (lo más confiable: viene del external_reference que generamos)
  if (userId) {
    const { data: updated, error } = await supabase
      .from('enrollments').update(patch).eq('user_id', userId).select();
    if (error) return { ok: false, reason: error.message };
    if (updated && updated.length) return { ok: true, action: 'updated', by: 'user_id', rows: updated.length };
  }

  // 2) Por email
  const clean = email ? email.toLowerCase().trim() : null;
  if (clean) {
    const { data: updated, error } = await supabase
      .from('enrollments').update(patch).ilike('email', clean).select();
    if (error) return { ok: false, reason: error.message };
    if (updated && updated.length) return { ok: true, action: 'updated', by: 'email', rows: updated.length };
  }

  // 3) No había fila previa: la creamos como pagada (si tenemos con qué).
  if (!clean && !userId) return { ok: false, reason: 'sin identificador (ni user_id ni email)' };
  const finalPlan = plan || planFromAmount(amount) || 'estandar';
  const { error: insErr } = await supabase.from('enrollments').insert({
    user_id: userId || null,
    email: clean || (userId + '@sin-email.local'),
    plan: finalPlan, status: 'paid',
    mp_payment_id: paymentId ? String(paymentId) : null,
    paid_at: new Date().toISOString(),
  });
  if (insErr) return { ok: false, reason: insErr.message };
  return { ok: true, action: 'inserted' };
}

// Marca una inscripción del taller "La Post Humanidad" como pagada.
// A diferencia de marcarPagado() (que matchea por user_id/email), acá matcheamos
// por el id de la fila en taller_signups, que viaja en el metadata/external_reference
// de la preferencia creada en /api/taller-signup. Es el identificador más confiable
// porque no depende de tener cuenta ni de que el email coincida exactamente.
async function marcarPagadoTaller({ signupId, paymentId }) {
  if (!supabase) return { ok: false, reason: 'sin supabase' };
  if (!signupId) return { ok: false, reason: 'sin signup_id' };
  const { data, error } = await supabase
    .from('taller_signups')
    .update({
      status: 'paid',
      mp_payment_id: paymentId ? String(paymentId) : null,
      paid_at: new Date().toISOString(),
    })
    .eq('id', signupId)
    .select();
  if (error) return { ok: false, reason: error.message };
  if (!data || !data.length) return { ok: false, reason: 'inscripción no encontrada' };
  return { ok: true, rows: data.length };
}

// Extrae los identificadores de un objeto pago de Mercado Pago.
function identificadoresDePago(pay) {
  const md = pay.metadata || {};
  return {
    userId: pay.external_reference || md.user_id || md.userId || null,
    email: (pay.payer && pay.payer.email) || md.email || null,
    plan: md.plan || null,
    amount: pay.transaction_amount,
  };
}

// Validación opcional de la firma del webhook de Mercado Pago.
function firmaValida(req) {
  if (!MP_WEBHOOK_SECRET) return true; // si no hay secret configurado, no validamos
  try {
    const sig = req.get('x-signature') || '';
    const reqId = req.get('x-request-id') || '';
    const parts = Object.fromEntries(sig.split(',').map(p => p.split('=').map(s => s.trim())));
    const ts = parts.ts, v1 = parts.v1;
    const dataId = (req.query['data.id'] || (req.body && req.body.data && req.body.data.id) || '').toString().toLowerCase();
    const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
    const hmac = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');
    return !!v1 && crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(v1));
  } catch (e) {
    return false;
  }
}

// --- Webhook de Mercado Pago ---
app.post('/api/mp-webhook', express.json({ type: '*/*' }), async (req, res) => {
  // Respondemos 200 enseguida para que MP no reintente.
  res.sendStatus(200);
  try {
    if (!firmaValida(req)) { console.warn('[webhook] firma inválida'); return; }

    const body = req.body || {};
    const type = body.type || req.query.type || req.query.topic;
    const paymentId = (body.data && body.data.id) || req.query['data.id'] || req.query.id;

    if (type !== 'payment' || !paymentId) { console.log('[webhook] ignorado:', type); return; }
    if (!MP_ACCESS_TOKEN || !supabase) { console.warn('[webhook] faltan env vars'); return; }

    const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    if (!r.ok) { console.warn('[webhook] no se pudo leer el pago', r.status); return; }
    const pay = await r.json();

    if (pay.status !== 'approved') { console.log('[webhook] pago no aprobado:', pay.status); return; }

    const md = pay.metadata || {};
    if (md.workshop === TALLER_SLUG) {
      const result = await marcarPagadoTaller({ signupId: md.signup_id || pay.external_reference, paymentId });
      console.log('[webhook] pago taller', paymentId, JSON.stringify(md), '->', JSON.stringify(result));
      return;
    }

    const ids = identificadoresDePago(pay);
    const result = await marcarPagado({ ...ids, paymentId });
    console.log('[webhook] pago', paymentId, JSON.stringify(ids), '->', JSON.stringify(result));
  } catch (e) {
    console.error('[webhook] error', e);
  }
});

// --- Verificación en el retorno: el cliente vuelve de MP con un payment_id.
//     NO confiamos en ?status=approved (lo controla el usuario): consultamos a MP
//     si ese pago existe y está aprobado en NUESTRA cuenta. Eso no se puede falsificar. ---
app.get('/api/verify-payment', async (req, res) => {
  const id = req.query.payment_id || req.query.collection_id || req.query['data.id'];
  if (!id) return res.json({ paid: false, reason: 'sin payment_id' });
  if (!MP_ACCESS_TOKEN || !supabase) return res.json({ paid: false, reason: 'config' });
  try {
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    if (!r.ok) return res.json({ paid: false, reason: 'no encontrado' });
    const pay = await r.json();
    if (pay.status !== 'approved') return res.json({ paid: false, status: pay.status });
    const ids = identificadoresDePago(pay);
    const result = await marcarPagado({ ...ids, paymentId: id });
    return res.json({ paid: true, ...result });
  } catch (e) {
    return res.json({ paid: false, reason: 'error' });
  }
});

// --- Endpoint de prueba: simular un pago aprobado (solo si SIMULATE_SECRET está seteado) ---
app.post('/api/simulate-paid', express.json(), async (req, res) => {
  if (!SIMULATE_SECRET) return res.status(404).json({ error: 'no disponible' });
  if ((req.query.secret || req.get('x-sim-secret')) !== SIMULATE_SECRET) {
    return res.status(401).json({ error: 'secret inválido' });
  }
  const email = req.query.email || (req.body && req.body.email);
  const amount = req.query.amount || (req.body && req.body.amount);
  const userId = req.query.user_id || (req.body && req.body.user_id);
  if (!email && !userId) return res.status(400).json({ error: 'falta email o user_id' });
  const result = await marcarPagado({ userId, email, paymentId: 'SIMULADO-' + Date.now(), amount });
  res.json(result);
});

// --- Crear preferencia de pago en Mercado Pago (Checkout Pro) ---
//   El cliente NO elige el monto: lo fija el server según el plan (o $1 en modo prueba).
//   external_reference = user_id  -> nos deja matchear el pago con la inscripción al 100%.
//   back_urls + auto_return       -> MP devuelve al usuario al sitio con el payment_id.
app.post('/api/create-preference', express.json(), async (req, res) => {
  if (!MP_ACCESS_TOKEN) return res.status(500).json({ error: 'MP no configurado' });
  const { plan, test, user_id, email } = req.body || {};
  const isTest = test === true || test === 'true';

  const planKey = PLAN_PRICES[plan] ? plan : 'estandar';
  const price = isTest ? 1 : PLAN_PRICES[planKey];

  const origin = (req.get('origin') || `https://${req.get('host')}`).replace(/\/$/, '');
  const back = `${origin}/inscripcion?curso=la-energia-del-dinero` + (isTest ? '&test=true' : '');

  const pref = {
    items: [{
      title: 'Taller: La energía del dinero' + (isTest ? ' (PRUEBA)' : ''),
      quantity: 1,
      currency_id: 'ARS',
      unit_price: price,
    }],
    external_reference: user_id || '',
    metadata: { plan: planKey, user_id: user_id || '', email: email || '' },
    payer: email ? { email } : undefined,
    back_urls: { success: back, pending: back, failure: back },
    auto_return: 'approved',
  };

  try {
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pref),
    });
    const data = await r.json();
    if (!r.ok) {
      console.warn('[create-preference] MP error', r.status, JSON.stringify(data));
      return res.status(502).json({ error: 'no se pudo crear la preferencia', detail: data });
    }
    return res.json({ init_point: data.init_point, preference_id: data.id });
  } catch (e) {
    console.error('[create-preference] error', e);
    return res.status(500).json({ error: 'error interno' });
  }
});

// --- Inscripción becada (aporte libre) ---
//   Valida el código de beca CONTRA EL SERVIDOR (env var BECA_CODE). El navegador
//   no puede falsificar una beca: sin el código correcto, no se crea nada.
//   Genera un "pago ficticio" (mp_payment_id = BECA-<monto>-<ts>) y deja la
//   inscripción como paid con plan 'becado'.
app.post('/api/beca-enroll', express.json(), async (req, res) => {
  if (!BECA_CODE) return res.status(404).json({ error: 'becas no disponibles' });
  const { user_id, email, code, amount } = req.body || {};

  // Comparación en tiempo constante para no filtrar el código.
  const given = Buffer.from(String(code || ''));
  const real = Buffer.from(BECA_CODE);
  const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
  if (!ok) return res.status(401).json({ error: 'código de beca inválido' });

  if (!user_id && !email) return res.status(400).json({ error: 'falta identificación' });

  const aporte = Math.max(0, Math.round(Number(amount) || 0));
  const result = await marcarPagado({
    userId: user_id,
    email,
    paymentId: 'BECA-' + aporte + '-' + Date.now(),
    amount: aporte,
    plan: 'becado',
  });
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

// --- Inscripción al taller "La Post Humanidad" (economía del regalo) ---
//   Sin cuenta: solo nombre + email. Quien se inscribe elige su propio aporte
//   (piso de $1.000). Guardamos la fila como 'pending' y armamos la preferencia
//   de Mercado Pago con ESE monto (el server la crea, pero el número lo eligió
//   la persona en el formulario, no un plan fijo). El id de la fila viaja en el
//   metadata para poder confirmarlo de forma inequívoca al volver de MP.
app.post('/api/taller-signup', express.json(), async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'sin supabase' });
  if (!MP_ACCESS_TOKEN) return res.status(500).json({ error: 'MP no configurado' });

  const { name, email, aporte } = req.body || {};
  const cleanName = (name || '').toString().trim();
  const cleanEmail = (email || '').toString().trim().toLowerCase();
  const monto = Math.round(Number(aporte));

  if (!cleanName) return res.status(400).json({ error: 'Falta el nombre.' });
  if (!cleanEmail || !/^\S+@\S+\.\S+$/.test(cleanEmail)) return res.status(400).json({ error: 'Email inválido.' });
  if (!Number.isFinite(monto) || monto < TALLER_MIN_APORTE || monto > TALLER_MAX_APORTE) {
    return res.status(400).json({ error: `El aporte debe ser un número entre $${TALLER_MIN_APORTE} y $${TALLER_MAX_APORTE}.` });
  }

  const { data: inserted, error: insErr } = await supabase
    .from('taller_signups')
    .insert({ workshop: TALLER_SLUG, full_name: cleanName, email: cleanEmail, aporte: monto, status: 'pending' })
    .select()
    .single();
  if (insErr) return res.status(500).json({ error: insErr.message });

  const origin = (req.get('origin') || `https://${req.get('host')}`).replace(/\/$/, '');
  const back = `${origin}/${TALLER_SLUG}?signup_id=${inserted.id}`;

  const pref = {
    items: [{
      title: 'Taller: La Post Humanidad (aporte libre)',
      quantity: 1,
      currency_id: 'ARS',
      unit_price: monto,
    }],
    external_reference: inserted.id,
    metadata: { workshop: TALLER_SLUG, signup_id: inserted.id, email: cleanEmail },
    payer: { email: cleanEmail },
    back_urls: { success: back, pending: back, failure: back },
    auto_return: 'approved',
  };

  try {
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pref),
    });
    const data = await r.json();
    if (!r.ok) {
      console.warn('[taller-signup] MP error', r.status, JSON.stringify(data));
      return res.status(502).json({ error: 'No se pudo crear el pago.', detail: data });
    }
    return res.json({ init_point: data.init_point, signup_id: inserted.id });
  } catch (e) {
    console.error('[taller-signup] error', e);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// --- Verificación en el retorno del taller: igual que /api/verify-payment pero
//     matcheando contra taller_signups por signup_id (no por user_id/email). ---
app.get('/api/taller-verify-payment', async (req, res) => {
  const id = req.query.payment_id || req.query.collection_id || req.query['data.id'];
  if (!id) return res.json({ paid: false, reason: 'sin payment_id' });
  if (!MP_ACCESS_TOKEN || !supabase) return res.json({ paid: false, reason: 'config' });
  try {
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    if (!r.ok) return res.json({ paid: false, reason: 'no encontrado' });
    const pay = await r.json();
    if (pay.status !== 'approved') return res.json({ paid: false, status: pay.status });
    const md = pay.metadata || {};
    if (md.workshop !== TALLER_SLUG) return res.json({ paid: false, reason: 'no corresponde a este taller' });
    const result = await marcarPagadoTaller({ signupId: md.signup_id || pay.external_reference, paymentId: id });
    return res.json({ paid: true, ...result });
  } catch (e) {
    return res.json({ paid: false, reason: 'error' });
  }
});

// --- Panel admin: lista de inscriptos al taller "La Post Humanidad" ---
app.get('/api/admin/taller-signups', async (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'panel no configurado' });
  const key = req.get('x-admin-key') || req.query.key;
  if (key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'no autorizado' });
  if (!supabase) return res.status(500).json({ error: 'sin supabase' });

  const { data, error } = await supabase
    .from('taller_signups')
    .select('id,full_name,email,aporte,status,mp_payment_id,created_at,paid_at')
    .eq('workshop', TALLER_SLUG)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ signups: data || [] });
});

// --- Panel admin: lista completa de inscriptos ---
//   Usa la service_role key (bypassa RLS) para devolver TODAS las inscripciones.
//   Protegido por ADMIN_PASSWORD (clave compartida). Sin esa env var, queda deshabilitado.
app.get('/api/admin/enrollments', async (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'panel no configurado' });
  const key = req.get('x-admin-key') || req.query.key;
  if (key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'no autorizado' });
  if (!supabase) return res.status(500).json({ error: 'sin supabase' });

  const { data, error } = await supabase
    .from('enrollments')
    .select('id,email,full_name,plan,status,mp_payment_id,created_at,paid_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ enrollments: data || [] });
});

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, supabase: !!supabase, mp: !!MP_ACCESS_TOKEN, simulate: !!SIMULATE_SECRET, admin: !!ADMIN_PASSWORD });
});

// --- Sitio estático (URLs limpias: /la-energia-del-dinero -> .html) ---
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.listen(PORT, () => console.log('Activismo Sagrado escuchando en :' + PORT));
