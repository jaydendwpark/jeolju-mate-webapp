const STORE_KEY = 'jeolju-mate-webapp-v3';

const ALCOHOL_UNITS = {
  SOJU: { name: '소주', unit: 1.0, baseAmount: '1병(360ml)' },
  BEER: { name: '맥주', unit: 0.6, baseAmount: '500ml' },
  CHEONGHA: { name: '청하', unit: 0.4, baseAmount: '1병(300ml)' },
  MAEHWASU: { name: '매화수', unit: 0.5, baseAmount: '1병(300ml)' },
  WINE: { name: '와인', unit: 0.3, baseAmount: '1잔(150ml)' },
  MAKKOLI: { name: '막걸리', unit: 0.4, baseAmount: '1병(750ml)' },
  WHISKEY: { name: '위스키', unit: 0.2, baseAmount: '1잔(30ml)' },
};

const state = loadState();
let tab = 'home';

const view = document.getElementById('view');
const nav = document.getElementById('nav');

function loadState() {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) return JSON.parse(raw);
  return {
    weeklyGoal: 3.0,
    goalBaseType: 'SOJU',
    logs: [],
    isOnboarded: false,
    draftType: 'SOJU',
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
function buildAlcoholConversionList(baseType) {
  const baseName = ALCOHOL_UNITS[baseType].name;
  return Object.entries(ALCOHOL_UNITS)
    .map(([k, v]) => {
      const converted = fromSojuUnits(v.unit, baseType);
      const baseUnitLabel = baseName === '와인' || baseName === '위스키' ? '잔' : '병';
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
  else renderSettings();
}

function renderNav() {
  nav.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.onclick = () => {
      tab = b.dataset.tab;
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

      <label>주간 목표 (기준 주종 단위)</label>
      <input id="goalInput" type="number" step="0.5" min="0.5" value="${defaultGoalInSelected.toFixed(1)}" />

      <div class="row" style="margin-top:12px">
        <button class="ghost" id="minus">-0.5</button>
        <button class="ghost" id="plus">+0.5</button>
        <button class="primary" id="start">시작하기</button>
      </div>
    </section>
  `;

  const goalInput = document.getElementById('goalInput');
  const baseTypeEl = document.getElementById('goalBaseType');

  baseTypeEl.onchange = () => {
    const newType = baseTypeEl.value;
    const currentSojuGoal = state.weeklyGoal;
    goalInput.value = fromSojuUnits(currentSojuGoal, newType).toFixed(1);
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

  const baseUnitLabel = baseInfo.name === '와인' || baseInfo.name === '위스키' ? '잔' : '병';

  const quickButtons = [
    { label: '소주 반병', type: 'SOJU', amount: 0.5 },
    { label: '맥주 한캔', type: 'BEER', amount: 1 },
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
        <div class="list-item" style="margin-bottom:6px;">
          <div><strong>${info.name}</strong> · ${Number(v).toFixed(1)}배</div>
          <div class="small">환산: ${converted.toFixed(2)}${baseUnitLabel} (${baseInfo.name} 기준)</div>
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
    </section>

    <section class="card">
      <h2 class="title">주간 진행률</h2>
      <p class="sub">${rolling.toFixed(1)} / ${weeklyGoal.toFixed(1)} (${baseInfo.name} 기준)</p>
      <div class="progress-wrap"><div class="progress" style="width:${progress}%"></div></div>
    </section>

    <section class="card">
      <h2 class="title">월 누적</h2>
      <div class="big" style="font-size:28px">${baseInfo.name} ${month.toFixed(1)}${baseUnitLabel} (${formatBaseAmount(baseInfo.baseAmount)})</div>
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
      <p class="sub">선택된 날짜: <strong>${state.draftDate}</strong></p>
      <input id="dateInput" type="date" style="display:none;" />

      ${addedLines ? `<div style="margin-top:10px">${addedLines}</div>` : `<p class="empty" style="margin:10px 0 0">아직 추가된 음주가 없어요.</p>`}

      <label style="margin-top:14px">음주 추가</label>
      <div class="row" id="quickAddButtons">
        ${quickButtons.map((b)=>`<button class="ghost" data-add-type="${b.type}" data-add-amount="${b.amount}">${b.label}</button>`).join('')}
      </div>

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
    saveState();
    render();
  };

  document.getElementById('registerLog').onclick = () => {
    const entries = Object.entries(state.draftTotals || {}).filter(([, v]) => Number(v) > 0);
    if (!entries.length) return alert('추가된 음주가 없습니다.');

    // timestamp: selected date at 12:00 local time (avoid timezone surprises)
    const [y, m, d] = state.draftDate.split('-').map(Number);
    const ts = new Date(y, (m - 1), d, 12, 0, 0, 0).toISOString();

    entries.forEach(([t, v]) => {
      state.logs.push({
        id: String(Date.now()) + '-' + t,
        type: t,
        amount: Number(v),
        timestamp: ts,
      });
    });

    state.draftTotals = {};
    saveState();
    tab = 'history';
    render();
  };
}


function renderHistory() {
  const sorted = [...state.logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (!sorted.length) {
    view.innerHTML = `<section class="card"><p class="empty">기록이 없습니다.</p></section>`;
    return;
  }

  const baseType = state.goalBaseType;
  const baseInfo = ALCOHOL_UNITS[baseType];

  view.innerHTML = `
    <section class="card">
      <h2 class="title">기록 히스토리</h2>
      <p class="sub">환산 단위는 ${baseInfo.name} 기준으로 표시됩니다.</p>
      <div id="list"></div>
    </section>
  `;

  const list = document.getElementById('list');

  sorted.forEach((l) => {
    const info = ALCOHOL_UNITS[l.type];
    const sojuUnits = toSojuUnits(l.amount, l.type);
    const converted = fromSojuUnits(sojuUnits, baseType);

    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div><strong>${info.name}</strong> · ${l.amount}배</div>
      <div class="small">${new Date(l.timestamp).toLocaleString('ko-KR')}</div>
      <div class="small">환산: ${converted.toFixed(1)} ${baseInfo.name} 기준</div>
      <div style="margin-top:8px"><button class="danger" data-id="${l.id}">삭제</button></div>
    `;
    list.appendChild(el);
  });

  list.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      state.logs = state.logs.filter((l) => l.id !== id);
      saveState();
      render();
    };
  });
}


