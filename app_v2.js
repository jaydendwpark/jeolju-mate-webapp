const STORE_KEY = 'jeolju-mate-webapp-v3';

const ALCOHOL_UNITS = {
  SOJU: { name: '소주', unit: 1.0, baseAmount: '1병(360ml)', unitLabel: '병' },
  BEER: { name: '맥주', unit: 0.38, baseAmount: '1캔(500cc)', unitLabel: '캔' },
  CHEONGHA: { name: '청하', unit: 0.66, baseAmount: '1병(300ml)', unitLabel: '병' },
  MAEHWASU: { name: '매화수', unit: 0.61, baseAmount: '1병(300ml)', unitLabel: '병' },
  WINE: { name: '와인', unit: 1.52, baseAmount: '1병(750ml)', unitLabel: '병' },
  MAKKOLI: { name: '막걸리', unit: 0.76, baseAmount: '1병(750ml)', unitLabel: '병' },
  WHISKEY: { name: '위스키', unit: 0.2, baseAmount: '1잔(30ml)', unitLabel: '잔' },
  HIGHBALL: { name: '하이볼', unit: 0.3, baseAmount: '1잔(250ml)', unitLabel: '잔' },
  SAKE: { name: '사케', unit: 1.82, baseAmount: '1병(720ml)', unitLabel: '병' },
};

const state = loadState();
let tab = 'home';
let historySubTab = 'list'; // 'list' | 'calendar'
let undoTimer = null;
let lastAddedLogIds = [];

// Calendar state
let calendarDate = new Date(); // Viewing month
let selectedDateKey = null; // Date for popup

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const themeToggle = document.getElementById('themeToggle');
const adSlot = document.getElementById('adSlot');

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
  const defaultState = {
    weeklyGoal: 3.0,
    goalBaseType: 'SOJU',
    logs: [],
    isOnboarded: false,
    onboardedAt: null,
    isPremium: false,
    draftType: 'SOJU',
    draftEmoji: '🙂',
    draftMemo: '',
    themeMode: 'auto',
    disabledTypes: {},
  };

  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return defaultState;

  try {
    const parsed = JSON.parse(raw);
    const logs = Array.isArray(parsed.logs) ? parsed.logs : [];
    const disabledTypes = parsed.disabledTypes && typeof parsed.disabledTypes === 'object' ? parsed.disabledTypes : {};

    return {
      ...defaultState,
      ...parsed,
      logs,
      disabledTypes,
      themeMode: ['auto', 'light', 'dark'].includes(parsed.themeMode) ? parsed.themeMode : 'auto',
      onboardedAt: parsed.onboardedAt || null,
      isPremium: Boolean(parsed.isPremium),
    };
  } catch (err) {
    console.warn('Failed to parse saved app state. Falling back to defaults.', err);
    localStorage.removeItem(STORE_KEY);
    return defaultState;
  }
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function toSojuUnits(amount, type) {
  return amount * (ALCOHOL_UNITS[type]?.unit || 1.0);
}

function fromSojuUnits(sojuUnits, type) {
  return sojuUnits / (ALCOHOL_UNITS[type]?.unit || 1.0);
}

function formatBaseAmount(baseAmount) {
  const m = String(baseAmount).match(/^1(잔|병)\((.+)\)$/);
  if (!m) return baseAmount;
  return `1${m[1]}=${m[2]}`;
}

function getUnitLabel(type) {
  return ALCOHOL_UNITS[type]?.unitLabel || '병';
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

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function toNoonIsoFromDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
}

function getConsecutiveSobrietyDays() {
  if (!state.onboardedAt) return 0;

  const logs = state.logs;
  const weeklyGoal = state.weeklyGoal;
  const onboardingDate = new Date(state.onboardedAt);
  onboardingDate.setHours(0, 0, 0, 0);

  let streak = 0;
  let checkDate = new Date();
  checkDate.setHours(12, 0, 0, 0);

  while (true) {
    if (checkDate.getTime() < onboardingDate.getTime()) break;

    const cutoff = checkDate.getTime() + 12 * 60 * 60 * 1000;
    const startWindow = cutoff - 7 * 24 * 60 * 60 * 1000;

    const rollingSum = logs
      .filter((l) => {
        const ts = new Date(l.timestamp).getTime();
        return ts >= startWindow && ts <= cutoff;
      })
      .reduce((sum, l) => sum + toSojuUnits(l.amount, l.type), 0);

    if (rollingSum <= weeklyGoal) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
    if (streak > 365) break;
  }
  return streak;
}

