const STORAGE_KEY = 'parking_webapp_car_list_v1';
const PLATE_REGEX = /[京津沪渝冀豫云辽黑湘皖鲁苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-Z0-9]{5}/g;
const MARK_OPTIONS = ['6', '6.5', '7', '7.5'];

const state = {
  carList: [],
  detectedPlates: [],
  loading: false,
  alignTimer: null,
  refreshTimer: null,
  deferredInstallPrompt: null,
  activeTool: 'single',
  expandedMarkIndex: null
};

const el = {
  activeCount: document.getElementById('activeCount'),
  processedCount: document.getElementById('processedCount'),
  totalFee: document.getElementById('totalFee'),
  singlePlateInput: document.getElementById('singlePlateInput'),
  singleToolBtn: document.getElementById('singleToolBtn'),
  batchToolBtn: document.getElementById('batchToolBtn'),
  singlePanel: document.getElementById('singlePanel'),
  batchPanel: document.getElementById('batchPanel'),
  batchText: document.getElementById('batchText'),
  detectedSummary: document.getElementById('detectedSummary'),
  detectedList: document.getElementById('detectedList'),
  cardList: document.getElementById('cardList'),
  emptyState: document.getElementById('emptyState'),
  toast: document.getElementById('toast'),
  statusText: document.getElementById('statusText'),
  installBtn: document.getElementById('installBtn'),
  singleQueryBtn: document.getElementById('singleQueryBtn'),
  batchQueryBtn: document.getElementById('batchQueryBtn'),
  detectBtn: document.getElementById('detectBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  clearBtn: document.getElementById('clearBtn')
};

function setStatus(text) {
  el.statusText.textContent = text;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.toast.classList.remove('show'), 1800);
}

function updateInstallButton() {
  const visible = Boolean(state.deferredInstallPrompt);
  el.installBtn.hidden = !visible;
}

function updateToolPanels() {
  const isSingle = state.activeTool === 'single';
  el.singleToolBtn.classList.toggle('tool-tab-active', isSingle);
  el.batchToolBtn.classList.toggle('tool-tab-active', !isSingle);
  el.singlePanel.classList.toggle('panel-hidden-mobile', !isSingle);
  el.batchPanel.classList.toggle('panel-hidden-mobile', isSingle);
}

function loadLocalData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.carList = raw ? JSON.parse(raw) : [];
  } catch {
    state.carList = [];
  }
}

function saveLocalData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.carList));
}

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatEntryDisplay(value = '') {
  const text = String(value || '').trim();
  if (!text) return '-';
  return text.replace(/^(\d{4})-(\d{2})-(\d{2})/, '$1.$2.$3');
}

function normalizeCar(raw = {}, oldCar = {}) {
  const todayHours = normalizeNumber(raw.today_hours ?? raw.todayHours ?? oldCar.todayHours, 0);
  const totalHours = normalizeNumber(raw.total_hours ?? raw.totalHours ?? oldCar.totalHours, 0);
  const needPay = normalizeNumber(raw.need_pay ?? raw.needPay ?? oldCar.needPay, 0);
  return {
    plate: String(raw.plate || oldCar.plate || '').trim().toUpperCase(),
    status: raw.status || oldCar.status || 'not_found',
    owner: raw.owner ?? oldCar.owner ?? '',
    entry: raw.entry ?? oldCar.entry ?? '',
    todayHours,
    todayHoursFixed: todayHours.toFixed(1),
    totalHours,
    needPay,
    marked: oldCar.marked ?? false,
    markTime: oldCar.markTime ?? null,
    isProcessed: oldCar.isProcessed ?? false
  };
}

function mergeCars(oldList = [], latestList = []) {
  const latestMap = new Map(latestList.map(item => [String(item.plate).toUpperCase(), item]));
  return oldList.map(oldCar => {
    const latest = latestMap.get(String(oldCar.plate).toUpperCase());
    return latest ? normalizeCar(latest, oldCar) : oldCar;
  });
}

function updateStats() {
  const active = state.carList.filter(c => c.status === 'success').length;
  const processed = state.carList.filter(c => c.isProcessed).length;
  const totalFee = state.carList.reduce((sum, item) => sum + normalizeNumber(item.needPay, 0), 0);
  el.activeCount.textContent = String(active);
  el.processedCount.textContent = String(processed);
  el.totalFee.textContent = String(totalFee);
}

function extractPlates(text = '') {
  const matches = String(text).toUpperCase().match(PLATE_REGEX) || [];
  return [...new Set(matches)];
}

function renderDetectedPlates() {
  el.detectedSummary.textContent = `${state.detectedPlates.length} 个车牌`;
  el.detectedList.innerHTML = state.detectedPlates
    .map(plate => `<span class="tag">${plate}</span>`)
    .join('');
}

