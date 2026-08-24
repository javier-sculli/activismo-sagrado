-- ============================================================
-- Activismo Sagrado · esquema de inscripciones
-- Ejecutar en Supabase → SQL Editor → New query → Run
-- ============================================================

create table if not exists public.enrollments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  plan        text not null check (plan in ('minimo','estandar','abundante','becado')),
  status      text not null default 'pending' check (status in ('pending','paid','cancelled')),
  mp_payment_id text,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);

-- Una sola inscripción por usuario (al taller actual).
create unique index if not exists enrollments_user_unique on public.enrollments (user_id);
create index if not exists enrollments_email_idx on public.enrollments (email);

-- ---------- Row Level Security ----------
alter table public.enrollments enable row level security;

-- El usuario autenticado puede crear SU propia inscripción.
drop policy if exists "insert own enrollment" on public.enrollments;
create policy "insert own enrollment"
  on public.enrollments for insert
  to authenticated
  with check (auth.uid() = user_id);

-- El usuario autenticado puede ver SUS propias inscripciones.
drop policy if exists "select own enrollment" on public.enrollments;
create policy "select own enrollment"
  on public.enrollments for select
  to authenticated
  using (auth.uid() = user_id);

-- Nota: NO hay policy de UPDATE/DELETE para usuarios.
-- El webhook de Mercado Pago usa la service_role key (bypassa RLS)
-- para marcar status = 'paid'. El acceso al pago NUNCA se concede
-- desde el cliente: solo el webhook confirma el pago.

-- ============================================================
-- Taller "La Post Humanidad" (economía del regalo, sin cuenta)
-- El monto lo elige quien se inscribe (piso simbólico de $1.000).
-- No requiere auth.users: se anota con nombre + email desde un
-- formulario simple, y el servidor (service_role) es el único que
-- puede marcarlo como pagado.
-- ============================================================

create table if not exists public.taller_signups (
  id          uuid primary key default gen_random_uuid(),
  workshop    text not null default 'taller-ia-la-post-humanidad',
  full_name   text not null,
  email       text not null,
  phone       text not null,
  aporte      integer not null check (aporte >= 1000),
  status      text not null default 'pending' check (status in ('pending','paid','cancelled')),
  mp_payment_id text,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);

-- Por si la tabla ya existía de una corrida previa de este script sin la
-- columna phone (idempotente: no rompe si ya está o si la tabla es nueva).
alter table public.taller_signups add column if not exists phone text;

create index if not exists taller_signups_email_idx on public.taller_signups (email);
create index if not exists taller_signups_workshop_idx on public.taller_signups (workshop);

-- RLS: esta tabla no se lee ni escribe con la anon key desde el cliente.
-- Los inserts y updates los hace únicamente el servidor con la
-- service_role key (endpoints /api/taller-signup y el webhook de MP).
alter table public.taller_signups enable row level security;
