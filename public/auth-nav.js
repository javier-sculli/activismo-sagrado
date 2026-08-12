// Control de cuenta en la nav (compartido por todas las páginas).
// Muestra "Ingresar" si no hay sesión, o "Mis cursos / Salir" si la hay.
//   - Elementos con clase  auth-when-out  -> visibles SOLO sin sesión
//   - Elementos con clase  auth-when-in   -> visibles SOLO con sesión
//   - Elementos con [data-action="logout"] -> cierran sesión al click
(function(){
  function apply(loggedIn){
    document.querySelectorAll('.auth-when-out').forEach(function(el){
      el.style.display = loggedIn ? 'none' : '';
    });
    document.querySelectorAll('.auth-when-in').forEach(function(el){
      el.style.display = loggedIn ? '' : 'none';
    });
  }
  // Por defecto asumimos deslogueado (evita parpadeo de "Mis cursos").
  apply(false);

  try {
    var cfg = window.SUPABASE_CONFIG;
    if (!cfg || !window.supabase) return;
    var client = window.supabase.createClient(cfg.url, cfg.anonKey);
    window.__asClient = client; // por si otra parte de la página lo necesita

    document.querySelectorAll('[data-action="logout"]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.preventDefault();
        client.auth.signOut().then(function(){ location.href = '/'; });
      });
    });

    client.auth.getSession().then(function(res){
      var session = res.data && res.data.session;
      apply(!!(session && session.user));
    });
  } catch(e){ /* sin config: dejamos "Ingresar" visible */ }
})();
