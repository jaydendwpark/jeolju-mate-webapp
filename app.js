const STORE_KEY = 'jeolju-mate-webapp-v3';

const ALCOHOL_UNITS = {
  SOJU: { name: '소주', unit: 1.0, baseAmount: '1병(360ml)' },
  BEER: { name: '맥주', unit: 0.38, baseAmount: '1캔(500cc)' },
  CHEONGHA: { name: '청하', unit: 0.66, baseAmount: '1병(300ml)' },
  MAEHWASU: { name: '매화수', unit: 0.61, baseAmount: '1병(300ml)' },
  WINE: { name: '와인', unit: 1.52, baseAmount: '1병(750ml)' },
  MAKKOLI: { name: '막걸리', unit: 0.76, baseAmount: '1병(750ml)' },
  WHISKEY: { name: '위스키', unit: 0.2, baseAmount: '1잔(30ml)' },
};

const state = loadState();
let tab = 'home';
let undoTimer = null;
let lastAddedLogIds = [];

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const themeToggle = document.getElementById('themeToggle');

function getSystemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getResolvedTheme() {
  return state.themeMode === 'auto' ? getSystemTheme() : state.themeMode;
}

function applyTheme() {
  const theme = getResolvedTheme();
  document.documentElement.setAttribute('data-theme', theme);

  if (themeToggle) {
    themeToggle.textContent = `테마 ${state.themeMode}`;
    themeToggle.title = `테마: ${state.themeMode} (${theme})`;
  }
}

function cycleThemeMode() {
  const order = ['auto', 'light', 'dark'];
  const idx = order.indexOf(state.themeMode || 'auto');
  state.themeMode = order[(idx + 1) % order.length];
  saveState();
  applyTheme();
  showToast(`테마: ${state.themeMode}`);
}

function loadState() {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      themeMode: parsed.themeMode || 'auto',
    };
  }
  return {
    weeklyGoal: 3.0,
    goalBaseType: 'SOJU',
    logs: [],
    isOnboarded: false,
    draftType: 'SOJU',
    draftEmoji: '🙂',
    draftMemo: '',
    themeMode: 'auto',
  };
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function toSojuUnits(amount, type) {
  return amount * ALCOHOL_UNITS[type].unit;
}

function fromSojuUnits(sojuUnits, type) {
  return sojuUnits / ALCOHOL_UNITS[type].unit;
}

function formatBaseAmount(baseAmount) {
  const m = String(baseAmount).match(/^1(잔|병)\((.+)\)$/);
  if (!m) return baseAmount;
  return `1${m[1]}=${m[2]}`;
}

function getUnitLabel(type) {
  return type === 'WHISKEY' ? '잔' : '병';
}


function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function showToast(message, options = {}) {
  const existing = document.getElementById('toast-msg');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'toast-msg';
  el.className = 'toast';

  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);

  if (options.actionLabel && typeof options.onAction === 'function') {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = options.actionLabel;
    btn.onclick = () => {
      options.onAction();
      el.remove();
    };
    el.appendChild(btn);
  }

  document.body.appendChild(el);

  setTimeout(() => {
    if (el.isConnected) el.remove();
  }, options.durationMs ?? 1000);
}

function buildAlcoholConversionList(baseType) {
  const baseName = ALCOHOL_UNITS[baseType].name;
  return Object.entries(ALCOHOL_UNITS)
    .map(([k, v]) => {
      const converted = fromSojuUnits(v.unit, baseType);
      const baseUnitLabel = getUnitLabel(baseType);
      return `<li>${v.name} ${v.baseAmount} ≈ ${converted.toFixed(2)}${baseUnitLabel}(${baseName} 기준)</li>`;
    })
    .join('');
}

function getTodayTotalSoju() {
  const today = new Date().toDateString();
  return state.logs
    .filter((l) => new Date(l.timestamp).toDateString() === today)
    .reduce((sum, l) => sum + toSojuUnits(l.amount, l.type), 0);
}

function getRolling7TotalSoju() {
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  return state.logs
    .filter((l) => new Date(l.timestamp).getTime() >= cutoff)
    .reduce((sum, l) => sum + toSojuUnits(l.amount, l.type), 0);
}

