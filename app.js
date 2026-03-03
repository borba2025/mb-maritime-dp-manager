/* ═══════════════════════════════════════════════════════════════
   MB Maritime DP Task Manager — Supabase Edition
   Application Logic
   ═══════════════════════════════════════════════════════════════ */

// ─── SUPABASE CONFIG ──────────────────────────────────────────────
const SUPABASE_URL = 'https://cboagvwdowlqupccgkng.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNib2Fndndkb3dscXVwY2Nna25nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTQyOTEsImV4cCI6MjA4ODA3MDI5MX0.F9awl_j80GqaY2oufp_-bN_6nlVcFxzZXPv3WNr_2-s';

let supabase = null;

// ─── STATE ────────────────────────────────────────────────────────
let state = {
  user: null,
  profile: null,
  currentPage: 'dashboard',
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
  // Create Supabase client HERE (after CDN script has loaded)
  try {
    if (window.supabase && window.supabase.createClient) {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  } catch(e) { /* will be caught below */ }

  const errEl = document.getElementById('login-error');
  if (!supabase) {
    if (errEl) {
      errEl.textContent = 'Erro ao carregar sistema. Recarregue a p\u00e1gina (F5).';
      errEl.classList.add('visible');
    }
    showPage('login');
    return;
  }

  const now = new Date();
  const mf = document.getElementById('time-month-filter');
  if (mf) mf.value = now.toISOString().slice(0, 7);
  const rd = document.getElementById('report-from');
  const rt = document.getElementById('report-to');
  if (rd) rd.value = now.toISOString().slice(0, 7) + '-01';
  if (rt) rt.value = now.toISOString().slice(0, 10);

  document.documentElement.setAttribute('data-theme', 'dark');
  updateThemeIcon();

  // Login button click handler - expose globally
  window.__doLogin = handleEmailLogin;
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      handleEmailLogin();
    });
  }
  // Enter key on password field
  const passField = document.getElementById('login-pass');
  if (passField) {
    passField.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleEmailLogin();
      }
    });
  }
  // Enter key on email field
  const emailField = document.getElementById('login-email');
  if (emailField) {
    emailField.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleEmailLogin();
      }
    });
  }

  // Listen for auth state changes
  if (supabase) {
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        state.user = session.user;
        await loadOrCreateProfile();
        await initDashboard();
      } else if (event === 'SIGNED_OUT') {
        state.user = null;
        state.profile = null;
        showPage('login');
      }
    });

    // Check existing session
    checkSession();
  } else {
    showPage('login');
  }
});

async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    state.user = session.user;
    await loadOrCreateProfile();
    await initDashboard();
  } else {
    showPage('login');
  }
}

// ─── AUTH ──────────────────────────────────────────────────────────
async function signInWithMicrosoft() {
  const { error } = await supabase.auth.signInWithOAuth({
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

async function handleEmailLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-pass').value;
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  
  if (!email || !password) {
    errEl.textContent = 'Preencha email e senha';
    errEl.classList.add('visible');
    return;
  }

  if (!supabase) {
    errEl.textContent = 'Sistema n\u00e3o iniciou. Recarregue (F5).';
    errEl.classList.add('visible');
    return;
  }
  
  errEl.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      errEl.textContent = error.message === 'Invalid login credentials'
        ? 'Email ou senha incorretos'
        : error.message;
      errEl.classList.add('visible');
      btn.disabled = false;
      btn.innerHTML = 'Entrar <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      return;
    }

    if (data && data.session) {
      state.user = data.session.user;
      
      // FIRST: show dashboard immediately so user sees progress
      showPage('app');
      
      // Then load profile (non-blocking)
      try {
        await loadOrCreateProfile();
      } catch (profileErr) {
        state.profile = {
          id: state.user.id,
          username: state.user.email,
          name: state.user.email.split('@')[0],
          role: 'admin'
        };
      }
      // Then init dashboard data (non-blocking)
      try {
        const p = state.profile || { name: state.user.email, role: 'admin' };
        document.getElementById('user-name').textContent = p.name || state.user.email || 'Usu\u00e1rio';
        document.getElementById('user-role').textContent = p.role === 'admin' ? 'Administrador' : 'Colaborador';
        document.getElementById('user-avatar').textContent = (p.name || state.user.email || 'U')[0].toUpperCase();
        if (p.role === 'admin') {
          document.querySelectorAll('.admin-only').forEach(el => { el.style.display = ''; el.classList.remove('hidden'); });
        }
        // Load data in background - don't block
        loadVessels(true).catch(() => {});
        navigate('dashboard').catch(() => {});
      } catch (dashErr) {
        // Dashboard is already visible, just log
      }
    }
  } catch (err) {
    errEl.textContent = 'Erro de conexão. Tente novamente.';
    errEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Entrar <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  }
}

