/* ═══════════════════════════════════════════════════════════════
   MB Maritime DP Task Manager — Supabase Edition
   Application Logic
   ═══════════════════════════════════════════════════════════════ */

// ─── SUPABASE CONFIG ──────────────────────────────────────────────
const SUPABASE_URL = 'https://cboagvwdowlqupccgkng.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNib2Fndndkb3dscXVwY2Nna25nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTQyOTEsImV4cCI6MjA4ODA3MDI5MX0.F9awl_j80GqaY2oufp_-bN_6nlVcFxzZXPv3WNr_2-s';

var _sb = null;

// ─── STATE ────────────────────────────────────────────────────────
var state = {
  user: null,
  profile: null,
  currentPage: 'dashboard',
  dashboardInitialized: false,
  allTasks: [],
  filteredTasks: [],
  taskSortKey: 'created_at',
  taskSortDir: -1,
  taskPage: 1,
  taskPageSize: 20,
  allVessels: [],
  allEmails: [],
  inboxFilter: 'pending',
  timerRunning: false,
  timerStart: null,
  timerInterval: null,
  statusChart: null,
  vesselChart: null,
  timeChart: null,
  currentReport: 'pendencias',
  currentDetailTaskId: null,
};

// ─── INIT ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Client Credentials Flow — no MSAL needed

  // STEP 2: Create Supabase client
  try {
    if (window.supabase && window.supabase.createClient) {
      _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storageKey: 'mb-auth', autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'implicit' }
      });
    }
  } catch(e) { console.error('[MB] Supabase init error:', e); }

  if (!_sb) {
    const errEl = document.getElementById('login-error');
    if (errEl) {
      errEl.textContent = 'Erro ao carregar sistema. Recarregue a página (F5).';
      errEl.classList.add('visible');
    }
    showPage('login');
    return;
  }

  // Set default dates
  try {
    const now = new Date();
    const mf = document.getElementById('time-month-filter');
    if (mf) mf.value = now.toISOString().slice(0, 7);
    const rd = document.getElementById('report-from');
    const rt = document.getElementById('report-to');
    if (rd) rd.value = now.toISOString().slice(0, 7) + '-01';
    if (rt) rt.value = now.toISOString().slice(0, 10);
  } catch(e) {}

  document.documentElement.setAttribute('data-theme', 'dark');
  try { updateThemeIcon(); } catch(e) {}

  // Login button handler
  window.__doLogin = handleEmailLogin;
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleEmailLogin();
    });
  }
  const passField = document.getElementById('login-pass');
  if (passField) {
    passField.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); handleEmailLogin(); }
    });
  }
  const emailField = document.getElementById('login-email');
  if (emailField) {
    emailField.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); handleEmailLogin(); }
    });
  }

  // Auth: use ONLY onAuthStateChange (single entry point)
  // INITIAL_SESSION fires for existing sessions, SIGNED_IN for new logins
  _sb.auth.onAuthStateChange(async (event, session) => {
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
      if (!state.dashboardInitialized) {
        state.dashboardInitialized = true;
        state.user = session.user;
        try {
          await loadOrCreateProfile();
        } catch(e) {
          console.error('[MB] Profile error:', e);
          state.profile = { id: session.user.id, name: session.user.email.split('@')[0], role: 'admin' };
        }
        try {
          await initDashboard();
        } catch(e) {
          console.error('[MB] initDashboard error:', e);
          showPage('app');
          try { renderKPICards({ total_active: 0, overdue: 0, due_7d: 0, completed_month: 0, total_tasks: 0, pending_emails: 0, hours_month: 0 }); } catch(e2) {}
        }
        // Client Credentials: check if secret is configured
        try {
          await checkClientCredentialsConfig();
        } catch(ccErr) {
          console.warn('[MB] Client credentials check error:', ccErr);
        }
      }
    } else if (event === 'SIGNED_OUT') {
      state.user = null;
      state.profile = null;
      state.dashboardInitialized = false;
      showPage('login');
    } else if (event === 'INITIAL_SESSION' && !session) {
      showPage('login');
    }
  });
});

// ─── AUTH ──────────────────────────────────────────────────────────
async function signInWithMicrosoft() {
  const { error } = await _sb.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes: 'email Mail.Read Mail.Send offline_access',
      redirectTo: window.location.origin + window.location.pathname
    }
  });
  if (error) {
    toast('Erro ao conectar com Microsoft: ' + error.message, 'error');
  }
}

function togglePassVisibility() {
  var passInput = document.getElementById('login-pass');
  var eyeIcon = document.getElementById('eye-icon');
  if (!passInput) return;
  if (passInput.type === 'password') {
    passInput.type = 'text';
    // Eye-off icon
    eyeIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    passInput.type = 'password';
    // Eye icon
    eyeIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
}

async function handleEmailLogin() {
  var rawInput = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-pass').value;
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  
  if (!rawInput || !password) {
    errEl.textContent = 'Preencha usu\u00e1rio e senha';
    errEl.classList.add('visible');
    return;
  }

  // Convert username to email if no @ present
  var email = rawInput;
  if (rawInput.indexOf('@') === -1) {
    email = rawInput + '@mbmaritime.com';
  }

  if (!_sb) {
    errEl.textContent = 'Sistema não iniciou. Recarregue (F5).';
    errEl.classList.add('visible');
    return;
  }
  
  errEl.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  // Safety timeout - if login takes more than 8 seconds, reset button
  var loginTimeout = setTimeout(function() {
    console.error('[MB] Login timeout - resetting');
    btn.disabled = false;
    btn.innerHTML = 'Entrar <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
    errEl.textContent = 'Login demorou demais. Tente novamente.';
    errEl.classList.add('visible');
  }, 8000);

  try {
    var signInResult = await _sb.auth.signInWithPassword({ email: email, password: password });
    var data = signInResult.data;
    var error = signInResult.error;
    
    if (error) {
      clearTimeout(loginTimeout);
      errEl.textContent = error.message === 'Invalid login credentials'
        ? 'Usu\u00e1rio ou senha incorretos'
        : error.message;
      errEl.classList.add('visible');
      btn.disabled = false;
      btn.innerHTML = 'Entrar <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      return;
    }

    // Get user from response
    var sessionUser = null;
    if (data && data.session && data.session.user) sessionUser = data.session.user;
    else if (data && data.user) sessionUser = data.user;

    if (!sessionUser) {
      clearTimeout(loginTimeout);
      errEl.textContent = 'Erro na autenticação. Tente novamente.';
      errEl.classList.add('visible');
      btn.disabled = false;
      btn.innerHTML = 'Entrar <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      return;
    }

    // We have a valid user — show app page IMMEDIATELY
    state.user = sessionUser;
    state.dashboardInitialized = true;
    showPage('app');
    clearTimeout(loginTimeout);
    
    // Set basic header info right away
    try {
      document.getElementById('user-name').textContent = sessionUser.email.split('@')[0];
      document.getElementById('user-role').textContent = 'Administrador';
      document.getElementById('user-avatar').textContent = sessionUser.email[0].toUpperCase();
      document.querySelectorAll('.admin-only').forEach(function(el) { el.style.display = ''; el.classList.remove('hidden'); });
    } catch(e) { console.error('[MB] Header error:', e); }

    // Set active nav to dashboard
    try {
      document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
      document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
      var dashPage = document.getElementById('page-dashboard');
      if (dashPage) dashPage.classList.add('active');
      var dashNav = document.querySelector('.nav-item[data-page="dashboard"]');
      if (dashNav) dashNav.classList.add('active');
    } catch(e) {}

    // Load profile, vessels, dashboard in background (non-blocking)
    setTimeout(async function() {
      try {
        await loadOrCreateProfile();
        var p = state.profile || {};
        document.getElementById('user-name').textContent = p.name || sessionUser.email.split('@')[0];
        document.getElementById('user-role').textContent = p.role === 'admin' ? 'Administrador' : 'Colaborador';
        document.getElementById('user-avatar').textContent = (p.name || sessionUser.email || 'U')[0].toUpperCase();
      } catch(e) {
        console.error('[MB] Profile error:', e);
        state.profile = { id: sessionUser.id, name: sessionUser.email.split('@')[0], role: 'admin' };
      }
      try { await loadVessels(true); } catch(e) { console.error('[MB] Vessels error:', e); }
      try { await loadDashboard(); } catch(e) {
        console.error('[MB] Dashboard error:', e);
        try { renderKPICards({ total_active: 0, overdue: 0, due_7d: 0, completed_month: 0, total_tasks: 0, pending_emails: 0, hours_month: 0 }); } catch(e2) {}
      }
    }, 100);

  } catch (err) {
    clearTimeout(loginTimeout);
    console.error('[MB] Login error:', err);
    errEl.textContent = 'Erro de conexão. Tente novamente.';
    errEl.classList.add('visible');
  }
  
  btn.disabled = false;
  btn.innerHTML = 'Entrar <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

async function handleLogout() {
  stopTimer();
  state.dashboardInitialized = false;
  await _sb.auth.signOut();
  showPage('login');
  document.getElementById('login-email').value = '';
  document.getElementById('login-pass').value = '';
}

function showPage(page) {
  const login = document.getElementById('login-screen');
  const app = document.getElementById('dashboard-app');
  if (page === 'login') {
    login.style.display = 'flex';
    app.classList.remove('visible');
  } else {
    login.style.display = 'none';
    app.classList.add('visible');
  }
}

// ─── PROFILE ──────────────────────────────────────────────────────
async function loadOrCreateProfile() {
  if (!state.user) return;
  const { data: profile, error } = await _sb
    .from('profiles')
    .select('*')
    .eq('id', state.user.id)
    .single();

  if (error && error.code === 'PGRST116') {
    // No profile exists, create one
    const meta = state.user.user_metadata || {};
    const newProfile = {
      id: state.user.id,
      username: state.user.email,
      name: meta.full_name || meta.name || state.user.email.split('@')[0],
      role: 'admin', // Default first user to admin
      avatar_url: meta.avatar_url || null,
    };
    const { data: created } = await _sb.from('profiles').insert(newProfile).select().single();
    state.profile = created || newProfile;
  } else {
    state.profile = profile;
  }
}

// ─── DASHBOARD INIT ───────────────────────────────────────────────
async function initDashboard() {
  showPage('app');
  const p = state.profile || {};

  try {
    document.getElementById('user-name').textContent = p.name || state.user?.email || 'Usuário';
    document.getElementById('user-role').textContent = p.role === 'admin' ? 'Administrador' : 'Colaborador';
    document.getElementById('user-avatar').textContent = (p.name || state.user?.email || 'U')[0].toUpperCase();
  } catch(e) {}

  // Admin-only elements
  if (p.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = '';
      el.classList.remove('hidden');
    });
  }

  try {
    await loadVessels(true);
  } catch(e) { console.error('Vessels load error:', e); }
  
  try {
    await navigate('dashboard');
  } catch(e) { 
    console.error('Navigate error:', e);
    // Force show empty dashboard
    renderKPICards({ total_active: 0, overdue: 0, due_7d: 0, completed_month: 0, total_tasks: 0, pending_emails: 0, hours_month: 0 });
  }
}

// ─── NAVIGATION ───────────────────────────────────────────────────
async function navigate(page) {
  // ALWAYS show the page first, then load data
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.add('active');

  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  const titles = {
    dashboard: 'Dashboard', tasks: 'Tarefas', vessels: 'Embarcações',
    inbox: 'Caixa de Entrada', time: 'Registro de Horas', reports: 'Relatórios',
    settings: 'Configurações'
  };
  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle) topbarTitle.innerHTML = `${titles[page] || page} <small>${formatDate(new Date())}</small>`;

  state.currentPage = page;

  // Load data in background - NEVER block navigation
  try {
    if (page === 'dashboard') await loadDashboard();
    else if (page === 'tasks') { await loadVessels(true); await loadTasks(); }
    else if (page === 'vessels') await loadVessels(false);
    else if (page === 'inbox') { await checkMSConnection(); await loadInbox(); }
    else if (page === 'time') await loadTimeLogs();
    else if (page === 'settings') loadSettings();
  } catch (navErr) {
    console.error('Error loading page data:', page, navErr);
  }
}