function getTodayLimitSoju() {
  const rolling = getRolling7TotalSoju();
  const today = getTodayTotalSoju();
  return Math.max(0, state.weeklyGoal - (rolling - today));
}

function getMonthTotalSoju() {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return state.logs
    .filter((l) => new Date(l.timestamp).getTime() >= first)
    .reduce((sum, l) => sum + toSojuUnits(l.amount, l.type), 0);
}

function render() {
  if (!state.isOnboarded) {
    nav.hidden = true;
    renderOnboarding();
    return;
  }

  nav.hidden = false;
  renderNav();

  if (tab === 'home') renderHome();
  else if (tab === 'history') renderHistory();
  else if (tab === 'stats') renderStats();
  else if (tab === 'settings') renderSettings();
  else {
    tab = 'home';
    renderHome();
  }
}

function renderNav() {
  nav.querySelectorAll('button').forEach((b) => {
    const key = (b.dataset.tab || '').trim();
    b.classList.toggle('active', key === tab);
    b.onclick = () => {
      if (!['home', 'history', 'stats', 'settings'].includes(key)) return;
      tab = key;
      render();
    };
  });
}

function renderOnboarding() {
  const typeOptions = Object.entries(ALCOHOL_UNITS)
    .map(([k, v]) => `<option value="${k}" ${state.goalBaseType === k ? 'selected' : ''}>${v.name} (${v.baseAmount})</option>`)
    .join('');

  const defaultGoalInSelected = fromSojuUnits(state.weeklyGoal, state.goalBaseType);

  view.innerHTML = `
    <section class="card">
      <h2 class="title">처음 설정</h2>
      <p class="sub">주간 목표 기준 주종을 먼저 고르세요.</p>

      <label>기준 주종</label>
      <select id="goalBaseType">${typeOptions}</select>

      <label id="goalInputLabel">주간 목표 (${getUnitLabel(state.goalBaseType)} 단위)</label>
      <input id="goalInput" type="number" step="0.5" min="0.5" value="${defaultGoalInSelected.toFixed(1)}" />

      <div class="row" style="margin-top:12px">
        <button class="ghost" id="minus">-0.5</button>
        <button class="ghost" id="plus">+0.5</button>
        <button class="primary" id="start">시작하기</button>
      </div>
    </section>
  `;

  const goalInput = document.getElementById('goalInput');
  const goalInputLabel = document.getElementById('goalInputLabel');
  const baseTypeEl = document.getElementById('goalBaseType');

  baseTypeEl.onchange = () => {
    const newType = baseTypeEl.value;
    const currentSojuGoal = state.weeklyGoal;
    goalInput.value = fromSojuUnits(currentSojuGoal, newType).toFixed(1);
    goalInputLabel.textContent = `주간 목표 (${getUnitLabel(newType)} 단위)`;
  };

  document.getElementById('minus').onclick = () => {
    goalInput.value = Math.max(0.5, Number(goalInput.value || 0) - 0.5).toFixed(1);
  };

  document.getElementById('plus').onclick = () => {
    goalInput.value = (Number(goalInput.value || 0) + 0.5).toFixed(1);
  };

  document.getElementById('start').onclick = () => {
    const baseType = baseTypeEl.value;
    const goalInBase = Math.max(0.5, Number(goalInput.value || 3));

    state.goalBaseType = baseType;
    state.weeklyGoal = toSojuUnits(goalInBase, baseType);
    state.isOnboarded = true;
    if (!state.draftType) state.draftType = baseType;

    saveState();
    tab = 'home';
    render();
  };
}