async function handleLogout() {
  stopTimer();
  await supabase.auth.signOut();
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
  const { data: profile, error } = await supabase
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
    const { data: created } = await supabase.from('profiles').insert(newProfile).select().single();
    state.profile = created || newProfile;
  } else {
    state.profile = profile;
  }
}

// ─── DASHBOARD INIT ───────────────────────────────────────────────
async function initDashboard() {
  showPage('app');
  const p = state.profile || {};

  document.getElementById('user-name').textContent = p.name || state.user?.email || 'Usuário';
  document.getElementById('user-role').textContent = p.role === 'admin' ? 'Administrador' : 'Colaborador';
  document.getElementById('user-avatar').textContent = (p.name || state.user?.email || 'U')[0].toUpperCase();

  // Admin-only elements
  if (p.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = '';
      el.classList.remove('hidden');
    });
  }

  await loadVessels(true);
  await navigate('dashboard');
}

// ─── NAVIGATION ───────────────────────────────────────────────────
async function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.add('active');

  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  const titles = {
    dashboard: 'Dashboard', tasks: 'Tarefas', vessels: 'Embarcações',
    inbox: 'Caixa de Entrada', time: 'Registro de Horas', reports: 'Relatórios'
  };
  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle) topbarTitle.innerHTML = `${titles[page] || page} <small>${formatDate(new Date())}</small>`;

  state.currentPage = page;

  if (page === 'dashboard') await loadDashboard();
  else if (page === 'tasks') { await loadVessels(true); await loadTasks(); }
  else if (page === 'vessels') await loadVessels(false);
  else if (page === 'inbox') await loadInbox();
  else if (page === 'time') await loadTimeLogs();
}

// ─── DASHBOARD ────────────────────────────────────────────────────
let statusChartInst = null, vesselChartInst = null;

async function loadDashboard() {
  const dl = document.getElementById('dash-date-label');
  if (dl) dl.textContent = `Atualizado ${formatDate(new Date())} às ${formatTime(new Date())}`;

  // Use RPC function for dashboard stats
  const { data, error } = await supabase.rpc('get_dashboard_stats');

  if (error) {
    console.error('Dashboard stats error:', error);
    // Fallback: compute from local data
    await loadDashboardFallback();
    return;
  }

  const d = data || {};
  renderKPICards(d);
  renderStatusChart(d.by_status);
  renderVesselChart(d.by_vessel);
  loadActiveTasks();
}

async function loadDashboardFallback() {
  // Query tasks directly if RPC fails
  const { data: tasks } = await supabase.from('tasks').select('*, vessels(name)');
  const { data: emails } = await supabase.from('email_inbox').select('id').eq('status', 'pending');
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
  const { data } = await supabase
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
let debounceTimer = null;
function debouncedFilterTasks() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(filterTasks, 300);
}

async function loadTasks() {
  let query = supabase.from('tasks').select('*, vessels(name)');

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
  const { error } = await supabase.from('tasks').update(updateData).eq('id', taskId);
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
    const { data: t } = await supabase.from('tasks').select('*').eq('id', taskId).single();
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
    ({ error } = await supabase.from('tasks').update(body).eq('id', taskId));
  } else {
    body.created_by = state.user?.id;
    body.source = 'manual';
    ({ error } = await supabase.from('tasks').insert(body));
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
    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    if (error) { toast('Erro ao excluir', 'error'); return; }
    toast('Tarefa excluída', 'success');
    loadTasks();
    if (state.currentPage === 'dashboard') loadDashboard();
  });
}