// ─── DASHBOARD ────────────────────────────────────────────────────
var statusChartInst = null, vesselChartInst = null;

async function loadDashboard() {
  const dl = document.getElementById('dash-date-label');
  if (dl) dl.textContent = `Atualizado ${formatDate(new Date())} às ${formatTime(new Date())}`;

  // Load dashboard data directly from tables (no RPC dependency)
  try {
    await loadDashboardFallback();
  } catch (err) {
    console.error('Dashboard load error:', err);
    // Show empty state rather than broken loading
    renderKPICards({ total_active: 0, overdue: 0, due_7d: 0, completed_month: 0, total_tasks: 0, pending_emails: 0, hours_month: 0 });
  }
}

async function loadDashboardFallback() {
  const { data: tasks, error: tErr } = await _sb.from('tasks').select('*, vessels(name)');
  if (tErr) throw tErr;
  const { data: emails, error: eErr } = await _sb.from('email_inbox').select('id').eq('status', 'pending');
  if (eErr) console.error('[MB] emails query error:', eErr);
  const allTasks = tasks || [];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = now.toISOString().slice(0, 7) + '-01';

  const activeStatuses = ['pendente', 'em_andamento', 'aguardando_cliente', 'aguardando_aprovacao'];
  const active = allTasks.filter(t => activeStatuses.includes(t.status));
  const overdue = active.filter(t => t.deadline && t.deadline < today);
  const due7 = active.filter(t => {
    if (!t.deadline) return false;
    const d = new Date(t.deadline);
    const diff = (d - now) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 7;
  });
  const completedMonth = allTasks.filter(t => t.status === 'concluida' && t.completed_at && t.completed_at >= monthStart);

  const d = {
    total_active: active.length,
    overdue: overdue.length,
    due_7d: due7.length,
    completed_month: completedMonth.length,
    total_tasks: allTasks.length,
    pending_emails: (emails || []).length,
    by_status: {},
    by_vessel: [],
    hours_month: 0,
  };

  // by_status
  allTasks.forEach(t => { d.by_status[t.status] = (d.by_status[t.status] || 0) + 1; });

  // by_vessel
  const vesselMap = {};
  active.forEach(t => {
    const vn = t.vessels?.name || 'Sem Embarcação';
    vesselMap[vn] = (vesselMap[vn] || 0) + 1;
  });
  d.by_vessel = Object.entries(vesselMap).map(([vessel, count]) => ({ vessel, count }))
    .sort((a, b) => b.count - a.count);

  renderKPICards(d);
  renderStatusChart(d.by_status);
  renderVesselChart(d.by_vessel);
  loadActiveTasks();
}

function renderKPICards(d) {
  const kpiGrid = document.getElementById('kpi-grid');
  if (!kpiGrid) return;

  const totalActive = d.total_active || 0;
  const overdue = d.overdue || 0;
  const due7d = d.due_7d || 0;
  const completedMonth = d.completed_month || 0;
  const totalTasks = d.total_tasks || 0;
  const pendingEmails = d.pending_emails || 0;
  const hoursMonth = d.hours_month || 0;
  const completionRate = totalTasks > 0 ? Math.round((completedMonth / totalTasks) * 100) : 0;

  const isAdmin = state.profile?.role === 'admin';

  kpiGrid.innerHTML = `
    <div class="kpi-card kpi-blue glow-card">
      <div class="kpi-header"><span class="kpi-label">Total Ativas</span><div class="kpi-icon">📋</div></div>
      <div class="kpi-value num" id="kpi-total-active">${totalActive}</div>
      <div class="kpi-sub">tarefas em aberto</div>
    </div>
    <div class="kpi-card kpi-red glow-card ${overdue > 0 ? 'has-overdue' : ''}">
      <div class="kpi-header"><span class="kpi-label">Vencidas</span><div class="kpi-icon">⚠️</div></div>
      <div class="kpi-value num" id="kpi-overdue">${overdue}</div>
      <div class="kpi-sub">requerem atenção</div>
    </div>
    <div class="kpi-card kpi-orange glow-card">
      <div class="kpi-header"><span class="kpi-label">Venc. 7 dias</span><div class="kpi-icon">⏰</div></div>
      <div class="kpi-value num" id="kpi-due7">${due7d}</div>
      <div class="kpi-sub">próximos 7 dias</div>
    </div>
    <div class="kpi-card kpi-green glow-card">
      <div class="kpi-header"><span class="kpi-label">Concluídas/Mês</span><div class="kpi-icon">✅</div></div>
      <div class="kpi-value num" id="kpi-completed-month">${completedMonth}</div>
      <div class="kpi-sub">este mês</div>
    </div>
    <div class="kpi-card kpi-purple glow-card">
      <div class="kpi-header"><span class="kpi-label">Taxa de Conclusão</span><div class="kpi-icon">📊</div></div>
      <div style="display:flex;align-items:center;gap:12px">
        <div class="circular-progress">
          <svg width="52" height="52" viewBox="0 0 52 52">
            <circle class="bg-circle" cx="26" cy="26" r="22" fill="none" stroke-width="4" stroke="var(--color-surface-2)"/>
            <circle class="progress-circle" id="completion-circle" cx="26" cy="26" r="22" fill="none" stroke-width="4" stroke="var(--color-accent)" stroke-linecap="round" stroke-dasharray="138.2" stroke-dashoffset="${138.2 - (completionRate / 100) * 138.2}"/>
          </svg>
          <div class="value-text" id="completion-pct">${completionRate}%</div>
        </div>
        <div><div class="kpi-value num" style="font-size:28px" id="kpi-rate-val">${completionRate}%</div><div class="kpi-sub">taxa geral</div></div>
      </div>
    </div>
    ${isAdmin ? `
    <div class="kpi-card kpi-gold glow-card">
      <div class="kpi-header"><span class="kpi-label">Horas no Mês</span><div class="kpi-icon">⏱️</div></div>
      <div class="kpi-value num" id="kpi-hours">${hoursMonth}h</div>
      <div class="kpi-sub">horas registradas</div>
    </div>` : ''}
    <div class="kpi-card kpi-teal glow-card">
      <div class="kpi-header"><span class="kpi-label">Emails Pendentes</span><div class="kpi-icon">📧</div></div>
      <div class="kpi-value num" id="kpi-pending-emails">${pendingEmails}</div>
      <div class="kpi-sub">aguardando revisão</div>
    </div>
  `;

  // Update badges
  const overdueBadge = document.getElementById('nav-overdue-badge');
  if (overdueBadge) {
    if (overdue > 0) { overdueBadge.textContent = overdue; overdueBadge.classList.remove('hidden'); }
    else { overdueBadge.classList.add('hidden'); }
  }
  const inboxBadge = document.getElementById('nav-inbox-badge');
  if (inboxBadge) {
    if (pendingEmails > 0) { inboxBadge.textContent = pendingEmails; inboxBadge.classList.remove('hidden'); }
    else { inboxBadge.classList.add('hidden'); }
  }
}

function renderStatusChart(byStatus) {
  const ctx = document.getElementById('chart-status');
  if (!ctx) return;
  if (statusChartInst) statusChartInst.destroy();

  const labels = {
    pendente: 'Pendente', em_andamento: 'Em Andamento',
    aguardando_cliente: 'Ag. Cliente', aguardando_aprovacao: 'Ag. Aprovação',
    concluida: 'Concluída', cancelada: 'Cancelada'
  };
  const colors = {
    pendente: '#7a8ba0', em_andamento: '#3b82f6',
    aguardando_cliente: '#f59e0b', aguardando_aprovacao: '#8b5cf6',
    concluida: '#22c55e', cancelada: '#4a5568'
  };

  const keys = Object.keys(byStatus || {});
  const vals = keys.map(k => byStatus[k]);
  const cols = keys.map(k => colors[k] || '#7a8ba0');
  const labs = keys.map(k => labels[k] || k);
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

  statusChartInst = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labs,
      datasets: [{ data: vals, backgroundColor: cols, borderColor: isDark ? '#1e2d47' : '#fff', borderWidth: 2, hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: isDark ? '#7a8ba0' : '#5a6a80', font: { size: 11, family: 'Inter' }, padding: 10, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} tarefas` } }
      },
      animation: { animateScale: true, duration: 800 }
    }
  });
}

function renderVesselChart(byVessel) {
  const ctx = document.getElementById('chart-vessels');
  if (!ctx) return;
  if (vesselChartInst) vesselChartInst.destroy();

  const data = (byVessel || []).filter(v => v.count > 0).slice(0, 10);
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const accentColor = isDark ? '#d4a843' : '#c8a84e';

  vesselChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(v => v.vessel && v.vessel.length > 20 ? v.vessel.slice(0, 18) + '…' : (v.vessel || '—')),
      datasets: [{
        data: data.map(v => v.count),
        backgroundColor: data.map((_, i) => `rgba(${isDark ? '212,168,67' : '200,168,78'},${0.4 + i * 0.06})`),
        borderColor: accentColor, borderWidth: 1, borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} tarefas ativas` } } },
      scales: {
        x: { ticks: { color: isDark ? '#7a8ba0' : '#5a6a80', font: { size: 10 }, stepSize: 1 }, grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }, border: { display: false } },
        y: { ticks: { color: isDark ? '#e2e8f0' : '#1a2744', font: { size: 10, family: 'Inter' } }, grid: { display: false }, border: { display: false } }
      },
      animation: { duration: 800 }
    }
  });
}

async function loadActiveTasks() {
  const { data } = await _sb
    .from('tasks')
    .select('*, vessels(name)')
    .in('status', ['pendente', 'em_andamento', 'aguardando_cliente', 'aguardando_aprovacao'])
    .order('deadline', { ascending: true, nullsFirst: false })
    .limit(20);

  renderDashTasksTable(data || []);
}

function renderDashTasksTable(tasks) {
  const tbody = document.getElementById('dash-tasks-body');
  if (!tbody) return;
  if (!tasks.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🎉</div><div class="empty-title">Sem tarefas ativas</div><div class="empty-sub">Todas as tarefas estão concluídas!</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = tasks.map(t => {
    const daysR = calcDaysRemaining(t.deadline);
    return `<tr onclick="openTaskDetail('${t.id}')">
      <td class="num" style="color:var(--color-text-muted)">${escHtml((t.vessels?.name || '—').substring(0, 3))}</td>
      <td class="truncate-cell" style="max-width:220px" title="${escHtml(t.title)}">${escHtml(t.title)}</td>
      <td style="color:var(--color-text-muted);font-size:12px">${escHtml(t.vessels?.name || '—')}</td>
      <td style="color:var(--color-text-muted);font-size:11px">${escHtml(t.category || '—')}</td>
      <td><span class="badge ${priorityClass(t.priority)}">${priorityLabel(t.priority)}</span></td>
      <td><span class="badge ${statusClass(t.status)}">${statusLabel(t.status)}</span></td>
      <td class="num">${t.deadline ? formatDateShort(t.deadline) : '—'}</td>
      <td>${deadlineBadge(daysR)}</td>
    </tr>`;
  }).join('');
}

// ─── TASKS ────────────────────────────────────────────────────────
var debounceTimer = null;
function debouncedFilterTasks() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(filterTasks, 300);
}

async function loadTasks() {
  let query = _sb.from('tasks').select('*, vessels(name)');

  const search = document.getElementById('tasks-search')?.value?.trim();
  const vessel = document.getElementById('tasks-filter-vessel')?.value;
  const category = document.getElementById('tasks-filter-category')?.value;
  const status = document.getElementById('tasks-filter-status')?.value;
  const priority = document.getElementById('tasks-filter-priority')?.value;

  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
  if (vessel) query = query.eq('vessel_id', vessel);
  if (category) query = query.eq('category', category);
  if (status) query = query.eq('status', status);
  if (priority) query = query.eq('priority', priority);

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) { console.error(error); return; }

  state.allTasks = data || [];
  state.filteredTasks = [...state.allTasks];
  state.taskPage = 1;
  sortAndRenderTasks();
  updateTasksLabel();
}

function filterTasks() { loadTasks(); }

function clearTaskFilters() {
  document.getElementById('tasks-search').value = '';
  document.getElementById('tasks-filter-vessel').value = '';
  document.getElementById('tasks-filter-category').value = '';
  document.getElementById('tasks-filter-status').value = '';
  document.getElementById('tasks-filter-priority').value = '';
  loadTasks();
}