function renderHome() {
  const todayLimitSoju = getTodayLimitSoju();
  const rollingSoju = getRolling7TotalSoju();
  const monthSoju = getMonthTotalSoju();

  const baseType = state.goalBaseType;
  const baseInfo = ALCOHOL_UNITS[baseType];

  const todayLimit = fromSojuUnits(todayLimitSoju, baseType);
  const rolling = fromSojuUnits(rollingSoju, baseType);
  const weeklyGoal = fromSojuUnits(state.weeklyGoal, baseType);
  const month = fromSojuUnits(monthSoju, baseType);

  const progress = Math.min(100, (rollingSoju / state.weeklyGoal) * 100 || 0);
  const todayLimitAsSojuBottles = todayLimitSoju.toFixed(1);

  // Draft date: YYYY-MM-DD (default: 2 days ago)
  if (!state.draftDate) {
    state.draftDate = formatDateKey(addDays(new Date(), -2));
    saveState();
  }
  if (!state.draftTotals) state.draftTotals = {};
  if (!state.draftEmoji) state.draftEmoji = '🙂';
  if (typeof state.draftMemo !== 'string') state.draftMemo = '';

  const baseUnitLabel = getUnitLabel(baseType);

  const quickButtons = [
    { label: '소주 반병', type: 'SOJU', amount: 0.5 },
    { label: '맥주 한캔(500cc)', type: 'BEER', amount: 1 },
    { label: '청하 반병', type: 'CHEONGHA', amount: 0.5 },
    { label: '매화수 반병', type: 'MAEHWASU', amount: 0.5 },
    { label: '와인 반병', type: 'WINE', amount: 0.5 },
    { label: '막걸리 반병', type: 'MAKKOLI', amount: 0.5 },
    { label: '위스키 한잔', type: 'WHISKEY', amount: 1 },
  ];

  const addedLines = Object.entries(state.draftTotals)
    .filter(([, v]) => Number(v) > 0)
    .map(([t, v]) => {
      const info = ALCOHOL_UNITS[t];
      const unitSoju = toSojuUnits(Number(v), t);
      const converted = fromSojuUnits(unitSoju, baseType);
      return `
        <div class="draft-chip">
          <div><strong>${info.name}</strong> · ${Number(v).toFixed(1)}${getUnitLabel(t)}</div>
          <div class="small">환산 ${converted.toFixed(2)}${baseUnitLabel}</div>
        </div>
      `;
    })
    .join('');

  view.innerHTML = `
    <section class="card">
      <div class="row" style="justify-content:flex-start;align-items:center;">
        <h2 class="title" style="margin:0">오늘 마실 수 있는 양</h2>
        <span class="info-inline">
          <button class="info-btn" id="formulaInfoBtn" title="계산식/환산표">i</button>
          <span id="formulaInfoBox" class="info-pop-inline" style="display:none;">
            <div class="info-title">계산식</div>
            <div>주간 목표 - (최근7일 누적 - 오늘 섭취)</div>
            <div class="info-title" style="margin-top:8px;">주종별 알콜 환산표</div>
            <ul>${buildAlcoholConversionList(baseType)}</ul>
          </span>
        </span>
      </div>
      <div class="big">• ${baseInfo.name} ${todayLimit.toFixed(1)}${baseUnitLabel} <span class="unit-note">(${formatBaseAmount(baseInfo.baseAmount)})</span></div>
      <p class="sub">환산: 소주 약 ${todayLimitAsSojuBottles}병</p>
      ${todayLimitSoju <= 0
        ? `<div class="warn-badge danger critical">⚠️ 오늘 가능량 0 · 음주 중단 권고</div>`
        : progress >= 90
          ? `<div class="warn-badge caution">주의: 주간 목표의 ${progress.toFixed(0)}%를 사용했어요.</div>`
          : ''}
    </section>

    <section class="card">
      <h2 class="title">주간 진행률</h2>
      <p class="sub">${rolling.toFixed(1)} / ${weeklyGoal.toFixed(1)} (${baseInfo.name} 기준)</p>
      <div class="progress-wrap"><div class="progress" style="width:${progress}%"></div></div>
    </section>

    <section class="card">
      <h2 class="title">월 누적</h2>
      <div class="big" style="font-size:28px">${baseInfo.name} ${month.toFixed(1)}${baseUnitLabel} <span class="unit-note">(${formatBaseAmount(baseInfo.baseAmount)})</span></div>
    </section>

    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h2 class="title" style="margin:0">음주 기록 추가</h2>
        <div class="row" style="gap:6px;">
          <button class="ghost date-btn" id="datePick">${state.draftDate}</button>
          <button class="ghost date-btn" id="dateYesterday">어제</button>
          <button class="ghost date-btn" id="dateToday">오늘</button>
        </div>
      </div>
      <input id="dateInput" type="date" style="display:none;" />

      ${addedLines ? `<div class="draft-chips" style="margin-top:10px">${addedLines}</div>` : `<p class="empty" style="margin:10px 0 0">아직 추가된 음주가 없어요.</p>`}

      <label style="margin-top:14px">음주 추가</label>
      <div class="quick-add-grid" id="quickAddButtons">
        ${quickButtons.map((b)=>`<button class="ghost" data-add-type="${b.type}" data-add-amount="${b.amount}">${b.label}</button>`).join('')}
      </div>

      <label style="margin-top:14px">감정 이모티콘</label>
      <div class="emoji-row" id="emojiRow">
        ${['🙂','😊','😌','😎','😵','🤢','😢','🥳'].map((e)=>`<button class="ghost emoji-btn ${state.draftEmoji===e?'active':''}" data-emoji="${e}">${e}</button>`).join('')}
      </div>

      <label style="margin-top:12px">메모</label>
      <textarea id="memoInput" rows="2" placeholder="예: 친구들과 한잔, 회식 등">${state.draftMemo || ''}</textarea>

      <div class="row" style="margin-top:12px">
        <button class="primary" id="registerLog">등록</button>
        <button class="danger" id="clearDraft">초기화</button>
      </div>
    </section>
  `;

  document.getElementById('formulaInfoBtn').onclick = () => {
    const box = document.getElementById('formulaInfoBox');
    const isHidden = box.style.display === 'none';
    box.style.display = isHidden ? 'block' : 'none';
  };

  // Date controls
  const dateInput = document.getElementById('dateInput');
  const todayKey = formatDateKey(new Date());
  const yesterdayKey = formatDateKey(addDays(new Date(), -1));

  const datePickBtn = document.getElementById('datePick');
  const dateYesterdayBtn = document.getElementById('dateYesterday');
  const dateTodayBtn = document.getElementById('dateToday');

  datePickBtn.classList.toggle('active', state.draftDate !== todayKey && state.draftDate !== yesterdayKey);
  dateYesterdayBtn.classList.toggle('active', state.draftDate === yesterdayKey);
  dateTodayBtn.classList.toggle('active', state.draftDate === todayKey);

  const setDate = (d) => {
    state.draftDate = formatDateKey(d);
    saveState();
    render();
  };

  dateTodayBtn.onclick = () => setDate(new Date());
  dateYesterdayBtn.onclick = () => setDate(addDays(new Date(), -1));
  datePickBtn.onclick = () => {
    dateInput.style.display = 'block';
    dateInput.value = state.draftDate;
    dateInput.focus();
    dateInput.showPicker?.();
  };

  dateInput.onchange = () => {
    if (dateInput.value) {
      state.draftDate = dateInput.value;
      saveState();
      render();
    }
  };

  // Emoji and memo
  document.querySelectorAll('button[data-emoji]').forEach((btn) => {
    btn.onclick = () => {
      state.draftEmoji = btn.dataset.emoji;
      saveState();
      render();
    };
  });

  const memoInput = document.getElementById('memoInput');
  memoInput.oninput = () => {
    state.draftMemo = memoInput.value;
    saveState();
  };

  // Quick add buttons
  document.querySelectorAll('button[data-add-type]').forEach((btn) => {
    btn.onclick = () => {
      const t = btn.dataset.addType;
      const a = Number(btn.dataset.addAmount);
      state.draftTotals[t] = Number(state.draftTotals[t] || 0) + a;
      saveState();
      render();
    };
  });

  document.getElementById('clearDraft').onclick = () => {
    state.draftTotals = {};
    state.draftMemo = '';
    state.draftEmoji = '🙂';
    saveState();
    render();
  };

  document.getElementById('registerLog').onclick = () => {
    const entries = Object.entries(state.draftTotals || {}).filter(([, v]) => Number(v) > 0);
    if (!entries.length) return alert('추가된 음주가 없습니다.');

    // timestamp: selected date at 12:00 local time (avoid timezone surprises)
    const [y, m, d] = state.draftDate.split('-').map(Number);
    const ts = new Date(y, (m - 1), d, 12, 0, 0, 0).toISOString();

    const createdIds = [];
    const batchId = 'batch-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const createdAt = new Date().toISOString();

    entries.forEach(([t, v]) => {
      const id = String(Date.now()) + '-' + t + '-' + Math.random().toString(36).slice(2, 7);
      createdIds.push(id);
      state.logs.push({
        id,
        batchId,
        createdAt,
        type: t,
        amount: Number(v),
        timestamp: ts,
        emoji: state.draftEmoji,
        memo: state.draftMemo?.trim() || '',
      });
    });

    state.draftTotals = {};
    state.draftMemo = '';
    saveState();
    render();

    lastAddedLogIds = createdIds;
    if (undoTimer) clearTimeout(undoTimer);
    showToast('등록되었습니다.', {
      actionLabel: '되돌리기',
      durationMs: 3000,
      onAction: () => {
        if (!lastAddedLogIds.length) return;
        state.logs = state.logs.filter((l) => !lastAddedLogIds.includes(l.id));
        lastAddedLogIds = [];
        saveState();
        render();
        showToast('등록을 되돌렸습니다.');
      },
    });

    undoTimer = setTimeout(() => {
      lastAddedLogIds = [];
      undoTimer = null;
    }, 3000);
  };
}