function renderCards() {
  if (state.carList.length === 0) {
    el.emptyState.style.display = 'block';
    el.cardList.innerHTML = '';
    return;
  }

  el.emptyState.style.display = 'none';
  el.cardList.innerHTML = state.carList.map((item, index) => {
    const isSuccess = item.status === 'success';
    const badgeText = isSuccess ? '在场' : '未在场';
    const markText = item.isProcessed ? '已处理' : item.marked ? `已标记 ${item.markTime}h` : '标记时间';
    const ownerText = item.owner || '-';
    const ownerDisplay = ownerText === '-' ? '-' : ownerText.toUpperCase();
    const entryText = formatEntryDisplay(item.entry);
    const markExpanded = state.expandedMarkIndex === index;
    const markOptions = isSuccess && markExpanded ? `
      <div class="mark-option-sheet">
        <div class="mark-option-row">
        ${MARK_OPTIONS.map(option => `
          <button
            class="mark-option-btn ${item.markTime === option && item.marked ? 'mark-option-active' : ''}"
            data-action="select-mark"
            data-index="${index}"
            data-value="${option}"
          >${option}h</button>
        `).join('')}
        <button class="mark-clear-btn" data-action="clear-mark" data-index="${index}">取消</button>
      </div>
      </div>
    ` : '';
    return `
      <article class="result-card ${item.isProcessed ? 'result-card-processed' : ''}">
        <div class="result-layout">
          <div class="status-pill ${isSuccess ? 'status-pill-success' : 'status-pill-muted'}">${badgeText}</div>
          <div class="result-info-panel">
            <div class="result-topline">
              <div class="plate">${item.plate}</div>
              ${item.marked && !item.isProcessed ? `<span class="inline-flag">标记 ${item.markTime}h</span>` : ''}
            </div>
            <div class="result-info-row">
              <div class="info-col">
                <div class="info-col-label">车主</div>
                <div class="info-col-value">${ownerDisplay}</div>
              </div>
              <div class="info-col info-col-entry">
                <div class="info-col-label">入场时间</div>
                <div class="info-col-value">${entryText}</div>
              </div>
              <div class="info-col info-col-hours">
                <div class="info-col-label">今日已停</div>
                <div class="info-col-value">${item.todayHoursFixed || '0.0'}h</div>
              </div>
            </div>
          </div>
          <div class="fee-panel ${isSuccess ? 'fee-panel-success' : 'fee-panel-muted'}">
            <div class="fee-label">欠费</div>
            <div class="fee-value">¥${item.needPay || 0}</div>
          </div>
        </div>
        <div class="actions-row">
          <button class="small-btn mark-btn ${markExpanded ? 'mark-btn-active' : ''}" data-action="mark" data-index="${index}">${markText}</button>
          <button class="small-btn done-btn" data-action="done" data-index="${index}">${item.isProcessed ? '取消已处理' : '标记已处理'}</button>
          <button class="small-btn danger-btn" data-action="delete" data-index="${index}">删除</button>
        </div>
        ${markOptions}
      </article>`;
  }).join('');
}

function render() {
  updateStats();
  renderDetectedPlates();
  renderCards();
}

async function apiRequest(path, data) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  });
  const payload = await resp.json();
  if (!resp.ok || !payload.success) {
    throw new Error(payload.message || `请求失败 (${resp.status})`);
  }
  return payload.data;
}

async function querySinglePlate() {
  const plate = el.singlePlateInput.value.trim().toUpperCase();
  if (!plate) {
    showToast('请输入车牌号');
    return;
  }
  setStatus(`正在查询 ${plate}...`);
  try {
    const result = await apiRequest('/api/query', { plate });
    const newCar = normalizeCar(result, { plate });
    state.carList = [newCar, ...state.carList.filter(item => item.plate !== newCar.plate)];
    saveLocalData();
    render();
    el.singlePlateInput.value = '';
    showToast('查询成功');
    setStatus('查询完成');
  } catch (error) {
    console.error(error);
    showToast(error.message || '查询失败');
    setStatus('查询失败');
  }
}

async function batchQuery() {
  const batchText = el.batchText.value;
  const plates = state.detectedPlates.length > 0 ? state.detectedPlates : extractPlates(batchText);
  if (plates.length === 0) {
    showToast('未识别到车牌号');
    return;
  }
  const existing = new Set(state.carList.map(item => item.plate));
  const newPlates = plates.filter(plate => !existing.has(plate));
  if (newPlates.length === 0) {
    showToast('所有车牌已存在');
    return;
  }

  setStatus(`正在批量查询 ${newPlates.length} 个车牌...`);
  try {
    const result = await apiRequest('/api/batch-query', { plates: newPlates });
    const newCars = result.map(item => normalizeCar(item));
    state.carList = [...newCars, ...state.carList];
    state.detectedPlates = [];
    el.batchText.value = '';
    saveLocalData();
    render();
    const activeCount = newCars.filter(item => item.status === 'success').length;
    showToast(`成功 ${activeCount}/${newPlates.length}`);
    setStatus('批量查询完成');
  } catch (error) {
    console.error(error);
    showToast(error.message || '批量查询失败');
    setStatus('批量查询失败');
  }
}