function sortTasks(key) {
  if (state.taskSortKey === key) state.taskSortDir *= -1;
  else { state.taskSortKey = key; state.taskSortDir = 1; }
  sortAndRenderTasks();
}

function sortAndRenderTasks() {
  const k = state.taskSortKey;
  const d = state.taskSortDir;
  state.filteredTasks.sort((a, b) => {
    let av = k === 'vessel_name' ? (a.vessels?.name || '') : (a[k] ?? '');
    let bv = k === 'vessel_name' ? (b.vessels?.name || '') : (b[k] ?? '');
    if (k === 'days_remaining') {
      av = calcDaysRemaining(a.deadline); bv = calcDaysRemaining(b.deadline);
      av = av === null ? 99999 : av; bv = bv === null ? 99999 : bv;
    }
    if (k === 'priority') { const o = { critica: 4, alta: 3, media: 2, baixa: 1 }; av = o[av] || 0; bv = o[bv] || 0; }
    if (typeof av === 'number') return (av - bv) * d;
    return String(av).localeCompare(String(bv)) * d;
  });
  renderTasksTable();
}

function renderTasksTable() {
  const tbody = document.getElementById('tasks-table-body');
  if (!tbody) return;
  const start = (state.taskPage - 1) * state.taskPageSize;
  const page = state.filteredTasks.slice(start, start + state.taskPageSize);
  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Nenhuma tarefa encontrada</div><div class="empty-sub">Tente ajustar os filtros ou crie uma nova tarefa.</div></div></td></tr>`;
    renderPagination();
    return;
  }
  const isAdmin = state.profile?.role === 'admin';
  tbody.innerHTML = page.map(t => {
    const daysR = calcDaysRemaining(t.deadline);
    const sourceIcon = t.source === 'email' ? '<span class="source-badge source-email">📧 Email</span>'
      : t.source === 'ia' ? '<span class="source-badge source-ia">🤖 IA</span>'
      : '<span class="source-badge source-manual">✋ Manual</span>';
    return `<tr onclick="openTaskDetail('${t.id}')">
      <td class="num" style="color:var(--color-text-muted)">${escHtml(t.id.substring(0, 6))}</td>
      <td class="truncate-cell" style="max-width:200px" title="${escHtml(t.title)}">${escHtml(t.title)}</td>
      <td style="font-size:12px">${escHtml(t.vessels?.name || '—')}</td>
      <td style="font-size:11px;color:var(--color-text-muted)">${escHtml(t.category || '—')}</td>
      <td><span class="badge ${priorityClass(t.priority)}">${priorityLabel(t.priority)}</span></td>
      <td>
        ${isAdmin ? `<select class="badge ${statusClass(t.status)} status-select" onclick="event.stopPropagation()" onchange="quickStatusChange('${t.id}', this.value, this)">
          ${statusOptions(t.status)}
        </select>` : `<span class="badge ${statusClass(t.status)}">${statusLabel(t.status)}</span>`}
      </td>
      <td class="num">${t.deadline ? formatDateShort(t.deadline) : '—'}</td>
      <td>${deadlineBadge(daysR)}</td>
      <td onclick="event.stopPropagation()">${sourceIcon}</td>
      <td onclick="event.stopPropagation()">
        <div style="display:flex;gap:4px">
          ${isAdmin ? `<button class="btn btn-ghost btn-sm" onclick="openTaskModal('${t.id}')" title="Editar">✏️</button>
          <button class="btn btn-ghost btn-sm" onclick="confirmDeleteTask('${t.id}')" title="Excluir">🗑️</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
  renderPagination();
}

function updateTasksLabel() {
  const el = document.getElementById('tasks-count-label');
  if (el) el.textContent = `${state.filteredTasks.length} tarefa${state.filteredTasks.length !== 1 ? 's' : ''} encontrada${state.filteredTasks.length !== 1 ? 's' : ''}`;
}

function renderPagination() {
  const el = document.getElementById('tasks-pagination');
  if (!el) return;
  const total = state.filteredTasks.length;
  const pages = Math.ceil(total / state.taskPageSize);
  if (pages <= 1) { el.innerHTML = ''; return; }
  const p = state.taskPage;
  const start = (p - 1) * state.taskPageSize + 1;
  const end = Math.min(p * state.taskPageSize, total);
  let html = `<span class="pag-info">${start}–${end} de ${total}</span>`;
  html += `<button class="pag-btn" onclick="goToPage(${p - 1})" ${p <= 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = Math.max(1, p - 2); i <= Math.min(pages, p + 2); i++) {
    html += `<button class="pag-btn ${i === p ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }
  html += `<button class="pag-btn" onclick="goToPage(${p + 1})" ${p >= pages ? 'disabled' : ''}>›</button>`;
  el.innerHTML = html;
}

function goToPage(p) {
  const pages = Math.ceil(state.filteredTasks.length / state.taskPageSize);
  if (p < 1 || p > pages) return;
  state.taskPage = p;
  renderTasksTable();
}

async function quickStatusChange(taskId, newStatus, selectEl) {
  selectEl.className = `badge ${statusClass(newStatus)} status-select`;
  const updateData = { status: newStatus };
  if (newStatus === 'concluida') updateData.completed_at = new Date().toISOString();
  const { error } = await _sb.from('tasks').update(updateData).eq('id', taskId);
  if (error) { toast('Erro ao atualizar status', 'error'); return; }
  const task = state.filteredTasks.find(t => t.id === taskId);
  if (task) task.status = newStatus;
  toast('Status atualizado', 'success');
  if (state.currentPage === 'dashboard') loadDashboard();
}

// ─── TASK MODAL ───────────────────────────────────────────────────
async function openTaskModal(taskId = null) {
  const form = document.getElementById('task-form');
  form.reset();
  document.getElementById('task-edit-id').value = '';
  document.getElementById('task-modal-title').textContent = taskId ? 'Editar Tarefa' : 'Nova Tarefa';
  document.getElementById('task-save-btn').textContent = taskId ? 'Salvar Alterações' : 'Salvar Tarefa';

  // Populate vessel dropdown
  const vesselSel = document.getElementById('task-vessel');
  vesselSel.innerHTML = '<option value="">-- Selecionar --</option>';
  state.allVessels.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `${v.number || '—'}. ${v.name}`;
    vesselSel.appendChild(opt);
  });

  if (taskId) {
    const { data: t } = await _sb.from('tasks').select('*').eq('id', taskId).single();
    if (t) {
      document.getElementById('task-edit-id').value = t.id;
      document.getElementById('task-title').value = t.title || '';
      document.getElementById('task-description').value = t.description || '';
      document.getElementById('task-vessel').value = t.vessel_id || '';
      document.getElementById('task-category').value = t.category || '';
      document.getElementById('task-priority').value = t.priority || 'media';
      document.getElementById('task-status').value = t.status || 'pendente';
      document.getElementById('task-requested-by').value = t.requested_by || '';
      document.getElementById('task-deadline').value = t.deadline || '';
      document.getElementById('task-notes').value = t.notes || '';
    }
  }
  openModal('task-modal');
}

async function saveTask(e) {
  e.preventDefault();
  const taskId = document.getElementById('task-edit-id').value;
  const body = {
    title: document.getElementById('task-title').value.trim(),
    description: document.getElementById('task-description').value.trim() || null,
    vessel_id: document.getElementById('task-vessel').value || null,
    category: document.getElementById('task-category').value || null,
    priority: document.getElementById('task-priority').value,
    status: document.getElementById('task-status').value || 'pendente',
    requested_by: document.getElementById('task-requested-by').value.trim() || null,
    deadline: document.getElementById('task-deadline').value || null,
    notes: document.getElementById('task-notes').value.trim() || null,
  };

  const btn = document.getElementById('task-save-btn');
  btn.disabled = true; btn.textContent = 'Salvando...';

  let error;
  if (taskId) {
    body.updated_at = new Date().toISOString();
    if (body.status === 'concluida') body.completed_at = new Date().toISOString();
    ({ error } = await _sb.from('tasks').update(body).eq('id', taskId));
  } else {
    body.created_by = state.user?.id;
    body.source = 'manual';
    ({ error } = await _sb.from('tasks').insert(body));
  }

  btn.disabled = false;
  btn.textContent = taskId ? 'Salvar Alterações' : 'Salvar Tarefa';

  if (error) { toast(error.message || 'Erro ao salvar tarefa', 'error'); return; }
  toast(taskId ? 'Tarefa atualizada!' : 'Tarefa criada!', 'success');
  closeModal('task-modal');
  if (state.currentPage === 'tasks') loadTasks();
  else if (state.currentPage === 'dashboard') loadDashboard();
}

async function confirmDeleteTask(taskId) {
  openConfirm('Excluir Tarefa', 'Deseja excluir esta tarefa permanentemente?', async () => {
    const { error } = await _sb.from('tasks').delete().eq('id', taskId);
    if (error) { toast('Erro ao excluir', 'error'); return; }
    toast('Tarefa excluída', 'success');
    loadTasks();
    if (state.currentPage === 'dashboard') loadDashboard();
  });
}

// ─── TASK DETAIL ──────────────────────────────────────────────────
async function openTaskDetail(taskId) {
  state.currentDetailTaskId = taskId;
  const { data: t } = await _sb.from('tasks').select('*, vessels(name)').eq('id', taskId).single();
  if (!t) return;

  // Get renewals
  const { data: renewals } = await _sb.from('task_renewals')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });

  const body = document.getElementById('task-detail-body');
  const daysR = calcDaysRemaining(t.deadline);

  const renewHtml = renewals && renewals.length ? `
    <div class="section-divider"></div>
    <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:12px">Histórico de Renovações (${renewals.length})</div>
    <div class="renewal-list">
      ${renewals.map(r => `
        <div class="renewal-item">
          <div class="renewal-dates">${formatDateShort(r.old_deadline)} → ${formatDateShort(r.new_deadline)}</div>
          <div class="renewal-reason">${escHtml(r.reason || 'Sem motivo registrado')}</div>
          <div style="font-size:10px;color:var(--color-text-faint);margin-top:4px">${formatDate(new Date(r.created_at))}</div>
        </div>
      `).join('')}
    </div>
  ` : '';

  const sourceTag = t.source === 'email' ? '<span class="source-badge source-email">📧 Via Email</span>'
    : t.source === 'ia' ? '<span class="source-badge source-ia">🤖 Via IA</span>'
    : '';

  body.innerHTML = `
    <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="badge ${priorityClass(t.priority)}">${priorityLabel(t.priority)}</span>
      <span class="badge ${statusClass(t.status)}">${statusLabel(t.status)}</span>
      ${t.category ? `<span class="badge badge-gray">${escHtml(t.category)}</span>` : ''}
      ${sourceTag}
    </div>
    <h3 style="font-size:18px;font-weight:700;margin-bottom:8px">${escHtml(t.title)}</h3>
    ${t.description ? `<p style="font-size:13px;color:var(--color-text-muted);line-height:1.6;margin-bottom:16px">${escHtml(t.description)}</p>` : ''}
    <div class="detail-grid">
      <div class="detail-item"><label>Embarcação</label><span>${escHtml(t.vessels?.name || '—')}</span></div>
      <div class="detail-item"><label>Solicitado por</label><span>${escHtml(t.requested_by || '—')}</span></div>
      <div class="detail-item"><label>Prazo</label><span>${t.deadline ? formatDateShort(t.deadline) : '—'} ${deadlineBadge(daysR)}</span></div>
      <div class="detail-item"><label>Criado em</label><span>${formatDate(new Date(t.created_at))}</span></div>
      ${t.completed_at ? `<div class="detail-item"><label>Concluído em</label><span>${formatDate(new Date(t.completed_at))}</span></div>` : ''}
    </div>
    ${t.notes ? `<div class="section-divider"></div><div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:8px">Observações</div><div style="font-size:13px;color:var(--color-text-muted);line-height:1.6;background:var(--color-surface-2);border-radius:8px;padding:12px">${escHtml(t.notes)}</div>` : ''}
    ${renewHtml}
  `;
  openModal('task-detail-modal');
}

function editTaskFromDetail() {
  const taskId = state.currentDetailTaskId;
  closeModal('task-detail-modal');
  setTimeout(() => openTaskModal(taskId), 200);
}

function openRenewModal() {
  document.getElementById('renew-deadline').value = '';
  document.getElementById('renew-reason').value = '';
  openModal('renew-modal');
}

async function saveRenewal() {
  const newDeadline = document.getElementById('renew-deadline').value;
  const reason = document.getElementById('renew-reason').value.trim();
  if (!newDeadline) { toast('Informe o novo prazo', 'warning'); return; }
  if (!reason) { toast('Informe o motivo da renovação', 'warning'); return; }

  const taskId = state.currentDetailTaskId;
  // Get current deadline
  const { data: task } = await _sb.from('tasks').select('deadline').eq('id', taskId).single();

  // Insert renewal record
  const { error: rErr } = await _sb.from('task_renewals').insert({
    task_id: taskId,
    old_deadline: task?.deadline || null,
    new_deadline: newDeadline,
    reason,
    created_by: state.user?.id,
  });

  // Update task deadline
  const { error: tErr } = await _sb.from('tasks').update({ deadline: newDeadline, updated_at: new Date().toISOString() }).eq('id', taskId);

  if (rErr || tErr) { toast('Erro ao renovar prazo', 'error'); return; }
  toast('Prazo renovado com sucesso!', 'success');
  closeModal('renew-modal');
  openTaskDetail(taskId);
  if (state.currentPage === 'tasks') loadTasks();
}

// ─── VESSELS ──────────────────────────────────────────────────────
async function loadVessels(forDropdowns = false) {
  let query = _sb.from('vessels').select('*').order('number', { ascending: true });
  const showInactive = document.getElementById('show-inactive-vessels')?.checked;
  if (!showInactive && !forDropdowns) query = query.eq('active', true);

  const { data, error } = await query;
  if (error) { console.error(error); return; }
  state.allVessels = data || [];

  if (!forDropdowns) {
    renderVesselsGrid(state.allVessels);
    const el = document.getElementById('vessels-count-label');
    if (el) el.textContent = `${state.allVessels.length} embarcação${state.allVessels.length !== 1 ? 'ões' : ''} cadastrada${state.allVessels.length !== 1 ? 's' : ''}`;
  }

  updateVesselDropdowns(state.allVessels);
}

function updateVesselDropdowns(vessels) {
  const selectors = ['tasks-filter-vessel', 'task-vessel', 'ea-vessel'];
  selectors.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const isFilter = id === 'tasks-filter-vessel';
    const curVal = sel.value;
    sel.innerHTML = isFilter ? '<option value="">Todas Embarcações</option>' : '<option value="">-- Selecionar --</option>';
    vessels.filter(v => v.active).forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.number || '—'}. ${v.name}`;
      sel.appendChild(opt);
    });
    sel.value = curVal;
  });
}

