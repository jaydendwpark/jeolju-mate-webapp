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
  else renderHistory();
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

  const alcoholButtons = Object.entries(ALCOHOL_UNITS)
    .map(([k, v]) => `<button class="alcohol-btn ${state.draftType === k ? 'active' : ''}" data-type="${k}">${v.name}</button>`)
    .join('');

  view.innerHTML = `
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h2 class="title" style="margin:0">오늘 마실 수 있는 양</h2>
        <button class="ghost" id="goSettings">설정</button>
      </div>
      <div class="big">${todayLimit.toFixed(1)} ${baseInfo.name} 기준</div>
      <p class="sub">기준 주종: ${baseInfo.name} (${baseInfo.baseAmount})</p>
      <p class="sub">계산식: 주간 목표 - (최근7일 누적 - 오늘 섭취)</p>
    </section>

    <section class="card">
      <h2 class="title">주간 진행률</h2>
      <p class="sub">${rolling.toFixed(1)} / ${weeklyGoal.toFixed(1)} (${baseInfo.name} 기준)</p>
      <div class="progress-wrap"><div class="progress" style="width:${progress}%"></div></div>
    </section>

    <section class="card">
      <h2 class="title">월 누적</h2>
      <div class="big" style="font-size:28px">${month.toFixed(1)} ${baseInfo.name} 기준</div>
    </section>

    <section class="card">
      <h2 class="title">음주 기록 추가</h2>
      <label>술 종류 선택</label>
      <div class="row" id="alcoholButtons">${alcoholButtons}</div>
      <p class="sub" id="selectedAlcoholText" style="margin-top:8px">선택: ${ALCOHOL_UNITS[state.draftType].name}</p>

      <label>양 (배수)</label>
      <input id="amountInput" type="number" min="0.1" step="0.1" value="1" />

      <div class="row" style="margin-top:12px">
        <button class="primary" id="registerLog">등록</button>
      </div>
    </section>
  `;

  document.getElementById('goSettings').onclick = () => {
    state.isOnboarded = false;
    saveState();
    render();
  };

  document.querySelectorAll('.alcohol-btn').forEach((btn) => {
    btn.onclick = () => {
      state.draftType = btn.dataset.type;
      saveState();
      render();
    };
  });

  document.getElementById('registerLog').onclick = () => {
    const amount = Number(document.getElementById('amountInput').value);
    if (!amount || amount <= 0) return alert('양을 올바르게 입력해 주세요.');

    state.logs.push({
      id: String(Date.now()),
      type: state.draftType,
      amount,
      timestamp: new Date().toISOString(),
    });

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

render();