function renderHistory() {
  const baseType = state.goalBaseType;
  const baseInfo = ALCOHOL_UNITS[baseType];

  // 등록 건(batch) 기준으로 그룹화
  const groups = new Map();
  state.logs.forEach((log) => {
    const key = log.batchId || `legacy-${log.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        timestamp: log.timestamp,
        createdAt: log.createdAt || log.timestamp,
        emoji: log.emoji || '',
        memo: log.memo || '',
        items: [],
      });
    }
    const g = groups.get(key);
    g.items.push(log);
    // 그룹 메타 최신값 보정
    if (log.createdAt && new Date(log.createdAt) > new Date(g.createdAt)) g.createdAt = log.createdAt;
    if (log.emoji) g.emoji = log.emoji;
    if (log.memo) g.memo = log.memo;
  });

  const grouped = [...groups.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (!grouped.length) {
    view.innerHTML = `<section class="card"><p class="empty">기록이 없습니다.</p></section>`;
    return;
  }

  view.innerHTML = `
    <section class="card">
      <h2 class="title">기록 히스토리</h2>
      <p class="sub">등록 건 단위로 묶어서 표시됩니다. (${baseInfo.name} ${getUnitLabel(baseType)} 기준 환산)</p>
      <div id="list"></div>
    </section>
  `;

  const list = document.getElementById('list');

  grouped.forEach((g) => {
    const el = document.createElement('div');
    el.className = 'list-item';

    const itemLines = g.items
      .map((l) => {
        const info = ALCOHOL_UNITS[l.type];
        const sojuUnits = toSojuUnits(l.amount, l.type);
        const converted = fromSojuUnits(sojuUnits, baseType);
        return `<div class="small">• ${info.name} ${l.amount}${getUnitLabel(l.type)} (환산 ${baseInfo.name} ${converted.toFixed(2)}${getUnitLabel(baseType)})</div>`;
      })
      .join('');

    el.innerHTML = `
      <div class="history-row">
        <div class="history-main">
          <div><strong>${g.emoji ? g.emoji + ' ' : ''}${new Date(g.timestamp).toLocaleDateString('ko-KR')} 기록</strong></div>
          <div class="small">등록시각: ${new Date(g.createdAt).toLocaleString('ko-KR')}</div>
          ${g.memo ? `<div class="small">메모: ${g.memo}</div>` : ''}
          <div style="margin-top:6px">${itemLines}</div>
        </div>
        <div class="history-actions">
          <button class="ghost btn-sm" data-group-edit="${g.key}">편집</button>
          <button class="danger btn-sm" data-group-del="${g.key}">삭제</button>
        </div>
      </div>
    `;

    list.appendChild(el);
  });

  // 그룹 편집: 날짜/감정/메모 편집
  list.querySelectorAll('button[data-group-edit]').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.groupEdit;
      const target = grouped.find((g) => g.key === key);
      if (!target) return;

      const dateKey = formatDateKey(new Date(target.timestamp));
      const nextDate = prompt('날짜(YYYY-MM-DD)를 입력해 주세요.', dateKey);
      if (nextDate === null) return;
      const dm = nextDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dm) return alert('날짜 형식이 올바르지 않습니다. 예: 2026-03-06');

      const nextEmoji = prompt('감정 이모티콘을 입력해 주세요.', target.emoji || '🙂');
      if (nextEmoji === null) return;

      const nextMemo = prompt('메모를 입력해 주세요.', target.memo || '');
      if (nextMemo === null) return;

      const y = Number(dm[1]);
      const mo = Number(dm[2]);
      const d = Number(dm[3]);
      const nextTs = new Date(y, mo - 1, d, 12, 0, 0, 0).toISOString();

      state.logs.forEach((l) => {
        const lKey = l.batchId || `legacy-${l.id}`;
        if (lKey === key) {
          l.timestamp = nextTs;
          l.emoji = nextEmoji;
          l.memo = nextMemo;
        }
      });

      saveState();
      render();
      showToast('등록 건을 편집했습니다.');
    };
  });

  // 그룹 삭제
  list.querySelectorAll('button[data-group-del]').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.groupDel;
      state.logs = state.logs.filter((l) => (l.batchId || `legacy-${l.id}`) !== key);
      saveState();
      render();
      showToast('등록 건을 삭제했습니다.');
    };
  });
}


function renderStats() {
  const baseType = state.goalBaseType;
  const baseInfo = ALCOHOL_UNITS[baseType];

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff7 = now - 7 * dayMs;
  const cutoff30 = now - 30 * dayMs;

  const logs7 = state.logs.filter((l) => new Date(l.timestamp).getTime() >= cutoff7);
  const logs30 = state.logs.filter((l) => new Date(l.timestamp).getTime() >= cutoff30);

  const total7Soju = logs7.reduce((sum, l) => sum + toSojuUnits(l.amount, l.type), 0);
  const total30Soju = logs30.reduce((sum, l) => sum + toSojuUnits(l.amount, l.type), 0);

  const byTypeSoju = Object.fromEntries(Object.keys(ALCOHOL_UNITS).map((k) => [k, 0]));
  logs30.forEach((l) => {
    byTypeSoju[l.type] += toSojuUnits(l.amount, l.type);
  });

  const totalTypeSoju = Object.values(byTypeSoju).reduce((a, b) => a + b, 0);

  const byTypeRows = Object.entries(byTypeSoju)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => {
      const pct = totalTypeSoju > 0 ? (v / totalTypeSoju) * 100 : 0;
      const inBase = fromSojuUnits(v, baseType);
      return `
        <div class="stats-row">
          <div class="stats-row-head">
            <strong>${ALCOHOL_UNITS[k].name}</strong>
            <span>${pct.toFixed(1)}%</span>
          </div>
          <div class="progress-wrap"><div class="progress" style="width:${pct}%"></div></div>
          <div class="small">${inBase.toFixed(2)} ${baseInfo.name} 환산</div>
        </div>
      `;
    })
    .join('');

  const dayBuckets = [0, 0, 0, 0, 0, 0, 0];
  logs30.forEach((l) => {
    const d = new Date(l.timestamp).getDay();
    dayBuckets[d] += toSojuUnits(l.amount, l.type);
  });
  const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
  const peak = Math.max(...dayBuckets, 0);

  const weekdayRows = dayBuckets
    .map((v, i) => {
      const pct = peak > 0 ? (v / peak) * 100 : 0;
      return `
        <div class="stats-week-row">
          <span class="stats-day">${dayLabels[i]}</span>
          <div class="progress-wrap" style="flex:1"><div class="progress" style="width:${pct}%"></div></div>
          <span class="small" style="min-width:80px;text-align:right;">${fromSojuUnits(v, baseType).toFixed(2)} ${baseInfo.name}</span>
        </div>
      `;
    })
    .join('');

  const weeklyPct = Math.min(999, (getRolling7TotalSoju() / state.weeklyGoal) * 100 || 0);

  view.innerHTML = `
    <section class="card">
      <h2 class="title">통계</h2>
      <p class="sub">최근 기록 기반으로 패턴을 보여드려요.</p>
    </section>

    <section class="card">
      <h3 class="title">최근 음주량</h3>
      <div class="stats-dual" style="display:flex;gap:10px;flex-wrap:nowrap;">
        <div class="list-item" style="flex:1;min-width:0;">
          <div class="small">최근 7일</div>
          <div class="big" style="font-size:26px">${fromSojuUnits(total7Soju, baseType).toFixed(2)}</div>
          <div class="small">${baseInfo.name} 기준</div>
        </div>
        <div class="list-item" style="flex:1;min-width:0;">
          <div class="small">최근 30일</div>
          <div class="big" style="font-size:26px">${fromSojuUnits(total30Soju, baseType).toFixed(2)}</div>
          <div class="small">${baseInfo.name} 기준</div>
        </div>
      </div>
      <div class="small" style="margin-top:8px;">주간 목표 사용률: ${weeklyPct.toFixed(0)}%</div>
      <div class="progress-wrap"><div class="progress" style="width:${Math.min(100, weeklyPct)}%"></div></div>
    </section>

    <section class="card">
      <h3 class="title">주종별 비중 (최근 30일)</h3>
      ${byTypeRows || '<p class="empty">아직 통계를 낼 기록이 없어요.</p>'}
    </section>

    <section class="card">
      <h3 class="title">요일별 패턴 (최근 30일)</h3>
      ${weekdayRows}
    </section>
  `;
}

function renderSettings() {
  const typeOptions = Object.entries(ALCOHOL_UNITS)
    .map(([k, v]) => `<option value="${k}" ${state.goalBaseType === k ? 'selected' : ''}>${v.name} (${v.baseAmount})</option>`)
    .join('');

  const goalInBase = fromSojuUnits(state.weeklyGoal, state.goalBaseType);

  view.innerHTML = `
    <section class="card">
      <h2 class="title">설정</h2>
      <p class="sub">기준 주종, 주간 목표, 화면 테마를 변경할 수 있어요.</p>

      <label>화면 테마</label>
      <select id="settingsThemeMode">
        <option value="auto" ${state.themeMode === 'auto' ? 'selected' : ''}>자동 (시스템)</option>
        <option value="light" ${state.themeMode === 'light' ? 'selected' : ''}>화이트 모드</option>
        <option value="dark" ${state.themeMode === 'dark' ? 'selected' : ''}>다크 모드</option>
      </select>

      <label>기준 주종</label>
      <select id="settingsBaseType">${typeOptions}</select>

      <label id="settingsGoalLabel">주간 목표 (${getUnitLabel(state.goalBaseType)} 단위)</label>
      <input id="settingsGoal" type="number" step="0.5" min="0.5" value="${goalInBase.toFixed(1)}" />

      <div class="row" style="margin-top:12px">
        <button class="primary" id="saveSettings">저장</button>
      </div>
    </section>
  `;

  const settingsBaseTypeEl = document.getElementById('settingsBaseType');
  const settingsGoalEl = document.getElementById('settingsGoal');
  const settingsGoalLabelEl = document.getElementById('settingsGoalLabel');

  settingsBaseTypeEl.onchange = () => {
    const newType = settingsBaseTypeEl.value;
    settingsGoalEl.value = fromSojuUnits(state.weeklyGoal, newType).toFixed(1);
    settingsGoalLabelEl.textContent = `주간 목표 (${getUnitLabel(newType)} 단위)`;
  };

  document.getElementById('saveSettings').onclick = () => {
    const themeMode = document.getElementById('settingsThemeMode').value;
    const baseType = settingsBaseTypeEl.value;
    const goalInSelected = Math.max(0.5, Number(settingsGoalEl.value || 3));

    state.themeMode = themeMode;
    state.goalBaseType = baseType;
    state.weeklyGoal = toSojuUnits(goalInSelected, baseType);

    saveState();
    applyTheme();
    tab = 'home';
    render();
    showToast('설정을 저장했어요.');
  };
}

if (themeToggle) {
  themeToggle.onclick = cycleThemeMode;
}

if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', () => {
    if (state.themeMode === 'auto') applyTheme();
  });
}

applyTheme();
render();