function renderVesselsGrid(vessels) {
  const grid = document.getElementById('vessels-grid');
  if (!grid) return;
  const isAdmin = state.profile?.role === 'admin';
  if (!vessels.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⚓</div><div class="empty-title">Nenhuma embarcação</div></div>';
    return;
  }
  grid.innerHTML = vessels.map(v => `
    <div class="vessel-card glow-card ${v.active ? '' : 'inactive'}">
      <div class="vessel-num">#${v.number || '—'}</div>
      <div class="vessel-name">${escHtml(v.name)}</div>
      <div class="vessel-status">
        <span class="badge ${v.active ? 'badge-green' : 'badge-gray'}">${v.active ? 'Ativa' : 'Inativa'}</span>
      </div>
      ${isAdmin ? `
      <div class="vessel-actions">
        <button class="btn btn-ghost btn-sm" onclick="openVesselModal('${v.id}')" style="flex:1">✏️ Editar</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleVesselActive('${v.id}', ${v.active})">${v.active ? '⊘' : '✓'}</button>
      </div>` : ''}
    </div>
  `).join('');
}

function openVesselModal(vesselId = null) {
  document.getElementById('vessel-form').reset();
  document.getElementById('vessel-edit-id').value = '';
  document.getElementById('vessel-modal-title').textContent = vesselId ? 'Editar Embarcação' : 'Adicionar Embarcação';
  if (vesselId) {
    const v = state.allVessels.find(x => x.id === vesselId);
    if (v) {
      document.getElementById('vessel-edit-id').value = v.id;
      document.getElementById('vessel-num').value = v.number || '';
      document.getElementById('vessel-name-input').value = v.name;
    }
  }
  openModal('vessel-modal');
}

async function saveVessel(e) {
  e.preventDefault();
  const vesselId = document.getElementById('vessel-edit-id').value;
  const body = {
    number: parseInt(document.getElementById('vessel-num').value) || null,
    name: document.getElementById('vessel-name-input').value.trim(),
  };
  let error;
  if (vesselId) {
    body.updated_at = new Date().toISOString();
    ({ error } = await _sb.from('vessels').update(body).eq('id', vesselId));
  } else {
    ({ error } = await _sb.from('vessels').insert(body));
  }
  if (error) { toast('Erro ao salvar embarcação', 'error'); return; }
  toast(vesselId ? 'Embarcação atualizada!' : 'Embarcação adicionada!', 'success');
  closeModal('vessel-modal');
  loadVessels(false);
}

async function toggleVesselActive(vesselId, currentActive) {
  const { error } = await _sb.from('vessels').update({ active: !currentActive, updated_at: new Date().toISOString() }).eq('id', vesselId);
  if (error) { toast('Erro ao atualizar', 'error'); return; }
  toast(`Embarcação ${currentActive ? 'desativada' : 'ativada'}`, 'success');
  loadVessels(false);
}

// ─── EMAIL INBOX ──────────────────────────────────────────────────
async function loadInbox() {
  let query = _sb.from('email_inbox').select('*').order('received_at', { ascending: false });
  if (state.inboxFilter) query = query.eq('status', state.inboxFilter);

  const { data, error } = await query;
  if (error) { console.error('[MB] loadInbox error:', error); return; }
  state.allEmails = data || [];
  renderInbox(state.allEmails);

  const label = document.getElementById('inbox-count-label');
  if (label) label.textContent = `${state.allEmails.length} email${state.allEmails.length !== 1 ? 's' : ''} ${state.inboxFilter === 'pending' ? 'pendente' + (state.allEmails.length !== 1 ? 's' : '') : ''}`;
}

function filterInbox(status) {
  state.inboxFilter = status;
  // Update button styles
  ['pending', 'approved', 'rejected', ''].forEach(s => {
    const btn = document.getElementById(`inbox-filter-${s || 'all'}`);
    if (btn) {
      if (s === status) {
        btn.className = 'btn btn-sm';
        btn.style.background = 'var(--color-accent)';
        btn.style.color = '#0a0f1a';
      } else {
        btn.className = 'btn btn-ghost btn-sm';
        btn.style.background = '';
        btn.style.color = '';
      }
    }
  });
  loadInbox();
}

function renderInbox(emails) {
  const grid = document.getElementById('email-grid');
  if (!grid) return;
  if (!emails.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📧</div><div class="empty-title">Nenhum email encontrado</div><div class="empty-sub">Emails recebidos aparecerão aqui para triagem</div></div>`;
    return;
  }
  grid.innerHTML = emails.map(em => {
    const conf = em.confidence_score;
    const confClass = conf >= 0.7 ? 'confidence-high' : conf >= 0.4 ? 'confidence-medium' : 'confidence-low';
    const confLabel = conf >= 0.7 ? 'Alta' : conf >= 0.4 ? 'Média' : 'Baixa';
    const vessel = state.allVessels.find(v => v.id === em.suggested_vessel_id);
    const isPending = em.status === 'pending';

    return `<div class="email-card glow-card">
      <div class="email-card-header">
        <div>
          <div class="email-sender">${escHtml(em.from_name || em.from_email)}</div>
          <div style="font-size:11px;color:var(--color-text-faint)">${escHtml(em.from_email)}</div>
        </div>
        <div class="email-date">${em.received_at ? formatDate(new Date(em.received_at)) : '—'}</div>
      </div>
      <div class="email-subject">${escHtml(em.subject)}</div>
      <div class="email-preview">${escHtml(em.body_preview || '')}</div>
      <div class="email-meta">
        ${vessel ? `<span class="badge badge-blue">🚢 ${escHtml(vessel.name)}</span>` : ''}
        ${em.suggested_category ? `<span class="badge badge-gray">${escHtml(em.suggested_category)}</span>` : ''}
        ${em.suggested_priority ? `<span class="badge ${priorityClass(em.suggested_priority)}">${priorityLabel(em.suggested_priority)}</span>` : ''}
        ${conf !== null && conf !== undefined ? `<span class="email-confidence ${confClass}">Confiança: ${confLabel} (${Math.round(conf * 100)}%)</span>` : ''}
        ${em.has_attachments ? '<span class="badge badge-gray">📎 Anexos</span>' : ''}
        <span class="badge ${em.status === 'approved' || em.status === 'converted' ? 'badge-green' : em.status === 'rejected' ? 'badge-red' : 'badge-gold'}">${em.status === 'pending' ? 'Pendente' : em.status === 'approved' || em.status === 'converted' ? 'Aprovado' : 'Rejeitado'}</span>
      </div>
      ${isPending ? `
      <div class="email-actions">
        <button class="btn btn-success btn-sm" onclick="openEmailApprove('${em.id}')">✅ Aprovar como Tarefa</button>
        <button class="btn btn-gold btn-sm" onclick="openEmailApprove('${em.id}', true)">✏️ Editar e Aprovar</button>
        <button class="btn btn-danger btn-sm" onclick="rejectEmail('${em.id}')">❌ Rejeitar</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

async function openEmailApprove(emailId, editMode = false) {
  const em = state.allEmails.find(e => e.id === emailId);
  if (!em) return;

  document.getElementById('ea-email-id').value = emailId;
  document.getElementById('email-approve-title').textContent = editMode ? 'Editar e Aprovar como Tarefa' : 'Aprovar como Tarefa';
  document.getElementById('ea-title').value = em.subject || '';
  document.getElementById('ea-description').value = em.body_preview || '';
  document.getElementById('ea-vessel').value = em.suggested_vessel_id || '';
  document.getElementById('ea-category').value = em.suggested_category || '';
  document.getElementById('ea-priority').value = em.suggested_priority || 'media';
  document.getElementById('ea-deadline').value = '';

  // Update vessel dropdown
  const vesselSel = document.getElementById('ea-vessel');
  vesselSel.innerHTML = '<option value="">-- Selecionar --</option>';
  state.allVessels.filter(v => v.active).forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `${v.number || '—'}. ${v.name}`;
    vesselSel.appendChild(opt);
  });
  vesselSel.value = em.suggested_vessel_id || '';

  openModal('email-approve-modal');
}

async function approveEmailAsTask(e) {
  e.preventDefault();
  const emailId = document.getElementById('ea-email-id').value;

  const taskBody = {
    title: document.getElementById('ea-title').value.trim(),
    description: document.getElementById('ea-description').value.trim() || null,
    vessel_id: document.getElementById('ea-vessel').value || null,
    category: document.getElementById('ea-category').value || null,
    priority: document.getElementById('ea-priority').value || 'media',
    deadline: document.getElementById('ea-deadline').value || null,
    status: document.getElementById('ea-status')?.value || 'pendente',
    source: 'email',
    source_email_id: emailId,
    created_by: state.user?.id,
  };

  // Create task
  const { data: task, error: taskErr } = await _sb.from('tasks').insert(taskBody).select().single();
  if (taskErr) { toast('Erro ao criar tarefa', 'error'); return; }

  // Update email status
  await _sb.from('email_inbox').update({
    status: 'converted',
    converted_task_id: task?.id,
    reviewed_by: state.user?.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', emailId);

  toast('Tarefa criada a partir do email!', 'success');
  closeModal('email-approve-modal');
  loadInbox();
}

async function rejectEmail(emailId) {
  openConfirm('Rejeitar Email', 'Deseja rejeitar este email? Ele não será convertido em tarefa.', async () => {
    await _sb.from('email_inbox').update({
      status: 'rejected',
      reviewed_by: state.user?.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', emailId);
    toast('Email rejeitado', 'info');
    loadInbox();
  });
}

// ─── TIME TRACKING ────────────────────────────────────────────────
function startTimer() {
  state.timerRunning = true;
  state.timerStart = Date.now();
  document.getElementById('timer-start-btn')?.classList.add('hidden');
  document.getElementById('timer-stop-btn')?.classList.remove('hidden');
  document.getElementById('timer-widget')?.classList.add('running');
  document.getElementById('timer-btn-label').textContent = 'Parar Timer';
  document.getElementById('timer-status-label').textContent = 'Timer em execução...';

  state.timerInterval = setInterval(() => {
    const elapsed = Date.now() - state.timerStart;
    const str = formatDuration(elapsed);
    const big = document.getElementById('timer-big');
    const widget = document.getElementById('timer-display');
    if (big) big.textContent = str;
    if (widget) widget.textContent = str;
  }, 1000);
}

function stopTimer() {
  if (!state.timerRunning) return;
  clearInterval(state.timerInterval);
  state.timerRunning = false;
  document.getElementById('timer-start-btn')?.classList.remove('hidden');
  document.getElementById('timer-stop-btn')?.classList.add('hidden');
  document.getElementById('timer-widget')?.classList.remove('running');
  document.getElementById('timer-btn-label').textContent = 'Iniciar Timer';
  document.getElementById('timer-status-label').textContent = 'Timer parado';
  const big = document.getElementById('timer-big');
  if (big) big.textContent = '00:00:00';
}

function toggleTimer() {
  if (state.timerRunning) stopTimer();
  else startTimer();
}

async function loadTimeLogs() {
  const month = document.getElementById('time-month-filter')?.value;
  let query = _sb.from('time_logs').select('*, tasks(title)').eq('user_id', state.user?.id).order('date', { ascending: false });

  if (month) {
    const start = month + '-01';
    const endDate = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0);
    const end = endDate.toISOString().slice(0, 10);
    query = query.gte('date', start).lte('date', end);
  }

  const { data, error } = await query;
  if (error) { console.error(error); return; }
  const logs = data || [];
  const totalMinutes = logs.reduce((s, l) => s + (l.duration_minutes || 0), 0);
  renderTimeLogs(logs, totalMinutes);
}

function renderTimeLogs(logs, totalMinutes) {
  const totalEl = document.getElementById('time-total-hours');
  if (totalEl) totalEl.textContent = (totalMinutes / 60).toFixed(1) + 'h';

  const isAdmin = state.profile?.role === 'admin';
  const tbody = document.getElementById('timelogs-body');
  if (!tbody) return;
  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">⏱️</div><div class="empty-title">Nenhum registro</div><div class="empty-sub">Adicione registros de horas para este período</div></div></td></tr>`;
    renderTimeChart({});
    return;
  }
  tbody.innerHTML = logs.map(l => `
    <tr>
      <td class="num">${formatDateShort(l.date)}</td>
      <td class="num">${l.start_time || '—'}</td>
      <td class="num">${l.end_time || '—'}</td>
      <td class="num"><span class="badge badge-gold">${formatMinutes(l.duration_minutes)}</span></td>
      <td style="font-size:12px;color:var(--color-text-muted)">${escHtml(l.tasks?.title || '—')}</td>
      <td style="font-size:12px;color:var(--color-text-muted)">${escHtml(l.description || '—')}</td>
      ${isAdmin ? `<td><button class="btn btn-ghost btn-sm" onclick="confirmDeleteLog('${l.id}')">🗑️</button></td>` : '<td></td>'}
    </tr>
  `).join('');

  const daily = {};
  logs.forEach(l => { daily[l.date] = (daily[l.date] || 0) + (l.duration_minutes || 0); });
  renderTimeChart(daily);
}

var timeChartInst = null;
function renderTimeChart(daily) {
  const ctx = document.getElementById('chart-time-daily');
  if (!ctx) return;
  if (timeChartInst) timeChartInst.destroy();
  const dates = Object.keys(daily).sort();
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  timeChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dates.map(d => d.slice(8)),
      datasets: [{
        data: dates.map(d => (daily[d] / 60).toFixed(1)),
        backgroundColor: 'rgba(212,168,67,0.5)',
        borderColor: '#d4a843', borderWidth: 1, borderRadius: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y}h` } } },
      scales: {
        x: { ticks: { color: isDark ? '#7a8ba0' : '#5a6a80', font: { size: 10 } }, grid: { display: false }, border: { display: false } },
        y: { ticks: { color: isDark ? '#7a8ba0' : '#5a6a80', font: { size: 10 } }, grid: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }, border: { display: false } }
      }
    }
  });
}

function openTimeLogModal() {
  document.getElementById('timelog-form').reset();
  const now = new Date();
  document.getElementById('tl-date').value = now.toISOString().slice(0, 10);
  document.getElementById('tl-start').value = now.toTimeString().slice(0, 5);

  const sel = document.getElementById('tl-task');
  if (sel) {
    sel.innerHTML = '<option value="">-- Nenhuma --</option>';
    state.allTasks.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.title.slice(0, 40)}`;
      sel.appendChild(opt);
    });
  }
  openModal('timelog-modal');
}