// ─── TASK DETAIL ──────────────────────────────────────────────────
async function openTaskDetail(taskId) {
  state.currentDetailTaskId = taskId;
  const { data: t } = await supabase.from('tasks').select('*, vessels(name)').eq('id', taskId).single();
  if (!t) return;

  // Get renewals
  const { data: renewals } = await supabase.from('task_renewals')
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
  const { data: task } = await supabase.from('tasks').select('deadline').eq('id', taskId).single();

  // Insert renewal record
  const { error: rErr } = await supabase.from('task_renewals').insert({
    task_id: taskId,
    old_deadline: task?.deadline || null,
    new_deadline: newDeadline,
    reason,
    created_by: state.user?.id,
  });

  // Update task deadline
  const { error: tErr } = await supabase.from('tasks').update({ deadline: newDeadline, updated_at: new Date().toISOString() }).eq('id', taskId);

  if (rErr || tErr) { toast('Erro ao renovar prazo', 'error'); return; }
  toast('Prazo renovado com sucesso!', 'success');
  closeModal('renew-modal');
  openTaskDetail(taskId);
  if (state.currentPage === 'tasks') loadTasks();
}

// ─── VESSELS ──────────────────────────────────────────────────────
async function loadVessels(forDropdowns = false) {
  let query = supabase.from('vessels').select('*').order('number', { ascending: true });
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
    ({ error } = await supabase.from('vessels').update(body).eq('id', vesselId));
  } else {
    ({ error } = await supabase.from('vessels').insert(body));
  }
  if (error) { toast('Erro ao salvar embarcação', 'error'); return; }
  toast(vesselId ? 'Embarcação atualizada!' : 'Embarcação adicionada!', 'success');
  closeModal('vessel-modal');
  loadVessels(false);
}

async function toggleVesselActive(vesselId, currentActive) {
  const { error } = await supabase.from('vessels').update({ active: !currentActive, updated_at: new Date().toISOString() }).eq('id', vesselId);
  if (error) { toast('Erro ao atualizar', 'error'); return; }
  toast(`Embarcação ${currentActive ? 'desativada' : 'ativada'}`, 'success');
  loadVessels(false);
}

// ─── EMAIL INBOX ──────────────────────────────────────────────────
async function loadInbox() {
  let query = supabase.from('email_inbox').select('*').order('received_at', { ascending: false });
  if (state.inboxFilter) query = query.eq('status', state.inboxFilter);

  const { data, error } = await query;
  if (error) { console.error(error); return; }
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
    status: 'pendente',
    source: 'email',
    source_email_id: emailId,
    created_by: state.user?.id,
  };

  // Create task
  const { data: task, error: taskErr } = await supabase.from('tasks').insert(taskBody).select().single();
  if (taskErr) { toast('Erro ao criar tarefa', 'error'); return; }

  // Update email status
  await supabase.from('email_inbox').update({
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
    await supabase.from('email_inbox').update({
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
  let query = supabase.from('time_logs').select('*, tasks(title)').eq('user_id', state.user?.id).order('date', { ascending: false });

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

let timeChartInst = null;
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

  const { error } = await supabase.from('time_logs').insert(body);
  if (error) { toast('Erro ao salvar registro', 'error'); return; }
  toast('Registro salvo!', 'success');
  closeModal('timelog-modal');
  loadTimeLogs();
}

function confirmDeleteLog(logId) {
  openConfirm('Excluir Registro', 'Deseja excluir este registro de horas?', async () => {
    const { error } = await supabase.from('time_logs').delete().eq('id', logId);
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
    let query = supabase.from('tasks').select('*, vessels(name)')
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
    let query = supabase.from('tasks').select('*, vessels(name)').eq('status', 'concluida');
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

    const { data: logs } = await supabase.from('time_logs').select('*').gte('date', start).lte('date', end).order('date');
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
    const { data: tasks } = await supabase.from('tasks').select('category, status');
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

let confirmCallback = null;
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