function showToast(message, options = {}) {
  const existing = document.getElementById('toast-msg');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'toast-msg';
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');

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

function isTypeEnabled(type) {
  return !state.disabledTypes?.[type];
}

function getTodayTotalSoju() {
  const today = formatDateKey(new Date());
  return state.logs
    .filter((l) => formatDateKey(new Date(l.timestamp)) === today)
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
  return Math.max(0, state.weeklyGoal - rolling);
}

function getMonthTotalSoju() {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return state.logs
    .filter((l) => new Date(l.timestamp).getTime() >= first)
    .reduce((sum, l) => sum + toSojuUnits(l.amount, l.type), 0);
}

function renderAd() {
  if (!adSlot) return;

  if (state.isPremium) {
    adSlot.innerHTML = '';
    return;
  }

  adSlot.innerHTML = `
    <div class="ad-banner">
      <div class="ad-text">AD: 간 건강을 위한 영양제 추천 🌿</div>
    </div>
  `;
}

function render() {
  if (!state.isOnboarded) {
    nav.hidden = true;
    if (adSlot) adSlot.innerHTML = '';
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

  renderAd();
}

function renderNav() {
  nav.setAttribute('role', 'tablist');
  nav.querySelectorAll('button').forEach((b) => {
    const key = (b.dataset.tab || '').trim();
    const isActive = key === tab;
    b.classList.toggle('active', isActive);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(isActive));
    b.setAttribute('aria-current', isActive ? 'page' : 'false');
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
    state.onboardedAt = new Date().toISOString();
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
  const sobrietyStreak = getConsecutiveSobrietyDays();

  const baseType = state.goalBaseType;
  const baseInfo = ALCOHOL_UNITS[baseType];

  const todayLimit = fromSojuUnits(todayLimitSoju, baseType);
  const rolling = fromSojuUnits(rollingSoju, baseType);
  const weeklyGoal = fromSojuUnits(state.weeklyGoal, baseType);
  const month = fromSojuUnits(monthSoju, baseType);

  const progress = Math.min(100, (rollingSoju / state.weeklyGoal) * 100 || 0);
  const todayLimitAsSojuBottles = todayLimitSoju.toFixed(1);

  if (!state.draftDate) {
    state.draftDate = formatDateKey(addDays(new Date(), -1));
    saveState();
  }
  if (!state.draftTotals) state.draftTotals = {};
  if (!state.draftEmoji) state.draftEmoji = '🙂';
  if (typeof state.draftMemo !== 'string') state.draftMemo = '';

  const baseUnitLabel = getUnitLabel(baseType);

  const quickButtonMap = {
    SOJU: { label: '소주 반병', amount: 0.5 },
    BEER: { label: '맥주 한캔(500cc)', amount: 1 },
    CHEONGHA: { label: '청하 반병', amount: 0.5 },
    MAEHWASU: { label: '매화수 반병', amount: 0.5 },
    WINE: { label: '와인 반병', amount: 0.5 },
    MAKKOLI: { label: '막걸리 반병', amount: 0.5 },
    WHISKEY: { label: '위스키 한잔', amount: 1 },
    HIGHBALL: { label: '하이볼 한잔', amount: 1 },
    SAKE: { label: '사케 반병', amount: 0.5 },
  };

  const quickButtons = Object.entries(ALCOHOL_UNITS)
    .filter(([k]) => isTypeEnabled(k))
    .map(([k, v]) => {
      if (quickButtonMap[k]) return { ...quickButtonMap[k], type: k };
      return { label: `${v.name} +1${getUnitLabel(k)}`, type: k, amount: 1 };
    });

  const addedLines = Object.entries(state.draftTotals)
    .filter(([, v]) => Number(v) > 0)
    .map(([t, v]) => {
      const info = ALCOHOL_UNITS[t];
      const unitSoju = toSojuUnits(Number(v), t);
      const converted = fromSojuUnits(unitSoju, baseType);
      return `
        <div class="draft-chip">
          <div class="draft-chip-head">
            <div class="draft-meta">
              <strong>${info.name}</strong>
              <span class="draft-qty">${Number(v).toFixed(1)}${getUnitLabel(t)}</span>
            </div>
            <button class="danger btn-sm" data-draft-del="${t}">삭제</button>
          </div>
          <div class="small">환산 ${converted.toFixed(2)}${baseUnitLabel}</div>
        </div>
      `;
    })
    .join('');

  const draftEntries = Object.entries(state.draftTotals).filter(([, v]) => Number(v) > 0);
  const draftTotalSoju = draftEntries.reduce((sum, [type, amount]) => sum + toSojuUnits(Number(amount), type), 0);
  const draftTotalInBase = fromSojuUnits(draftTotalSoju, baseType);
  const hasDraftEntries = draftEntries.length > 0;

  view.innerHTML = `
    <div class="streak-line">연속 절주 성공 ${sobrietyStreak}일째 🔥</div>

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
      <div class="row" style="justify-content:flex-start;align-items:center;">
        <h2 class="title" style="margin:0">오늘 더 마실 수 있는 양</h2>
        <span class="info-inline">
          <button class="info-btn" id="formulaInfoBtn" title="계산식/환산표">i</button>
          <span id="formulaInfoBox" class="info-pop-inline" style="display:none;">
            <div class="info-title">계산식</div>
            <div>주간 목표 - 최근 7일 누적(오늘 포함)</div>
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
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h2 class="title" style="margin:0">음주 기록 추가</h2>
        <button class="primary top-register-btn" id="registerLogTop" ${hasDraftEntries ? '' : 'disabled'} aria-disabled="${hasDraftEntries ? 'false' : 'true'}">등록</button>
      </div>

      <div class="row date-actions" style="margin-bottom:14px; gap:8px;">
        <button class="ghost date-btn" id="datePick">${state.draftDate}</button>
        <button class="ghost date-btn" id="dateYesterday">어제</button>
        <button class="ghost date-btn" id="dateToday">오늘</button>
      </div>
      <input id="dateInput" type="date" style="display:none;" />

      ${addedLines ? `<div class="draft-chips" style="margin-top:10px">${addedLines}</div>` : `<p class="empty" style="margin:10px 0 0">아직 추가된 음주가 없어요.</p>`}
      <p class="sub" style="margin-top:10px;">현재 초안 합계: ${baseInfo.name} ${draftTotalInBase.toFixed(2)}${baseUnitLabel} (소주 ${draftTotalSoju.toFixed(2)}병 환산)</p>

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

      <div class="row" style="margin-top:12px;">
        <button class="primary" id="registerLog" ${hasDraftEntries ? '' : 'disabled'} aria-disabled="${hasDraftEntries ? 'false' : 'true'}">등록</button>
        <button class="danger" id="clearDraft">초기화</button>
      </div>
    </section>
  `;

  const formulaInfoBtn = document.getElementById('formulaInfoBtn');
  const formulaInfoBox = document.getElementById('formulaInfoBox');
  formulaInfoBtn.setAttribute('aria-label', '계산식 및 환산표 보기');
  formulaInfoBtn.setAttribute('aria-expanded', 'false');
  formulaInfoBtn.setAttribute('aria-controls', 'formulaInfoBox');

  formulaInfoBtn.onclick = () => {
    const isHidden = formulaInfoBox.style.display === 'none';
    formulaInfoBox.style.display = isHidden ? 'block' : 'none';
    formulaInfoBtn.setAttribute('aria-expanded', String(isHidden));
  };

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

  document.querySelectorAll('button[data-add-type]').forEach((btn) => {
    btn.onclick = () => {
      const t = btn.dataset.addType;
      const a = Number(btn.dataset.addAmount);
      state.draftTotals[t] = Number(state.draftTotals[t] || 0) + a;
      saveState();
      render();
    };
  });

  document.querySelectorAll('button[data-draft-del]').forEach((btn) => {
    btn.onclick = () => {
      const t = btn.dataset.draftDel;
      delete state.draftTotals[t];
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

  const registerLog = () => {
    const entries = Object.entries(state.draftTotals || {}).filter(([, v]) => Number(v) > 0);
    if (!entries.length) return alert('추가된 음주가 없습니다.');

    if (!isValidDateKey(state.draftDate)) {
      showToast('날짜 형식이 올바르지 않습니다.');
      return;
    }
    const ts = toNoonIsoFromDateKey(state.draftDate);

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

  document.getElementById('registerLog').onclick = registerLog;
  const registerLogTopBtn = document.getElementById('registerLogTop');
  if (registerLogTopBtn) registerLogTopBtn.onclick = registerLog;
}

function renderHistory() {
  const baseType = state.goalBaseType;
  const baseInfo = ALCOHOL_UNITS[baseType];

  view.innerHTML = `
    <section class="card" style="padding-top: 10px;">
      <div class="row history-tab-header" role="tablist" aria-label="기록 보기 방식">
        <button class="ghost ${historySubTab === 'list' ? 'active' : ''}" id="switchToHistoryList" role="tab" aria-selected="${historySubTab === 'list'}">일별 보기</button>
        <button class="ghost ${historySubTab === 'calendar' ? 'active' : ''}" id="switchToHistoryCal" role="tab" aria-selected="${historySubTab === 'calendar'}">월간 보기</button>
      </div>
      <div id="historyContent"></div>
    </section>

    <div id="historyPopup" class="modal-overlay" style="display:none;" role="presentation">
      <div class="modal-content card" role="dialog" aria-modal="true" aria-labelledby="popupDateTitle">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <h3 class="title" id="popupDateTitle">기록</h3>
          <button class="ghost btn-sm" id="closePopup" aria-label="기록 팝업 닫기">닫기</button>
        </div>
        <div id="popupList" class="popup-list"></div>
      </div>
    </div>
  `;

  document.getElementById('switchToHistoryList').onclick = () => { historySubTab = 'list'; renderHistory(); };
  document.getElementById('switchToHistoryCal').onclick = () => { historySubTab = 'calendar'; renderHistory(); };

  const historyContent = document.getElementById('historyContent');

  if (historySubTab === 'calendar') {
    renderHistoryCalendar(historyContent);
  } else {
    renderHistoryList(historyContent);
  }
}

function openBatchEditModal(group, onSubmit) {
  const typeOptions = Object.entries(ALCOHOL_UNITS)
    .map(([key, info]) => `<option value="${key}">${info.name}</option>`)
    .join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'presentation');
  overlay.innerHTML = `
    <div class="modal-content card edit-modal" role="dialog" aria-modal="true" aria-labelledby="batchEditTitle">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h3 class="title" id="batchEditTitle">기록 편집</h3>
        <button class="ghost btn-sm" type="button" data-modal-close aria-label="편집 닫기">닫기</button>
      </div>
      <label for="editDateInput">날짜</label>
      <input id="editDateInput" type="date" value="${group.dateKey}" />
      <p class="small" id="editDateError" style="color:var(--danger);display:none;margin-top:6px;">유효한 날짜를 선택해 주세요.</p>

      <label>음주 항목</label>
      <div id="editItemsWrap" class="edit-items-wrap">
        ${group.items.map((item, idx) => `
          <div class="edit-item-row" data-edit-index="${idx}">
            <select data-field="type">${typeOptions}</select>
            <input data-field="amount" type="number" step="0.1" min="0" value="${Number(item.amount)}" />
          </div>
        `).join('')}
      </div>
      <p class="small" id="editItemsError" style="color:var(--danger);display:none;margin-top:6px;">주종과 음주량을 올바르게 입력해 주세요.</p>

      <label for="editEmojiInput">이모티콘</label>
      <input id="editEmojiInput" type="text" maxlength="2" value="${group.emoji || '🙂'}" />

      <label for="editMemoInput">메모</label>
      <textarea id="editMemoInput" rows="3" placeholder="메모를 입력하세요">${group.memo || ''}</textarea>

      <div class="row" style="margin-top:12px;justify-content:flex-end;">
        <button class="ghost" type="button" data-modal-close>취소</button>
        <button class="primary" type="button" id="saveBatchEdit">저장</button>
      </div>
    </div>
  `;

  const closeModal = () => overlay.remove();

  overlay.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.onclick = closeModal;
  });
  overlay.onclick = (e) => {
    if (e.target === overlay) closeModal();
  };
  overlay.onkeydown = (e) => {
    if (e.key === 'Escape') closeModal();
  };

  const dateInput = overlay.querySelector('#editDateInput');
  const dateError = overlay.querySelector('#editDateError');
  const itemsError = overlay.querySelector('#editItemsError');
  const emojiInput = overlay.querySelector('#editEmojiInput');
  const memoInput = overlay.querySelector('#editMemoInput');

  group.items.forEach((item, idx) => {
    const row = overlay.querySelector(`.edit-item-row[data-edit-index="${idx}"]`);
    if (!row) return;
    row.querySelector('[data-field="type"]').value = item.type;
  });

  overlay.querySelector('#saveBatchEdit').onclick = () => {
    const nextDate = String(dateInput.value || '').trim();
    if (!isValidDateKey(nextDate)) {
      dateError.style.display = 'block';
      dateInput.focus();
      return;
    }
    dateError.style.display = 'none';

    const items = [...overlay.querySelectorAll('.edit-item-row')].map((row) => ({
      type: row.querySelector('[data-field="type"]').value,
      amount: Number(row.querySelector('[data-field="amount"]').value || 0),
    }));

    if (!items.length || items.some((item) => !ALCOHOL_UNITS[item.type] || item.amount <= 0)) {
      itemsError.style.display = 'block';
      return;
    }
    itemsError.style.display = 'none';

    onSubmit({
      dateKey: nextDate,
      emoji: String(emojiInput.value || '🙂').trim() || '🙂',
      memo: String(memoInput.value || '').trim(),
      items,
    });
    closeModal();
  };

  document.body.appendChild(overlay);
  dateInput.focus();
}

function renderHistoryList(container) {
  const baseType = state.goalBaseType;
  const baseInfo = ALCOHOL_UNITS[baseType];

  // Group by timestamp date
  const dateGroups = new Map();
  state.logs.forEach((log) => {
    const dateKey = formatDateKey(new Date(log.timestamp));
    if (!dateGroups.has(dateKey)) {
      dateGroups.set(dateKey, []);
    }
    dateGroups.get(dateKey).push(log);
  });

  const sortedDates = [...dateGroups.keys()].sort((a, b) => b.localeCompare(a));

  if (!sortedDates.length) {
    container.innerHTML = `<p class="empty">기록이 없습니다.</p>`;
    return;
  }

  let html = '';
  sortedDates.forEach((dateKey) => {
    const logs = dateGroups.get(dateKey);
    // Within date, group by batch
    const batches = new Map();
    logs.forEach((log) => {
      const bKey = log.batchId || `legacy-${log.id}`;
      if (!batches.has(bKey)) {
        batches.set(bKey, { key: bKey, emoji: log.emoji, memo: log.memo, createdAt: log.createdAt, timestamp: log.timestamp, items: [] });
      }
      batches.get(bKey).items.push(log);
    });

    const sortedBatches = [...batches.values()].sort((a, b) => new Date(b.createdAt || b.timestamp) - new Date(a.createdAt || a.timestamp));

    const dateDisplay = new Date(dateKey).toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' });

    html += `
      <div class="history-date-group">
        ${sortedBatches.map((g, idx) => {
          const itemLines = g.items.map(l => {
            const info = ALCOHOL_UNITS[l.type];
            const converted = fromSojuUnits(toSojuUnits(l.amount, l.type), baseType);
            return `<div class="small">• ${info.name} ${l.amount}${getUnitLabel(l.type)} (환산 ${baseInfo.name} ${converted.toFixed(2)}${getUnitLabel(baseType)})</div>`;
          }).join('');

          const isFirstInDate = idx === 0;
          return `
            <div class="list-item ${!isFirstInDate ? 'list-item-nested' : ''}">
              <div class="history-row">
                <div class="history-main">
                  ${isFirstInDate ? `<div><strong>${g.emoji || '🙂'} ${dateDisplay} 기록</strong></div>` : ''}
                  <div class="small">등록시각: ${new Date(g.createdAt || g.timestamp).toLocaleString('ko-KR')}</div>
                  ${g.memo ? `<div class="small">메모: ${g.memo}</div>` : ''}
                  <div style="margin-top:6px">${itemLines}</div>
                </div>
                <div class="history-actions">
                  <button class="ghost btn-sm" data-group-edit="${g.key}">편집</button>
                  <button class="danger btn-sm" data-group-del="${g.key}">삭제</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('button[data-group-edit]').forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.groupEdit;
      const log = state.logs.find(l => (l.batchId || `legacy-${l.id}`) === key);
      if (!log) return;

      const groupLogs = state.logs.filter(l => (l.batchId || `legacy-${l.id}`) === key);

      openBatchEditModal(
        {
          dateKey: formatDateKey(new Date(log.timestamp)),
          emoji: log.emoji || '🙂',
          memo: log.memo || '',
          items: groupLogs.map(item => ({ id: item.id, type: item.type, amount: item.amount })),
        },
        ({ dateKey, emoji, memo, items }) => {
          const nextTs = toNoonIsoFromDateKey(dateKey);
          groupLogs.forEach((entry, idx) => {
            const nextItem = items[idx];
            if (!nextItem) return;
            entry.timestamp = nextTs;
            entry.emoji = emoji;
            entry.memo = memo;
            entry.type = nextItem.type;
            entry.amount = nextItem.amount;
          });
          saveState();
          render();
        },
      );
    };
  });

  container.querySelectorAll('button[data-group-del]').forEach(btn => {
    btn.onclick = () => {
      if (!confirm('삭제하시겠습니까?')) return;
      const key = btn.dataset.groupDel;
      state.logs = state.logs.filter(l => (l.batchId || `legacy-${l.id}`) !== key);
      saveState();
      render();
    };
  });
}

function renderHistoryCalendar(container) {
  const baseType = state.goalBaseType;
  const baseInfo = ALCOHOL_UNITS[baseType];

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const prevLastDate = new Date(year, month, 0).getDate();
  const monthName = `${year}년 ${month + 1}월`;

  const dayStats = new Map();
  state.logs.forEach(l => {
    const key = formatDateKey(new Date(l.timestamp));
    dayStats.set(key, (dayStats.get(key) || 0) + toSojuUnits(l.amount, l.type));
  });

  let calendarHtml = '';
  for (let i = firstDay; i > 0; i--) {
    calendarHtml += `<div class="cal-day pad">${prevLastDate - i + 1}</div>`;
  }
  for (let d = 1; d <= lastDate; d++) {
    const date = new Date(year, month, d);
    const key = formatDateKey(date);
    const soju = dayStats.get(key) || 0;
    let level = 0;
    if (soju > 0) {
      if (soju < 0.5) level = 1;
      else if (soju < 1.5) level = 2;
      else if (soju < 3.0) level = 3;
      else level = 4;
    }
    calendarHtml += `
      <div class="cal-day current ${level ? 'has-data level-'+level : ''}" data-cal-key="${key}" role="button" tabindex="0" aria-label="${key} 기록 보기">
        <span class="cal-date-num">${d}</span>
        ${soju > 0 ? `<span class="cal-dot"></span>` : ''}
      </div>
    `;
  }

  container.innerHTML = `
    <div class="cal-header">
      <button class="ghost btn-sm" id="calPrev">&lt;</button>
      <h2 class="cal-title">${monthName}</h2>
      <button class="ghost btn-sm" id="calNext">&gt;</button>
    </div>
    <div class="cal-weekdays">
      <div>일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div>토</div>
    </div>
    <div class="cal-grid">${calendarHtml}</div>
  `;

  document.getElementById('calPrev').onclick = (e) => {
    e.stopPropagation();
    calendarDate = new Date(year, month - 1, 1);
    renderHistory();
  };
  document.getElementById('calNext').onclick = (e) => {
    e.stopPropagation();
    calendarDate = new Date(year, month + 1, 1);
    renderHistory();
  };

  const popup = document.getElementById('historyPopup');
  const popupList = document.getElementById('popupList');
  const popupDateTitle = document.getElementById('popupDateTitle');

  const openDayPopup = (key) => {
      const dayLogs = state.logs.filter(l => formatDateKey(new Date(l.timestamp)) === key);
      popupDateTitle.textContent = `${key} 기록`;
      
      if (dayLogs.length === 0) {
        popupList.innerHTML = `<p class="empty">기록이 없습니다.</p>`;
      } else {
        const groups = new Map();
        dayLogs.forEach(log => {
          const bKey = log.batchId || `legacy-${log.id}`;
          if (!groups.has(bKey)) groups.set(bKey, { key: bKey, emoji: log.emoji, memo: log.memo, items: [] });
          groups.get(bKey).items.push(log);
        });

        popupList.innerHTML = [...groups.values()].map(g => `
          <div class="list-item">
            <div class="history-row">
              <div class="history-main">
                <strong>${g.emoji || '🙂'} 기록</strong>
                ${g.memo ? `<div class="small italic">${g.memo}</div>` : ''}
                <div class="history-lines">
                  ${g.items.map(l => `<div class="small">• ${ALCOHOL_UNITS[l.type]?.name} ${l.amount}${getUnitLabel(l.type)}</div>`).join('')}
                </div>
              </div>
              <div class="history-actions">
                <button class="ghost btn-sm" data-popup-edit="${g.key}">편집</button>
                <button class="danger btn-sm" data-popup-del="${g.key}">삭제</button>
              </div>
            </div>
          </div>
        `).join('');

        popupList.querySelectorAll('button[data-popup-edit]').forEach(btn => {
          btn.onclick = () => {
            const bKey = btn.dataset.popupEdit;
            const groupLogs = state.logs.filter(l => (l.batchId || `legacy-${l.id}`) === bKey);
            const firstLog = groupLogs[0];
            if (!firstLog) return;

            openBatchEditModal(
              {
                dateKey: formatDateKey(new Date(firstLog.timestamp)),
                emoji: firstLog.emoji || '🙂',
                memo: firstLog.memo || '',
                items: groupLogs.map(item => ({ id: item.id, type: item.type, amount: item.amount })),
              },
              ({ dateKey, emoji, memo, items }) => {
                const nextTs = toNoonIsoFromDateKey(dateKey);
                groupLogs.forEach((entry, idx) => {
                  const nextItem = items[idx];
                  if (!nextItem) return;
                  entry.timestamp = nextTs;
                  entry.emoji = emoji;
                  entry.memo = memo;
                  entry.type = nextItem.type;
                  entry.amount = nextItem.amount;
                });
                saveState();
                renderHistory();
                requestAnimationFrame(() => openDayPopup(dateKey));
              },
            );
          };
        });

        popupList.querySelectorAll('button[data-popup-del]').forEach(btn => {
          btn.onclick = () => {
            const bKey = btn.dataset.popupDel;
            state.logs = state.logs.filter(l => (l.batchId || `legacy-${l.id}`) !== bKey);
            saveState();
            render();
          };
        });
      }
      popup.style.display = 'flex';
  };

  container.querySelectorAll('.cal-day.current').forEach(el => {
    el.onclick = () => openDayPopup(el.dataset.calKey);
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDayPopup(el.dataset.calKey);
      }
    };
  });

  document.getElementById('closePopup').onclick = () => { popup.style.display = 'none'; };
  popup.onclick = (e) => { if (e.target === popup) popup.style.display = 'none'; };
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
      <div class="stats-dual">
        <div class="list-item">
          <div class="small">최근 7일</div>
          <div class="big" style="font-size:26px">${fromSojuUnits(total7Soju, baseType).toFixed(2)}</div>
          <div class="small">${baseInfo.name} 기준</div>
        </div>
        <div class="list-item">
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
  const enabledEntries = Object.entries(ALCOHOL_UNITS).filter(([k]) => isTypeEnabled(k));
  if (!enabledEntries.find(([k]) => k === state.goalBaseType)) {
    state.goalBaseType = enabledEntries[0]?.[0] || 'SOJU';
  }

  const typeOptions = enabledEntries
    .map(([k, v]) => `<option value="${k}" ${state.goalBaseType === k ? 'selected' : ''}>${v.name} (${v.baseAmount})</option>`)
    .join('');

  const goalInBase = fromSojuUnits(state.weeklyGoal, state.goalBaseType);

  const typeToggleButtons = Object.entries(ALCOHOL_UNITS)
    .map(([k, v]) => `
      <button class="${isTypeEnabled(k) ? 'primary' : 'ghost'}" data-type-toggle="${k}">${v.name} ${isTypeEnabled(k) ? 'ON' : 'OFF'}</button>
    `)
    .join('');

  view.innerHTML = `
    <section class="card">
      <h2 class="title">👑 프리미엄 혜택</h2>
      ${state.isPremium
        ? `
          <p class="sub">프리미엄 구독 중입니다. (광고 제거)</p>
          <div class="row" style="margin-top:10px;">
            <button class="ghost" id="cancelPremium">[테스트] 프리미엄 해제</button>
          </div>
        `
        : `
          <p class="sub">광고를 제거하고 절주에만 집중하세요!</p>
          <div class="row" style="margin-top:10px;">
            <button class="primary" id="buyPremium">광고 제거 및 업그레이드</button>
          </div>
        `}
    </section>

    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h2 class="title" style="margin:0;">설정</h2>
        <button class="primary" id="saveSettings">저장</button>
      </div>
      <p class="sub">기준 주종과 주간 목표를 변경할 수 있어요.</p>

      <label>기준 주종</label>
      <select id="settingsBaseType">${typeOptions}</select>

      <label id="settingsGoalLabel">주간 목표 (${getUnitLabel(state.goalBaseType)} 단위)</label>
      <input id="settingsGoal" type="number" step="0.5" min="0.5" value="${goalInBase.toFixed(1)}" />

      <label style="margin-top:14px;">주종 ON/OFF</label>
      <div class="row" id="typeToggleRow">${typeToggleButtons}</div>
    </section>

    <section class="card">
      <h2 class="title">앱 설정</h2>
      <div class="row">
        <button class="ghost" id="cycleTheme">테마 ${state.themeMode}</button>
      </div>
    </section>
  `;

  document.getElementById('cycleTheme').onclick = cycleThemeMode;

  const buyBtn = document.getElementById('buyPremium');
  if (buyBtn) {
    buyBtn.onclick = () => {
      state.isPremium = true;
      saveState();
      render();
      showToast('프리미엄 회원이 되신 것을 환영합니다! 👑');
    };
  }

  const cancelBtn = document.getElementById('cancelPremium');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      state.isPremium = false;
      saveState();
      render();
      showToast('프리미엄이 해제되었습니다. (테스트용)');
    };
  }

  const settingsBaseTypeEl = document.getElementById('settingsBaseType');
  const settingsGoalEl = document.getElementById('settingsGoal');
  const settingsGoalLabelEl = document.getElementById('settingsGoalLabel');

  settingsBaseTypeEl.onchange = () => {
    const newType = settingsBaseTypeEl.value;
    settingsGoalEl.value = fromSojuUnits(state.weeklyGoal, newType).toFixed(1);
    settingsGoalLabelEl.textContent = `주간 목표 (${getUnitLabel(newType)} 단위)`;
  };

  document.querySelectorAll('button[data-type-toggle]').forEach((btn) => {
    btn.onclick = () => {
      const t = btn.dataset.typeToggle;
      const enabledCount = Object.keys(ALCOHOL_UNITS).filter((key) => isTypeEnabled(key)).length;
      if (enabledCount <= 1 && isTypeEnabled(t)) {
        showToast('최소 1개 주종은 활성 상태여야 해요.');
        return;
      }

      state.disabledTypes[t] = isTypeEnabled(t);
      saveState();
      render();
    };
  });

  document.getElementById('saveSettings').onclick = () => {
    const baseType = settingsBaseTypeEl.value;
    const goalInSelected = Math.max(0.5, Number(settingsGoalEl.value || 3));

    state.goalBaseType = baseType;
    state.weeklyGoal = toSojuUnits(goalInSelected, baseType);

    saveState();
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