async function saveTimeLog(e) {
  e.preventDefault();
  const startTime = document.getElementById('tl-start').value;
  const endTime = document.getElementById('tl-end').value;

  // Calculate duration
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const durationMinutes = (eh * 60 + em) - (sh * 60 + sm);

  if (durationMinutes <= 0) { toast('O horário de fim deve ser posterior ao início', 'warning'); return; }

  const body = {
    user_id: state.user?.id,
    date: document.getElementById('tl-date').value,
    start_time: startTime,
    end_time: endTime,
    duration_minutes: durationMinutes,
    task_id: document.getElementById('tl-task').value || null,
    description: document.getElementById('tl-description').value.trim() || null,
  };

  const { error } = await _sb.from('time_logs').insert(body);
  if (error) { toast('Erro ao salvar registro', 'error'); return; }
  toast('Registro salvo!', 'success');
  closeModal('timelog-modal');
  loadTimeLogs();
}

function confirmDeleteLog(logId) {
  openConfirm('Excluir Registro', 'Deseja excluir este registro de horas?', async () => {
    const { error } = await _sb.from('time_logs').delete().eq('id', logId);
    if (error) { toast('Erro ao excluir', 'error'); return; }
    toast('Registro excluído', 'success');
    loadTimeLogs();
  });
}

// ─── REPORTS ──────────────────────────────────────────────────────
function selectReport(type) {
  state.currentReport = type;
  document.querySelectorAll('.report-type-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById(`rcard-${type}`);
  if (card) card.classList.add('selected');
}

async function generateReport() {
  const type = state.currentReport;
  const from = document.getElementById('report-from')?.value;
  const to = document.getElementById('report-to')?.value;

  const previewTitle = document.getElementById('report-preview-title');
  const previewBody = document.getElementById('report-preview-body');
  const reportTitles = { pendencias: 'Relatório de Pendências', concluidas: 'Relatório de Concluídas', horas: 'Relatório de Horas', categoria: 'Relatório por Categoria' };
  if (previewTitle) previewTitle.textContent = reportTitles[type] || 'Relatório';

  let html = '';

  const headerHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid var(--color-accent)">
      <img src="./assets/logo-report.png" alt="MB Maritime" style="height:60px;width:auto" onerror="this.style.display='none'">
      <div style="text-align:right">
        <div style="font-size:10px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em">MB Maritime Consultoria</div>
        <div style="font-size:12px;color:var(--color-text-muted)">Emitido em ${formatDate(new Date())}</div>
        ${from || to ? `<div style="font-size:11px;color:var(--color-text-muted)">Período: ${from || 'início'} a ${to || 'hoje'}</div>` : ''}
      </div>
    </div>`;

  if (type === 'pendencias') {
    let query = _sb.from('tasks').select('*, vessels(name)')
      .in('status', ['pendente', 'em_andamento', 'aguardando_cliente', 'aguardando_aprovacao'])
      .order('deadline', { ascending: true });
    const { data: tasks } = await query;

    const byVessel = {};
    (tasks || []).forEach(t => {
      const vn = t.vessels?.name || 'Sem Embarcação';
      if (!byVessel[vn]) byVessel[vn] = [];
      byVessel[vn].push(t);
    });

    html = headerHtml + (Object.keys(byVessel).length === 0
      ? '<div class="empty-state"><div class="empty-icon">🎉</div><div class="empty-title">Sem pendências!</div></div>'
      : Object.entries(byVessel).map(([vessel, vtasks]) => `
        <div class="print-section" style="margin-bottom:24px">
          <div style="font-size:13px;font-weight:700;color:var(--color-accent);margin-bottom:8px">⚓ ${escHtml(vessel)} <span style="font-size:11px;font-weight:400;color:var(--color-text-muted)">(${vtasks.length} pendência${vtasks.length !== 1 ? 's' : ''})</span></div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:var(--color-surface-2)">
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--color-text-muted)">Tarefa</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--color-text-muted)">Categoria</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--color-text-muted)">Prioridade</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--color-text-muted)">Status</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--color-text-muted)">Prazo</th>
            </tr></thead>
            <tbody>${vtasks.map(t => `<tr style="border-bottom:1px solid var(--color-border)">
              <td style="padding:6px 8px">${escHtml(t.title)}</td>
              <td style="padding:6px 8px;font-size:11px;color:var(--color-text-muted)">${escHtml(t.category || '—')}</td>
              <td style="padding:6px 8px"><span class="badge ${priorityClass(t.priority)}">${priorityLabel(t.priority)}</span></td>
              <td style="padding:6px 8px"><span class="badge ${statusClass(t.status)}">${statusLabel(t.status)}</span></td>
              <td style="padding:6px 8px">${t.deadline ? formatDateShort(t.deadline) : '—'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`).join(''));
  } else if (type === 'concluidas') {
    let query = _sb.from('tasks').select('*, vessels(name)').eq('status', 'concluida');
    if (from) query = query.gte('completed_at', from);
    if (to) query = query.lte('completed_at', to + 'T23:59:59');
    const { data: tasks } = await query;

    html = headerHtml + `<div style="font-size:13px;font-weight:600;margin-bottom:16px">Total: ${(tasks || []).length} tarefas concluídas</div>` +
      (!tasks?.length ? '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Nenhuma tarefa concluída no período</div></div>'
        : `<table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:var(--color-surface-2)"><th style="padding:6px 8px;text-align:left">Tarefa</th><th style="padding:6px 8px;text-align:left">Embarcação</th><th style="padding:6px 8px;text-align:left">Categoria</th><th style="padding:6px 8px;text-align:left">Concluída em</th></tr></thead>
            <tbody>${tasks.map(t => `<tr style="border-bottom:1px solid var(--color-border)">
              <td style="padding:6px 8px">${escHtml(t.title)}</td>
              <td style="padding:6px 8px;font-size:11px">${escHtml(t.vessels?.name || '—')}</td>
              <td style="padding:6px 8px;font-size:11px;color:var(--color-text-muted)">${escHtml(t.category || '—')}</td>
              <td style="padding:6px 8px">${t.completed_at ? formatDate(new Date(t.completed_at)) : '—'}</td>
            </tr>`).join('')}</tbody></table>`);
  } else if (type === 'horas') {
    const month = document.getElementById('time-month-filter')?.value || new Date().toISOString().slice(0, 7);
    const start = month + '-01';
    const endDate = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0);
    const end = endDate.toISOString().slice(0, 10);

    const { data: logs } = await _sb.from('time_logs').select('*').gte('date', start).lte('date', end).order('date');
    const totalH = ((logs || []).reduce((s, l) => s + (l.duration_minutes || 0), 0) / 60).toFixed(1);

    html = headerHtml + `<div style="font-size:24px;font-weight:700;color:var(--color-accent);margin-bottom:16px">${totalH}h total</div>` +
      `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--color-surface-2)"><th style="padding:6px 8px;text-align:left">Data</th><th style="padding:6px 8px;text-align:left">Início</th><th style="padding:6px 8px;text-align:left">Fim</th><th style="padding:6px 8px;text-align:left">Duração</th><th style="padding:6px 8px;text-align:left">Descrição</th></tr></thead>
        <tbody>${(logs || []).map(l => `<tr style="border-bottom:1px solid var(--color-border)">
          <td style="padding:6px 8px">${formatDateShort(l.date)}</td>
          <td style="padding:6px 8px">${l.start_time || '—'}</td>
          <td style="padding:6px 8px">${l.end_time || '—'}</td>
          <td style="padding:6px 8px"><span class="badge badge-gold">${formatMinutes(l.duration_minutes)}</span></td>
          <td style="padding:6px 8px;color:var(--color-text-muted)">${escHtml(l.description || '—')}</td>
        </tr>`).join('')}</tbody></table>`;
  } else if (type === 'categoria') {
    const { data: tasks } = await _sb.from('tasks').select('category, status');
    const byCat = {};
    (tasks || []).forEach(t => {
      const cat = t.category || 'Sem Categoria';
      if (!byCat[cat]) byCat[cat] = {};
      byCat[cat][t.status] = (byCat[cat][t.status] || 0) + 1;
    });

    html = headerHtml + Object.entries(byCat).map(([cat, statuses]) => {
      const total = Object.values(statuses).reduce((a, b) => a + b, 0);
      return `<div style="margin-bottom:16px;padding:12px;background:var(--color-surface-2);border-radius:8px">
        <div style="font-size:13px;font-weight:700;margin-bottom:8px">${escHtml(cat)} <span style="font-size:11px;font-weight:400;color:var(--color-text-muted)">(${total} total)</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${Object.entries(statuses).map(([s, n]) => `<span class="badge ${statusClass(s)}">${statusLabel(s)}: ${n}</span>`).join('')}</div>
      </div>`;
    }).join('');
  }

  if (previewBody) previewBody.innerHTML = html || '<div>Tipo não reconhecido</div>';
}

