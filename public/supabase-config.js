// Configuración pública de Supabase (segura para el cliente).
// La service_role key NUNCA va acá: solo en variables de entorno del servidor.
window.SUPABASE_CONFIG = {
  url: 'https://sxpogvzxqiltjeymyflk.supabase.co',
  anonKey: 'sb_publishable_poW_GcPqusnuYTYrDMiFBg_-5K-W80K',
};

// Links de pago de Mercado Pago por plan.
// TODO: reemplazar por los links reales generados en Mercado Pago.
window.MP_LINKS = {
  minimo: 'https://mpago.la/1Zc3wkV',    // $45.000
  estandar: 'https://mpago.la/2rPWDup',  // $65.000
  abundante: 'https://mpago.la/2zVUmN9', // $85.000
};

// Link de PRUEBA (monto chico). Se usa solo cuando la URL trae ?test=true
// OJO: hoy apunta al mismo que Estándar ($65.000); reemplazar por el link real de $1.
window.MP_TEST_LINK = 'https://mpago.la/2rPWDup';

// Detalle de cada plan (para mostrar en la inscripción).
window.PLANES = {
  minimo:    { nombre: 'Mínimo',    precio: '$45.000', tag: 'si hoy es lo que podés' },
  estandar:  { nombre: 'Estándar',  precio: '$65.000', tag: 'aporte justo' },
  abundante: { nombre: 'Abundante', precio: '$85.000', tag: 'tu aporte sostiene a otrxs' },
};