function renderSettings() {
  const typeOptions = Object.entries(ALCOHOL_UNITS)
    .map(([k, v]) => `<option value="${k}" ${state.goalBaseType === k ? 'selected' : ''}>${v.name} (${v.baseAmount})</option>`)
    .join('');

  const goalInBase = fromSojuUnits(state.weeklyGoal, state.goalBaseType);

  view.innerHTML = `
    <section class="card">
      <h2 class="title">설정</h2>
      <p class="sub">기준 주종과 주간 목표를 변경할 수 있어요.</p>

      <label>기준 주종</label>
      <select id="settingsBaseType">${typeOptions}</select>

      <label>주간 목표 (기준 주종 단위)</label>
      <input id="settingsGoal" type="number" step="0.5" min="0.5" value="${goalInBase.toFixed(1)}" />

      <div class="row" style="margin-top:12px">
        <button class="primary" id="saveSettings">저장</button>
      </div>
    </section>
  `;

  document.getElementById('saveSettings').onclick = () => {
    const baseType = document.getElementById('settingsBaseType').value;
    const goalInSelected = Math.max(0.5, Number(document.getElementById('settingsGoal').value || 3));

    state.goalBaseType = baseType;
    state.weeklyGoal = toSojuUnits(goalInSelected, baseType);

    saveState();
    tab = 'home';
    render();
  };
}

render();