async function refreshActiveCars() {
  const activePlates = state.carList.filter(item => item.status === 'success').map(item => item.plate);
  if (activePlates.length === 0) {
    showToast('当前没有在场车辆');
    return;
  }
  setStatus(`正在刷新 ${activePlates.length} 个在场车辆...`);
  try {
    const result = await apiRequest('/api/batch-query', { plates: activePlates });
    state.carList = mergeCars(state.carList, result);
    saveLocalData();
    render();
    showToast('刷新完成');
    setStatus('刷新完成');
  } catch (error) {
    console.error(error);
    showToast(error.message || '刷新失败');
    setStatus('刷新失败');
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  const delay = nextHour.getTime() - now.getTime();

  state.alignTimer = setTimeout(() => {
    refreshActiveCars();
    state.refreshTimer = setInterval(refreshActiveCars, 60 * 60 * 1000);
    state.alignTimer = null;
  }, delay);
}

function stopAutoRefresh() {
  if (state.alignTimer) {
    clearTimeout(state.alignTimer);
    state.alignTimer = null;
  }
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function clearList() {
  if (!window.confirm('确定要清空所有记录吗？')) return;
  state.carList = [];
  saveLocalData();
  render();
  showToast('已清空');
}

function promptMark(index) {
  const current = state.carList[index];
  if (!current) return;
  if (current.status !== 'success') {
    showToast('仅在场车辆可标记处理时间');
    return;
  }
  state.expandedMarkIndex = state.expandedMarkIndex === index ? null : index;
  render();
}

function selectMark(index, value) {
  const current = state.carList[index];
  if (!current) return;
  current.marked = true;
  current.markTime = value;
  state.carList[index] = current;
  state.expandedMarkIndex = null;
  saveLocalData();
  render();
}

function clearMark(index) {
  const current = state.carList[index];
  if (!current) return;
  current.marked = false;
  current.markTime = null;
  state.carList[index] = current;
  state.expandedMarkIndex = null;
  saveLocalData();
  render();
}

function toggleProcessed(index) {
  const current = state.carList[index];
  if (!current) return;
  current.isProcessed = !current.isProcessed;
  state.carList[index] = current;
  state.expandedMarkIndex = null;
  saveLocalData();
  render();
}

function deleteItem(index) {
  state.carList.splice(index, 1);
  if (state.expandedMarkIndex === index) {
    state.expandedMarkIndex = null;
  }
  saveLocalData();
  render();
}

function bindEvents() {
  el.installBtn.addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    const choice = await state.deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      showToast('已发起安装');
    }
    state.deferredInstallPrompt = null;
    updateInstallButton();
  });
  el.singleToolBtn.addEventListener('click', () => {
    state.activeTool = 'single';
    updateToolPanels();
  });
  el.batchToolBtn.addEventListener('click', () => {
    state.activeTool = 'batch';
    updateToolPanels();
  });
  el.detectBtn.addEventListener('click', () => {
    state.detectedPlates = extractPlates(el.batchText.value);
    renderDetectedPlates();
    if (state.detectedPlates.length === 0) {
      showToast('未识别到车牌号');
    }
  });

  el.batchText.addEventListener('input', () => {
    state.detectedPlates = extractPlates(el.batchText.value);
    renderDetectedPlates();
  });

  el.singleQueryBtn.addEventListener('click', querySinglePlate);
  el.batchQueryBtn.addEventListener('click', batchQuery);
  el.refreshBtn.addEventListener('click', refreshActiveCars);
  el.clearBtn.addEventListener('click', clearList);
  el.singlePlateInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') querySinglePlate();
  });

  el.cardList.addEventListener('click', event => {
    const target = event.target.closest('button[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index)) return;
    if (action === 'mark') promptMark(index);
    if (action === 'select-mark') selectMark(index, target.dataset.value || '');
    if (action === 'clear-mark') clearMark(index);
    if (action === 'done') toggleProcessed(index);
    if (action === 'delete') deleteItem(index);
  });

  window.addEventListener('beforeunload', stopAutoRefresh);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    updateInstallButton();
  });
  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    updateInstallButton();
    showToast('已安装到桌面');
  });
  window.addEventListener('online', () => setStatus('网络已恢复'));
  window.addEventListener('offline', () => setStatus('当前处于离线模式'));
}

async function boot() {
  loadLocalData();
  bindEvents();
  updateInstallButton();
  updateToolPanels();
  render();
  startAutoRefresh();
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      registration.update();
    } catch (error) {
      console.error('service worker register failed', error);
    }
  }
  try {
    const resp = await fetch('/api/health');
    const data = await resp.json();
    setStatus(`接口状态：${data.data?.status || 'ok'}`);
  } catch {
    setStatus('接口状态检查失败');
  }
}

boot();