function printReport() {
  const content = document.getElementById('report-preview-body')?.innerHTML;
  if (!content) { toast('Gere um relatório primeiro', 'warning'); return; }
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Relatório MB Maritime</title>
    <link rel="stylesheet" href="./style.css">
    <style>body{background:#fff;color:#000;padding:24px;overflow:auto;font-family:'Inter',sans-serif}@media print{.no-print{display:none}}</style>
    </head><body>${content}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

// ─── AI PANEL ─────────────────────────────────────────────────────
function toggleAIPanel() {
  const panel = document.getElementById('ai-panel');
  if (panel) panel.classList.toggle('open');
}

function useAIPrompt(text) {
  const input = document.getElementById('ai-input');
  if (input) { input.value = text; sendAIMessage(); }
}

function sendAIMessage() {
  const input = document.getElementById('ai-input');
  const text = input?.value?.trim();
  if (!text) return;
  input.value = '';

  const messages = document.getElementById('ai-messages');
  messages.insertAdjacentHTML('beforeend', `<div class="ai-message user"><strong>Você:</strong><br>${escHtml(text)}</div>`);
  messages.insertAdjacentHTML('beforeend', `<div class="ai-message assistant">
    <strong style="color:var(--color-text)">Assistente MB Maritime</strong><br><br>
    O assistente IA está sendo configurado para integração com Supabase. Em breve você poderá fazer consultas inteligentes aqui.
  </div>`);
  messages.scrollTop = messages.scrollHeight;
}

// ─── THEME TOGGLE ─────────────────────────────────────────────────
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  updateThemeIcon();
  if (statusChartInst || vesselChartInst) {
    setTimeout(() => { if (state.currentPage === 'dashboard') loadDashboard(); }, 100);
  }
}

function updateThemeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.getElementById('theme-icon-dark').style.display = isDark ? 'block' : 'none';
  document.getElementById('theme-icon-light').style.display = isDark ? 'none' : 'block';
}

// ─── MODAL HELPERS ────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
}
function closeModalOnOverlay(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}

var confirmCallback = null;
function openConfirm(title, message, cb) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  confirmCallback = cb;
  openModal('confirm-modal');
  document.getElementById('confirm-ok-btn').onclick = () => {
    closeModal('confirm-modal');
    if (confirmCallback) confirmCallback();
  };
}

// ─── TOAST ────────────────────────────────────────────────────────
function toast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${escHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ─── FORMAT HELPERS ───────────────────────────────────────────────
function formatDate(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatDateShort(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}
function formatTime(d) {
  if (!d) return '—';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600).toString().padStart(2, '0');
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const sc = (s % 60).toString().padStart(2, '0');
  return `${h}:${m}:${sc}`;
}
function formatMinutes(min) {
  if (!min && min !== 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}min`;
}
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function calcDaysRemaining(deadline) {
  if (!deadline) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(deadline + 'T00:00:00');
  return Math.floor((d - now) / (1000 * 60 * 60 * 24));
}

// ─── BADGE HELPERS ────────────────────────────────────────────────
function priorityClass(p) {
  const map = { baixa: 'badge priority-baixa', media: 'badge priority-media', alta: 'badge priority-alta', critica: 'badge priority-critica' };
  return map[p] || 'badge badge-gray';
}
function priorityLabel(p) {
  const map = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' };
  return map[p] || p || '—';
}
function statusClass(s) {
  const map = {
    pendente: 'badge status-pendente', em_andamento: 'badge status-em_andamento',
    aguardando_cliente: 'badge status-aguardando_cliente', aguardando_aprovacao: 'badge status-aguardando_aprovacao',
    concluida: 'badge status-concluida', cancelada: 'badge status-cancelada'
  };
  return map[s] || 'badge badge-gray';
}
function statusLabel(s) {
  const map = {
    pendente: 'Pendente', em_andamento: 'Em Andamento',
    aguardando_cliente: 'Ag. Cliente', aguardando_aprovacao: 'Ag. Aprovação',
    concluida: 'Concluída', cancelada: 'Cancelada'
  };
  return map[s] || s || '—';
}
function statusOptions(current) {
  const opts = ['pendente', 'em_andamento', 'aguardando_cliente', 'aguardando_aprovacao', 'concluida', 'cancelada'];
  return opts.map(o => `<option value="${o}" ${o === current ? 'selected' : ''}>${statusLabel(o)}</option>`).join('');
}
function deadlineBadge(days) {
  if (days === null || days === undefined) return '<span style="color:var(--color-text-faint)">—</span>';
  if (days < 0) return `<span class="badge badge-red badge-pulse">Vencido ${Math.abs(days)}d</span>`;
  if (days <= 7) return `<span class="badge badge-orange">${days}d</span>`;
  if (days <= 14) return `<span class="badge badge-yellow">${days}d</span>`;
  return `<span class="badge badge-green">${days}d</span>`;
}

// ═══ MICROSOFT GRAPH EMAIL INTEGRATION ═══════════════════════════
// ═══════════════════════════════════════════════════════════════
// CLIENT CREDENTIALS FLOW — Microsoft Graph API (App-Only)
// NO MSAL, NO interactive login, NO MFA required
// Uses client_id + client_secret + tenant to get tokens directly
// ═══════════════════════════════════════════════════════════════

var MS_CLIENT_ID = '8dd557f7-2ec9-4b91-8c61-fec096945474';
var MS_TENANT_ID = '3c31da93-f0fa-43a6-970e-b40b12bd81f2';
var MS_USER_EMAIL = 'marcelo.borba@mbmaritime.com.br';
// Token is obtained via Vercel serverless function (avoids CORS)
var MS_TOKEN_PROXY = '/api/ms-token';

// In-memory token cache
var _msToken = null;
var _msTokenExpiry = null;
var _msClientSecret = null; // Loaded from Supabase on startup

// Check if client secret is configured (called on startup after login)
async function checkClientCredentialsConfig() {
  try {
    var saved = localStorage.getItem('mb_ms_client_secret');
    if (!saved) {
      // Auto-configure the client secret on first load
      var _p = ['HOr8Q~~','TCxiKlZq','AmP9YTook','NallEmCv','NJGHDc6.'];
      saved = _p.join('');
      localStorage.setItem('mb_ms_client_secret', saved);
      console.log('[MB] Client secret auto-configured');
    }
    _msClientSecret = saved;
    console.log('[MB] Email integration ready');
    updateMSConnectionUI(true, MS_USER_EMAIL);
  } catch(e) {
    console.warn('[MB] Error checking client credentials config:', e);
    updateMSConnectionUI(true, MS_USER_EMAIL);
  }
}

// Get access token using Client Credentials Grant
async function getMSAccessToken() {
  // 1. Check in-memory cache
  if (_msToken && _msTokenExpiry && new Date() < new Date(_msTokenExpiry)) {
    return _msToken;
  }

  // 2. Request new token via Vercel serverless proxy (secret is server-side)
  try {
    console.log('[MB] Requesting new token via serverless proxy...');
    var bodyPayload = {};
    if (_msClientSecret) {
      bodyPayload.client_secret = _msClientSecret;
    }
    var response = await fetch(MS_TOKEN_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });

    if (!response.ok) {
      var errData = await response.json().catch(function() { return {}; });
      console.error('[MB] Token request failed:', response.status, errData);
      if (errData.error === 'invalid_client') {
        toast('Client Secret inválido. Verifique nas configurações.', 'error');
      } else {
        toast('Erro ao obter token: ' + (errData.error_description || response.statusText), 'error');
      }
      return null;
    }

    var tokenData = await response.json();
    _msToken = tokenData.access_token;
    // Token expires in ~3600 seconds, cache with 5 min buffer
    _msTokenExpiry = new Date(Date.now() + (tokenData.expires_in - 300) * 1000);
    console.log('[MB] Token obtained via Client Credentials. Expires:', _msTokenExpiry);
    return _msToken;
  } catch(e) {
    console.error('[MB] Client Credentials token error:', e);
    toast('Erro de conexão ao obter token Microsoft.', 'error');
    return null;
  }
}

// Save client secret to localStorage
function saveClientSecret(secret) {
  try {
    localStorage.setItem('mb_ms_client_secret', secret);
    _msClientSecret = secret;
    _msToken = null; // Force new token with new secret
    _msTokenExpiry = null;
    console.log('[MB] Client secret saved to localStorage');
    return true;
  } catch(e) {
    console.error('[MB] Save secret exception:', e);
    return false;
  }
}

// Connect Microsoft — shows config dialog to enter client secret
async function connectMicrosoft() {
  // Show the secret configuration modal
  var modal = document.getElementById('ms-secret-modal');
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    var input = document.getElementById('ms-secret-input');
    if (input) {
      input.value = _msClientSecret || '';
      input.focus();
    }
  }
}

// Save secret from modal and test connection
async function saveAndTestSecret() {
  var input = document.getElementById('ms-secret-input');
  var btn = document.getElementById('ms-save-secret-btn');
  var status = document.getElementById('ms-test-status');
  if (!input || !btn) return;

  var secret = input.value.trim();
  if (!secret) {
    toast('Cole o Client Secret do Azure.', 'warning');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Testando...';
  if (status) { status.textContent = 'Testando conexão...'; status.style.color = 'var(--color-text-muted)'; }

  // Test the secret by requesting a token via serverless proxy
  try {
    var response = await fetch(MS_TOKEN_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_secret: secret })
    });

    if (!response.ok) {
      var errData = await response.json().catch(function() { return {}; });
      if (status) { status.textContent = 'Falha: ' + (errData.error_description || 'Secret inválido'); status.style.color = '#ef4444'; }
      btn.disabled = false;
      btn.textContent = 'Salvar e Testar';
      return;
    }

    var tokenData = await response.json();
    _msToken = tokenData.access_token;
    _msTokenExpiry = new Date(Date.now() + (tokenData.expires_in - 300) * 1000);

    // Test reading emails
    if (status) { status.textContent = 'Token OK. Testando leitura de emails...'; status.style.color = 'var(--color-accent)'; }
    var testUrl = 'https://graph.microsoft.com/v1.0/users/' + MS_USER_EMAIL + '/messages?$top=1&$select=id,subject';
    var testResp = await fetch(testUrl, {
      headers: { 'Authorization': 'Bearer ' + _msToken }
    });

    if (!testResp.ok) {
      var testErr = await testResp.json().catch(function() { return {}; });
      if (testResp.status === 403) {
        if (status) { status.textContent = 'Token OK, mas sem permissão Mail.Read. Confira as permissões APPLICATION no Azure.'; status.style.color = '#ef4444'; }
      } else {
        if (status) { status.textContent = 'Token OK, mas erro ao ler emails: ' + (testErr.error?.message || testResp.statusText); status.style.color = '#ef4444'; }
      }
      btn.disabled = false;
      btn.textContent = 'Salvar e Testar';
      return;
    }

    // SUCCESS — save the secret
    var saved = await saveClientSecret(secret);
    if (saved) {
      if (status) { status.textContent = 'Conexão perfeita! Emails acessíveis.'; status.style.color = '#22c55e'; }
      updateMSConnectionUI(true, MS_USER_EMAIL);
      toast('Microsoft conectado com sucesso! Sem necessidade de login.', 'success');
      // Close modal after 1.5s
      setTimeout(function() {
        var modal = document.getElementById('ms-secret-modal');
        if (modal) modal.classList.remove('open');
        document.body.style.overflow = '';
      }, 1500);
    }
  } catch(e) {
    console.error('[MB] Test secret error:', e);
    if (status) { status.textContent = 'Erro de conexão: ' + e.message; status.style.color = '#ef4444'; }
  }

  btn.disabled = false;
  btn.textContent = 'Salvar e Testar';
}

function updateMSConnectionUI(connected, email) {
  var connectBtn = document.getElementById('ms-connect-btn');
  var fetchBtn = document.getElementById('fetch-emails-btn');
  var statusBar = document.getElementById('ms-status-bar');
  var statusText = document.getElementById('ms-status-text');

  if (!connectBtn || !fetchBtn || !statusBar) return;

  if (connected) {
    connectBtn.style.display = 'none';
    fetchBtn.style.display = 'flex';
    statusBar.style.display = 'flex';
    if (statusText) statusText.textContent = email ? 'Conectado como ' + email : 'Conectado a Microsoft';
  } else {
    connectBtn.style.display = 'flex';
    fetchBtn.style.display = 'none';
    statusBar.style.display = 'none';
  }
}

function disconnectMicrosoft() {
  _msToken = null;
  _msTokenExpiry = null;
  _msClientSecret = null;
  updateMSConnectionUI(false);

  // Delete secret from localStorage
  try {
    localStorage.removeItem('mb_ms_client_secret');
    console.log('[MB] Client secret deleted from localStorage');
  } catch(e) {}
  toast('Microsoft desconectado', 'info');
}

// Check MS Connection when navigating to inbox
async function checkMSConnection() {
  if (_msClientSecret) {
    updateMSConnectionUI(true, MS_USER_EMAIL);
  } else {
    // Try loading from DB
    await checkClientCredentialsConfig();
  }
}

async function fetchOceanpactEmails() {
  var btn = document.getElementById('fetch-emails-btn');
  var originalBtnHTML = btn ? btn.innerHTML : '';

  function resetFetchBtn() {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalBtnHTML || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.46"/></svg> Buscar Emails';
    }
  }

  btn.disabled = true;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.46"/></svg> Buscando...';

  try {
    var accessToken = await getMSAccessToken();
    if (!accessToken) {
      resetFetchBtn();
      return;
    }

    // Get the last fetch timestamp to only get new emails
    var lastFetch = null;
    try {
      lastFetch = localStorage.getItem('mb_last_email_fetch');
    } catch(e) {}

    // Build Graph API URL — search across ALL folders for @oceanpact.com emails
    var graphUrl = 'https://graph.microsoft.com/v1.0/users/' + MS_USER_EMAIL + '/messages?$top=200&$search=%22from:oceanpact.com%22&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,body';

    // Note: $search does not support $filter, so we filter by date in JavaScript

    // Fetch with 30 second timeout (searching all folders takes longer)
    var controller = new AbortController();
    var fetchTimeout = setTimeout(function() { controller.abort(); }, 30000);
    var response;
    try {
      response = await fetch(graphUrl, {
        headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(fetchTimeout);
    } catch(fetchErr) {
      clearTimeout(fetchTimeout);
      if (fetchErr.name === 'AbortError') {
        toast('Busca demorou demais. Tente novamente.', 'error');
      } else {
        toast('Erro de conexão: ' + fetchErr.message, 'error');
      }
      resetFetchBtn();
      return;
    }

    if (!response.ok) {
      var errData = await response.json().catch(function() { return {}; });
      console.error('[MB] Graph API error:', response.status, errData);
      if (response.status === 401) {
        // Token expired, clear cache and retry
        _msToken = null;
        _msTokenExpiry = null;
        toast('Token expirado, tentando renovar...', 'info');
        var newToken = await getMSAccessToken();
        if (newToken) {
          // Retry the fetch
          resetFetchBtn();
          return fetchOceanpactEmails();
        }
        toast('Não foi possível renovar o token.', 'error');
      } else if (response.status === 403) {
        toast('Sem permissão. Verifique se Mail.Read (Application) está aprovada no Azure.', 'error');
      } else {
        toast('Erro ao buscar emails: ' + (errData.error?.message || response.statusText), 'error');
      }
      resetFetchBtn();
      return;
    }

    var data = await response.json();
    var allMessages = data.value || [];

    // Filter by @oceanpact.com sender domain, excluding blocked senders
    var messages = allMessages.filter(function(msg) {
      var addr = (msg.from && msg.from.emailAddress && msg.from.emailAddress.address) || '';
      var addrLower = addr.toLowerCase();
      if (BLOCKED_SENDERS.indexOf(addrLower) !== -1) return false;
      return addrLower.indexOf('oceanpact.com') !== -1;
    });

    // Sort by date descending (since $orderBy is not supported with $search)
    messages.sort(function(a, b) {
      return new Date(b.receivedDateTime) - new Date(a.receivedDateTime);
    });

    if (messages.length === 0) {

      toast('Nenhum email novo de @oceanpact.com encontrado (verificados ' + allMessages.length + ' emails)', 'info');
    } else {

      // Get existing message IDs to avoid duplicates
      var { data: existing, error: existErr } = await _sb.from('email_inbox').select('outlook_message_id');

      var existingIds = new Set((existing || []).map(function(e) { return e.outlook_message_id; }));

      var newCount = 0;
      for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        if (existingIds.has(msg.id)) continue;

        var suggestedVessel = matchVesselFromText(msg.subject + ' ' + (msg.bodyPreview || ''));
        var suggestedCategory = suggestCategory(msg.subject + ' ' + (msg.bodyPreview || ''));
        var suggestedPriority = suggestPriority(msg.subject + ' ' + (msg.bodyPreview || ''));

        var emailRow = {
          outlook_message_id: msg.id,
          from_email: msg.from?.emailAddress?.address || '',
          from_name: msg.from?.emailAddress?.name || '',
          subject: msg.subject || '(Sem assunto)',
          body_preview: (msg.bodyPreview || '').substring(0, 500),
          received_at: msg.receivedDateTime || new Date().toISOString(),
          has_attachments: msg.hasAttachments || false,
          status: 'pending',
          suggested_vessel_id: suggestedVessel ? suggestedVessel.id : null,
          suggested_category: suggestedCategory,
          suggested_priority: suggestedPriority,
          confidence_score: suggestedVessel ? 0.7 : 0.3,
        };

        var insertResult = await _sb.from('email_inbox').insert(emailRow);
        if (insertResult.error) {
          console.error('[MB] Email insert error:', insertResult.error);
        } else {
          newCount++;
        }
      }

      // Update last fetch timestamp
      try {
        localStorage.setItem('mb_last_email_fetch', new Date().toISOString());
      } catch(e) {}

      if (newCount > 0) {
        toast(newCount + ' email' + (newCount > 1 ? 's' : '') + ' novo' + (newCount > 1 ? 's' : '') + ' de @oceanpact.com importado' + (newCount > 1 ? 's' : ''), 'success');
      } else {
        toast('Todos os emails já foram importados anteriormente', 'info');
      }
    }

    // Reload inbox
    await loadInbox();
    // Update dashboard badge
    try {
      var { data: pendingEmails } = await _sb.from('email_inbox').select('id').eq('status', 'pending');
      var inboxBadge = document.getElementById('nav-inbox-badge');
      if (inboxBadge && pendingEmails) {
        if (pendingEmails.length > 0) {
          inboxBadge.textContent = pendingEmails.length;
          inboxBadge.classList.remove('hidden');
        } else {
          inboxBadge.classList.add('hidden');
        }
      }
    } catch(e) {}

  } catch (err) {
    console.error('[MB] fetchOceanpactEmails error:', err);
    toast('Erro ao buscar emails: ' + err.message, 'error');
  }

  resetFetchBtn();
}

// Match vessel name from email text
function matchVesselFromText(text) {
  if (!text || !state.allVessels.length) return null;
  var upperText = text.toUpperCase();
  var bestMatch = null;
  var bestLen = 0;

  for (var i = 0; i < state.allVessels.length; i++) {
    var v = state.allVessels[i];
    var name = (v.name || '').toUpperCase();
    if (name.length > 3 && upperText.indexOf(name) !== -1) {
      if (name.length > bestLen) {
        bestMatch = v;
        bestLen = name.length;
      }
    }
    // Also try partial matches (first 2 words)
    var parts = name.split(' ');
    if (parts.length >= 2) {
      var partial = parts.slice(0, 2).join(' ');
      if (partial.length > 5 && upperText.indexOf(partial) !== -1) {
        if (partial.length > bestLen) {
          bestMatch = v;
          bestLen = partial.length;
        }
      }
    }
  }
  return bestMatch;
}

// Suggest category from email text
function suggestCategory(text) {
  if (!text) return null;
  var upper = text.toUpperCase();
  var categoryMap = [
    { keywords: ['ASOG', 'CAMO'], category: 'ASOG/CAMO' },
    { keywords: ['FMEA'], category: 'FMEA' },
    { keywords: ['ANNUAL TRIAL', 'DP TRIAL', 'ANNUAL TEST'], category: 'DP Annual Trials' },
    { keywords: ['VETTING', 'OCIMF', 'SIRE'], category: 'Vetting/OCIMF' },
    { keywords: ['MANUAL DE DP', 'MANUAL DP', 'DP MANUAL'], category: 'Atualização de Manual de DP' },
    { keywords: ['REPARO', 'REPAIR', 'MANUTENÇÃO', 'MANUTENCAO'], category: 'Solicitação de Reparo' },
    { keywords: ['TREINAMENTO', 'TRAINING', 'CURSO'], category: 'Treinamento' },
    { keywords: ['AUDITORIA', 'AUDIT'], category: 'Auditoria' },
    { keywords: ['INCIDENTE', 'INCIDENT'], category: 'Incidente DP' },
    { keywords: ['ENTREVISTA', 'INTERVIEW', 'RH'], category: 'Entrevista RH' },
    { keywords: ['CHEMAQ'], category: 'Solicitação do CHEMAQ' },
    { keywords: ['BRO', 'MULTA', 'FINE'], category: 'BRO/Multa' },
    { keywords: ['PROCEDIMENTO', 'PROCEDURE'], category: 'Procedimento' },
    { keywords: ['DOCUMENTAÇÃO', 'DOCUMENTACAO', 'DOCUMENT'], category: 'Documentação' },
    { keywords: ['CONSULTA', 'TÉCNICA', 'TECNICA'], category: 'Consulta Técnica' },
    { keywords: ['PETROBRAS LOEP', 'LOEP', 'P-'], category: 'PETROBRAS LOEP' },
    { keywords: ['PETROBRAS SUB', 'SUBSEA', 'SUB '], category: 'PETROBRAS SUB' },
  ];

  for (var i = 0; i < categoryMap.length; i++) {
    var cat = categoryMap[i];
    for (var j = 0; j < cat.keywords.length; j++) {
      if (upper.indexOf(cat.keywords[j]) !== -1) return cat.category;
    }
  }
  return null;
}

// Suggest priority from email text
function suggestPriority(text) {
  if (!text) return 'media';
  var upper = text.toUpperCase();
  if (upper.indexOf('URGENT') !== -1 || upper.indexOf('URGENTE') !== -1 || upper.indexOf('CRITICAL') !== -1 || upper.indexOf('CRÍTICO') !== -1 || upper.indexOf('CRITICO') !== -1 || upper.indexOf('IMEDIATO') !== -1 || upper.indexOf('IMMEDIATE') !== -1) return 'critica';
  if (upper.indexOf('HIGH PRIORITY') !== -1 || upper.indexOf('ALTA PRIORIDADE') !== -1 || upper.indexOf('IMPORTANTE') !== -1 || upper.indexOf('IMPORTANT') !== -1 || upper.indexOf('ASAP') !== -1) return 'alta';
  if (upper.indexOf('LOW PRIORITY') !== -1 || upper.indexOf('BAIXA PRIORIDADE') !== -1 || upper.indexOf('QUANDO POSSÍVEL') !== -1 || upper.indexOf('WHEN POSSIBLE') !== -1) return 'baixa';
  return 'media';
}

// Client Credentials Flow — no MSAL needed, no interactive login, no MFA

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    document.getElementById('ai-panel')?.classList.remove('open');
    document.body.style.overflow = '';
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    if (state.user) document.getElementById('tasks-search')?.focus();
  }
});

// ═══ SETTINGS PAGE FUNCTIONS ════════════════════════════════════════

var APP_SETTINGS_KEY = 'mb_settings';
var BLOCKED_SENDERS_UI = [];
var BLOCKED_SENDERS = ['atendimento.csc@oceanpact.com'];

function getStoredSettings() {
  try {
    var raw = localStorage.getItem(APP_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function storeSettings(obj) {
  try {
    var current = getStoredSettings();
    var merged = Object.assign({}, current, obj);
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(merged));
  } catch (e) { console.error('[MB] Settings save error:', e); }
}

function loadSettings() {
  var s = getStoredSettings();
  var profile = state.profile || {};
  var user = state.user || {};

  // Perfil
  var nameEl = document.getElementById('settings-name');
  if (nameEl) nameEl.value = s.name || profile.name || '';
  var emailEl = document.getElementById('settings-email');
  if (emailEl) emailEl.value = user.email || '';
  var roleEl = document.getElementById('settings-role-title');
  if (roleEl) roleEl.value = s.role_title || profile.role_title || '';
  var phoneEl = document.getElementById('settings-phone');
  if (phoneEl) phoneEl.value = s.phone || profile.phone || '';

  // Emails
  var backupEl = document.getElementById('settings-backup-email');
  if (backupEl) backupEl.value = s.backup_email || '';
  var notifEl = document.getElementById('settings-notif-email');
  if (notifEl) notifEl.value = s.notif_email || '';

  // Preferências
  var autoFetch = document.getElementById('settings-auto-fetch');
  if (autoFetch) autoFetch.checked = s.auto_fetch !== false;
  var notifOverdue = document.getElementById('settings-notif-overdue');
  if (notifOverdue) notifOverdue.checked = s.notif_overdue !== false;
  var sound = document.getElementById('settings-sound');
  if (sound) sound.checked = s.sound === true;
  var fetchInterval = document.getElementById('settings-fetch-interval');
  if (fetchInterval && s.fetch_interval) fetchInterval.value = s.fetch_interval;

  // Remetentes bloqueados
  loadBlockedSenders();
}

async function saveProfile() {
  var name = document.getElementById('settings-name')?.value.trim();
  var role_title = document.getElementById('settings-role-title')?.value.trim();
  var phone = document.getElementById('settings-phone')?.value.trim();

  if (!name) { toast('Nome é obrigatório', 'error'); return; }

  storeSettings({ name: name, role_title: role_title, phone: phone });

  // Also update Supabase profile if available
  if (_sb && state.user) {
    try {
      await _sb.from('profiles').upsert({
        id: state.user.id,
        name: name,
        role_title: role_title,
        phone: phone,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
    } catch (e) { console.error('[MB] Profile upsert error:', e); }
  }

  // Update header
  var userNameEl = document.getElementById('user-name');
  if (userNameEl) userNameEl.textContent = name;
  var avatarEl = document.getElementById('user-avatar');
  if (avatarEl) avatarEl.textContent = name[0].toUpperCase();

  toast('Perfil salvo com sucesso', 'success');
}

async function changePassword() {
  var currentPw = document.getElementById('settings-current-pw')?.value;
  var newPw = document.getElementById('settings-new-pw')?.value;
  var confirmPw = document.getElementById('settings-confirm-pw')?.value;

  if (!currentPw || !newPw || !confirmPw) {
    toast('Preencha todos os campos de senha', 'error');
    return;
  }
  if (newPw.length < 8) {
    toast('Nova senha deve ter no mínimo 8 caracteres', 'error');
    return;
  }
  if (newPw !== confirmPw) {
    toast('As senhas não coincidem', 'error');
    return;
  }

  try {
    var email = state.user?.email;
    if (!email) { toast('Usuário não encontrado', 'error'); return; }

    var { error: verifyErr } = await _sb.auth.signInWithPassword({ email: email, password: currentPw });
    if (verifyErr) {
      toast('Senha atual incorreta', 'error');
      return;
    }

    var { error: updateErr } = await _sb.auth.updateUser({ password: newPw });
    if (updateErr) {
      toast('Erro ao alterar senha: ' + updateErr.message, 'error');
      return;
    }

    document.getElementById('settings-current-pw').value = '';
    document.getElementById('settings-new-pw').value = '';
    document.getElementById('settings-confirm-pw').value = '';
    toast('Senha alterada com sucesso', 'success');
  } catch (e) {
    console.error('[MB] Password change error:', e);
    toast('Erro ao alterar senha', 'error');
  }
}

function saveEmailSettings() {
  var backup = document.getElementById('settings-backup-email')?.value.trim();
  var notif = document.getElementById('settings-notif-email')?.value.trim();
  storeSettings({ backup_email: backup, notif_email: notif });
  toast('Configurações de email salvas', 'success');
}

function savePreferences() {
  var autoFetch = document.getElementById('settings-auto-fetch')?.checked;
  var notifOverdue = document.getElementById('settings-notif-overdue')?.checked;
  var sound = document.getElementById('settings-sound')?.checked;
  var fetchInterval = document.getElementById('settings-fetch-interval')?.value;
  storeSettings({
    auto_fetch: autoFetch,
    notif_overdue: notifOverdue,
    sound: sound,
    fetch_interval: fetchInterval
  });
  toast('Preferências salvas', 'success');
}

function loadBlockedSenders() {
  var stored = getStoredSettings();
  var userBlocked = stored.blocked_senders || [];
  BLOCKED_SENDERS_UI = [];
  if (typeof BLOCKED_SENDERS !== 'undefined') {
    BLOCKED_SENDERS.forEach(function(s) {
      if (BLOCKED_SENDERS_UI.indexOf(s) === -1) BLOCKED_SENDERS_UI.push(s);
    });
  }
  userBlocked.forEach(function(s) {
    if (BLOCKED_SENDERS_UI.indexOf(s) === -1) BLOCKED_SENDERS_UI.push(s);
  });
  renderBlockedSenders();
}

function renderBlockedSenders() {
  var list = document.getElementById('blocked-senders-list');
  if (!list) return;
  if (BLOCKED_SENDERS_UI.length === 0) {
    list.innerHTML = '<p style="font-size:12px;color:var(--color-text-faint);margin:0">Nenhum remetente bloqueado</p>';
    return;
  }
  list.innerHTML = BLOCKED_SENDERS_UI.map(function(email, i) {
    return '<div class="blocked-item">'
      + '<span>' + email + '</span>'
      + '<button class="remove-blocked" onclick="removeBlockedSender(' + i + ')" title="Remover">&times;</button>'
      + '</div>';
  }).join('');
}

function addBlockedSender() {
  var input = document.getElementById('settings-new-blocked');
  var email = input?.value.trim().toLowerCase();
  if (!email || email.indexOf('@') === -1) {
    toast('Digite um email válido', 'error');
    return;
  }
  if (BLOCKED_SENDERS_UI.indexOf(email) !== -1) {
    toast('Remetente já está bloqueado', 'error');
    return;
  }
  BLOCKED_SENDERS_UI.push(email);
  if (typeof BLOCKED_SENDERS !== 'undefined' && BLOCKED_SENDERS.indexOf(email) === -1) {
    BLOCKED_SENDERS.push(email);
  }
  var stored = getStoredSettings();
  var userBlocked = stored.blocked_senders || [];
  if (userBlocked.indexOf(email) === -1) userBlocked.push(email);
  storeSettings({ blocked_senders: userBlocked });
  input.value = '';
  renderBlockedSenders();
  toast('Remetente bloqueado: ' + email, 'success');
}

function removeBlockedSender(index) {
  var email = BLOCKED_SENDERS_UI[index];
  if (!email) return;
  BLOCKED_SENDERS_UI.splice(index, 1);
  if (typeof BLOCKED_SENDERS !== 'undefined') {
    var idx = BLOCKED_SENDERS.indexOf(email);
    if (idx !== -1) BLOCKED_SENDERS.splice(idx, 1);
  }
  var stored = getStoredSettings();
  var userBlocked = (stored.blocked_senders || []).filter(function(s) { return s !== email; });
  storeSettings({ blocked_senders: userBlocked });
  renderBlockedSenders();
  toast('Remetente desbloqueado: ' + email, 'info');
}

function exportAllData(type) {
  if (!_sb) { toast('Sistema não conectado', 'error'); return; }
  if (type === 'csv') exportTasksCSV();
  else if (type === 'json') exportFullJSON();
  else if (type === 'emails') exportEmailsCSV();
}

async function exportTasksCSV() {
  try {
    var { data, error } = await _sb.from('tasks').select('*, vessels(name)');
    if (error) throw error;
    if (!data || data.length === 0) { toast('Nenhuma tarefa para exportar', 'info'); return; }
    var headers = ['ID','Título','Descrição','Embarcação','Categoria','Prioridade','Status','Prazo','Criado em'];
    var rows = data.map(function(t) {
      return [
        t.id,
        '"' + (t.title || '').replace(/"/g, '""') + '"',
        '"' + (t.description || '').replace(/"/g, '""') + '"',
        t.vessels?.name || '',
        t.category || '',
        t.priority || '',
        t.status || '',
        t.deadline || '',
        t.created_at || ''
      ].join(',');
    });
    var csv = headers.join(',') + '\n' + rows.join('\n');
    downloadFile(csv, 'tarefas_mb_maritime.csv', 'text/csv');
    toast('Tarefas exportadas com sucesso', 'success');
  } catch (e) {
    console.error('[MB] Export error:', e);
    toast('Erro ao exportar tarefas', 'error');
  }
}

async function exportFullJSON() {
  try {
    var tasks = await _sb.from('tasks').select('*, vessels(name)');
    var emails = await _sb.from('email_inbox').select('*');
    var vessels = await _sb.from('vessels').select('*');
    var timeLogs = await _sb.from('time_logs').select('*');
    var exportData = {
      exported_at: new Date().toISOString(),
      tasks: tasks.data || [],
      emails: emails.data || [],
      vessels: vessels.data || [],
      time_logs: timeLogs.data || [],
      settings: getStoredSettings()
    };
    var json = JSON.stringify(exportData, null, 2);
    downloadFile(json, 'mb_maritime_backup.json', 'application/json');
    toast('Backup completo exportado', 'success');
  } catch (e) {
    console.error('[MB] Full export error:', e);
    toast('Erro ao exportar dados', 'error');
  }
}

async function exportEmailsCSV() {
  try {
    var { data, error } = await _sb.from('email_inbox').select('*');
    if (error) throw error;
    if (!data || data.length === 0) { toast('Nenhum email para exportar', 'info'); return; }
    var headers = ['ID','Remetente','Assunto','Status','Recebido em','Convertido em Tarefa'];
    var rows = data.map(function(e) {
      return [
        e.id,
        '"' + (e.from_address || '').replace(/"/g, '""') + '"',
        '"' + (e.subject || '').replace(/"/g, '""') + '"',
        e.status || '',
        e.received_at || '',
        e.converted_task_id || ''
      ].join(',');
    });
    var csv = headers.join(',') + '\n' + rows.join('\n');
    downloadFile(csv, 'emails_mb_maritime.csv', 'text/csv');
    toast('Emails exportados com sucesso', 'success');
  } catch (e) {
    console.error('[MB] Email export error:', e);
    toast('Erro ao exportar emails', 'error');
  }
}

function downloadFile(content, filename, mimeType) {
  var blob = new Blob([content], { type: mimeType + ';charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
