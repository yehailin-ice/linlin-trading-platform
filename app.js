const storeKey = "linlin-paper-account-v2";

const stockPool = [
  { code: "000063", name: "中兴通讯", theme: "通信设备/5G", price: 35.64, score: 88, confidence: "高", trigger: "回踩 35.1-35.5 不破分时均价，再放量上穿可观察", riskCheck: "主板；未封死涨停；价格低于150；需跟踪板块承接" },
  { code: "600498", name: "烽火通信", theme: "光通信/算力网络", price: 55.15, score: 84, confidence: "中高", trigger: "守住 54.5 附近承接，放量突破日内高点可观察", riskCheck: "主板；价格低于150；避免缩量冲高回落" },
  { code: "600176", name: "中国巨石", theme: "玻纤/顺周期材料", price: 39.07, score: 83, confidence: "中高", trigger: "放量站稳 39 附近且涨幅进入 3%-7% 承接区间，再小仓观察", riskCheck: "主板；价格低于150；未封死涨停；需看玻纤/建材方向持续性" },
  { code: "601138", name: "工业富联", theme: "算力服务器", price: 27.6, score: 82, confidence: "中高", trigger: "板块继续强，回踩 5 日线附近不破再考虑", riskCheck: "主板；价格低于150；大盘股需看成交额配合" },
  { code: "002463", name: "沪电股份", theme: "AI PCB", price: 42.2, score: 80, confidence: "中", trigger: "PCB 板块延续，分时回踩不破 VWAP 后再观察", riskCheck: "主板；价格低于150；高位趋势股注意放量滞涨" },
  { code: "603019", name: "中科曙光", theme: "算力国产化", price: 58.6, score: 78, confidence: "中", trigger: "站稳 58 附近且板块龙头不炸板，可轻仓观察", riskCheck: "主板；价格低于150；只做承接确认，不追封死涨停" },
];

const allowedMainBoard = /^(600|601|603|605|000|001|002|003)\d{3}$/;
const minBuyShares = 300;
const aiFallbackBuyShares = 100;
const maxHoldingCount = 5;
const maxTotalPositionPct = 60;
const buyChangeMinPct = 3;
const buyChangeMaxPct = 7;
const strongTrialChangeMinPct = 1;
const fixedStopLossPct = 5;
const fixedMoodThreshold = 45;
const feeConfig = {
  commissionRate: 0.00015,
  minCommission: 5,
  transferRate: 0.00001,
  handlingRate: 0.0000341,
  supervisionRate: 0.00002,
  stampDutyRate: 0.0005,
};

const defaultAccount = {
  version: 2,
  started: false,
  initialCash: 30000,
  cash: 30000,
  day: 1,
  date: "2026-05-22",
  maxPositionPct: 15,
  adaptiveBoost: 0,
  mood: 50,
  positions: [],
  trades: [],
  history: [{ day: 1, equity: 30000, positionPct: 0, mood: 50, ret: 0 }],
  comment: "设置初始资金后开始运行，系统会按信号记录买卖。",
  savedAt: "",
  importedBatches: [],
  quoteStatus: "等待刷新",
  moodDetail: null,
  marketInfo: null,
  afterCloseReport: null,
};

let account = loadAccount();
let latestCandidates = [];
const realtimeRefreshMs = 3000;
let realtimeRefreshing = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadAccount() {
  const databaseAccount = loadAccountFromDatabase();
  if (databaseAccount) return databaseAccount;
  try {
    const raw = localStorage.getItem(storeKey);
    return raw ? normalizeAccount(JSON.parse(raw)) : clone(defaultAccount);
  } catch {
    return clone(defaultAccount);
  }
}

function loadAccountFromDatabase() {
  try {
    const request = new XMLHttpRequest();
    request.open("GET", "/api/account", false);
    request.send();
    if (request.status < 200 || request.status >= 300) return null;
    const payload = JSON.parse(request.responseText || "{}");
    return payload.account ? normalizeAccount(payload.account) : null;
  } catch {
    return null;
  }
}

function normalizeAccount(saved) {
  const normalized = {
    ...clone(defaultAccount),
    ...saved,
    positions: Array.isArray(saved.positions) ? saved.positions : [],
    trades: Array.isArray(saved.trades) ? saved.trades : [],
    history: Array.isArray(saved.history) ? saved.history : clone(defaultAccount.history),
    importedBatches: Array.isArray(saved.importedBatches) ? saved.importedBatches : [],
    marketInfo: saved.marketInfo || null,
    afterCloseReport: saved.afterCloseReport || null,
  };
  normalized.positions.forEach((position) => {
    if (position.code === "603989" && position.quoteSource === "用户盘中反馈：涨停") {
      position.quoteSource = "等待实时行情覆盖";
      position.isLimitUp = false;
    }
  });
  return normalized;
}

function saveAccount() {
  account.savedAt = new Date().toISOString();
  localStorage.setItem(storeKey, JSON.stringify(account));
  persistAccountToDatabase(account);
}

function persistAccountToDatabase(nextAccount, backup = false) {
  fetch("/api/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: nextAccount, backup }),
    keepalive: true,
  }).catch(() => {
    // Browser cache remains a short-term fallback if the local database is temporarily unavailable.
  });
}

function money(value) {
  return Math.round(value).toLocaleString("zh-CN");
}

function yuan(value) {
  return Number(value || 0).toFixed(2);
}

function amountYi(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "--";
  return `${(number / 100000000).toFixed(1)}亿`;
}

function volumeWan(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "--";
  return `${(number / 10000).toFixed(1)}万手`;
}

function calcFees(gross, side) {
  const commission = Math.max(gross * feeConfig.commissionRate, feeConfig.minCommission);
  const transfer = gross * feeConfig.transferRate;
  const handling = gross * feeConfig.handlingRate;
  const supervision = gross * feeConfig.supervisionRate;
  const stampDuty = side === "SELL" ? gross * feeConfig.stampDutyRate : 0;
  const total = commission + transfer + handling + supervision + stampDuty;
  return {
    commission,
    transfer,
    handling,
    supervision,
    stampDuty,
    total,
  };
}

function pct(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateTextIncludesToday(value) {
  if (!value) return false;
  const today = todayIso();
  const normalized = String(value).replace(/[./]/g, "-");
  return normalized.includes(today);
}

function currentDateText(dateInput = new Date()) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  const formatted = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  return `${formatted} · ${week}`;
}

function syncAccountDateToToday() {
  const today = todayIso();
  if (account.date === today) return;
  account.date = today;
  const start = new Date("2026-05-20T00:00:00");
  const current = new Date(`${today}T00:00:00`);
  account.day = Math.max(1, Math.floor((current - start) / 86400000) + 1);
  saveAccount();
}

function savedAtText() {
  if (!account.savedAt) return "等待写入本机数据库";
  const date = new Date(account.savedAt);
  return `已写入本机数据库：${date.toLocaleString("zh-CN", { hour12: false })}`;
}

function getTradeSession(now = new Date()) {
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const isWeekday = day >= 1 && day <= 5;
  const morning = minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30;
  const afternoon = minutes >= 13 * 60 && minutes <= 15 * 60;
  const preOpen = isWeekday && minutes < 9 * 60 + 30;
  const lunch = isWeekday && minutes > 11 * 60 + 30 && minutes < 13 * 60;
  const afterClose = !isWeekday || minutes > 15 * 60;
  return {
    canTrade: isWeekday && (morning || afternoon),
    label: isWeekday && morning ? "早盘交易中" : isWeekday && afternoon ? "午后交易中" : preOpen ? "未开盘" : lunch ? "午间休市" : afterClose ? "已收盘" : "非交易时段",
  };
}

function getTradeMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

function canAutoSellNow(now = new Date()) {
  const session = getTradeSession(now);
  if (!session.canTrade) return false;
  const minutes = getTradeMinutes(now);
  return minutes >= 14 * 60 + 30 && minutes <= 15 * 60;
}

function isEmergencySell(position) {
  const gain = ((position.price - position.avgCost) / position.avgCost) * 100;
  return gain <= -8 || Number(position.changePct || 0) <= -7;
}

function deferSellReason() {
  const minutes = getTradeMinutes();
  if (minutes < 11 * 60 + 30) return "早盘不主动卖出，等待盘中拉升确认";
  if (minutes < 14 * 60 + 30) return "午后先观察承接，常规卖出延后到尾盘半小时";
  return "未到常规卖出窗口";
}

function ensureTradeOpen(actionName) {
  const session = getTradeSession();
  if (session.canTrade) return true;
  alert(`${session.label}，不能${actionName}。A股交易时间为交易日 09:30-11:30、13:00-15:00。`);
  return false;
}

function totalMarketValue() {
  return account.positions.reduce((sum, item) => sum + item.shares * item.price, 0);
}

function roundPrice(value) {
  return Math.round(value * 100) / 100;
}

function totalEquity() {
  return account.cash + totalMarketValue();
}

function returnRate() {
  return ((totalEquity() - account.initialCash) / account.initialCash) * 100;
}

function positionPct() {
  return totalEquity() ? (totalMarketValue() / totalEquity()) * 100 : 0;
}

function tradeOrderValue(trade) {
  const date = trade.date || account.date || "2026-05-22";
  const time = trade.time || "15:00";
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`).getTime() || 0;
}

function currentTradeStamp() {
  syncAccountDateToToday();
  return {
    date: account.date,
    time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

function formatTradeStamp(trade) {
  const date = trade.date || `Day ${trade.day}`;
  const time = trade.time || "--:--";
  return `${date} ${time}`;
}

function queryModeFromHash() {
  if (window.location.hash === "#candidates") return "candidates";
  if (window.location.hash === "#history") return "history";
  if (window.location.hash === "#query=closed") return "closed";
  if (window.location.hash === "#query=open") return "open";
  return "";
}

function openQueryPage(mode = "open") {
  window.location.hash = mode === "closed" ? "#query=closed" : "#query=open";
}

function closeQueryPage() {
  history.pushState("", document.title, window.location.pathname + window.location.search);
  renderRoute();
}

function openHistoryPage() {
  window.location.hash = "#history";
}

function openCandidatePage() {
  window.location.hash = "#candidates";
}

function renderRoute() {
  const mode = queryModeFromHash();
  const home = document.getElementById("homeView");
  const query = document.getElementById("queryView");
  const historyView = document.getElementById("historyView");
  const candidateView = document.getElementById("candidateView");
  if (!home || !query || !historyView || !candidateView) return;
  home.classList.toggle("view-hidden", Boolean(mode));
  query.classList.toggle("view-hidden", !["open", "closed"].includes(mode));
  historyView.classList.toggle("view-hidden", mode !== "history");
  candidateView.classList.toggle("view-hidden", mode !== "candidates");
  document.getElementById("openQuerySection")?.classList.toggle("view-hidden", mode !== "open");
  document.getElementById("closedQuerySection")?.classList.toggle("view-hidden", mode !== "closed");
  document.querySelectorAll("[data-query-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.queryTab === mode);
  });
  if (mode) window.scrollTo({ top: 0, behavior: "instant" });
}

function rebuildAccountFromTrades() {
  const previousPositions = new Map(account.positions.map((position) => [position.code, { ...position }]));
  account.cash = account.initialCash;
  const positionMap = new Map();
  const orderedTrades = [...account.trades].sort((a, b) => tradeOrderValue(a) - tradeOrderValue(b));
  orderedTrades.forEach((trade) => {
    const shares = Number(trade.shares || 0);
    const gross = Number(trade.price || 0) * shares;
    if (!gross || !shares) return;
    const fees = calcFees(gross, trade.type);
    trade.fee = fees.total;
    trade.feeDetail = fees;
    if (trade.type === "BUY") {
      const cost = gross + fees.total;
      trade.amount = cost;
      account.cash -= cost;
      const current = positionMap.get(trade.code) || {
        code: trade.code,
        name: trade.name,
        theme: trade.theme || previousPositions.get(trade.code)?.theme || "交易记录",
        shares: 0,
        avgCost: 0,
        price: trade.price,
        reason: trade.reason,
        buyDay: trade.day,
        targetHoldDays: previousPositions.get(trade.code)?.targetHoldDays || 3,
      };
      current.avgCost = (current.avgCost * current.shares + cost) / (current.shares + shares);
      current.shares += shares;
      current.price = previousPositions.get(trade.code)?.price || trade.price;
      current.reason = trade.reason;
      positionMap.set(trade.code, current);
    } else if (trade.type === "SELL") {
      const proceeds = gross - fees.total;
      trade.amount = proceeds;
      const current = positionMap.get(trade.code);
      const costBasis = current ? current.avgCost * shares : gross;
      trade.pnl = proceeds - costBasis;
      account.cash += proceeds;
      if (current) {
        current.shares -= shares;
        if (current.shares <= 0) positionMap.delete(trade.code);
      }
    }
  });
  account.positions = [...positionMap.values()].map((position) => {
    const previous = previousPositions.get(position.code) || {};
    return {
      ...position,
      price: Number(previous.price || position.price),
      quoteSource: previous.quoteSource,
      quoteUpdatedAt: previous.quoteUpdatedAt,
      changePct: previous.changePct,
      limitUpPrice: previous.limitUpPrice,
      isLimitUp: Boolean(previous.isLimitUp),
    };
  });
}

function recalculateAccountLedger() {
  const seen = new Set();
  account.trades = account.trades
    .filter((trade) => !(trade.type === "BUY" && String(trade.reason || "").includes("补足300股起步")))
    .map((trade) => {
      const isTailBuy = trade.type === "BUY" && ["000063", "600498"].includes(trade.code) && String(trade.reason || "").includes("bafeite尾盘轻仓");
      if (!isTailBuy || Number(trade.shares || 0) <= 100) return trade;
      const shares = 100;
      const gross = Number(trade.price || 0) * shares;
      const feeDetail = calcFees(gross, "BUY");
      return {
        ...trade,
        shares,
        amount: gross + feeDetail.total,
        fee: feeDetail.total,
        feeDetail,
      };
    })
    .filter((trade) => {
      const key = [trade.type, trade.date, trade.time, trade.code, trade.price, trade.shares, trade.reason].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  rebuildAccountFromTrades();
  account.history[account.history.length - 1] = {
    day: account.day,
    date: account.date,
    equity: totalEquity(),
    positionPct: positionPct(),
    mood: account.mood,
    ret: returnRate(),
  };
  account.comment = `账户已按成交流水重算：初始资金 ${money(account.initialCash)} 元，可用现金 ${money(account.cash)} 元，总收益 ${yuan(totalEquity() - account.initialCash)} 元。`;
  saveAccount();
}

function winRate() {
  const closed = account.trades.filter((trade) => trade.type === "SELL");
  if (!closed.length) return 0;
  return (closed.filter((trade) => trade.pnl > 0).length / closed.length) * 100;
}

function getTodayTrades(type) {
  const today = todayIso();
  return account.trades
    .filter((trade) => trade.date === today && trade.type === type)
    .sort((a, b) => tradeOrderValue(b) - tradeOrderValue(a));
}

function getOperationTrades(type) {
  return getTodayTrades(type);
}

function soldTodayCodes() {
  return new Set(getTodayTrades("SELL").map((trade) => trade.code));
}

function advanceDate() {
  const date = new Date(account.date);
  date.setDate(date.getDate() + 1);
  account.date = date.toISOString().slice(0, 10);
}

function importHistoricalTradesOnce() {
  const batchId = "manual-2026-05-20-21-huaan-aihua";
  if (account.importedBatches.includes(batchId)) return;

  const initialCash = Number(account.initialCash) || 30000;
  account = {
    ...account,
    started: true,
    initialCash,
    day: Math.max(Number(account.day) || 1, 3),
    date: "2026-05-22",
    importedBatches: [...account.importedBatches, batchId],
  };

  const huaanBuyGross = 6.79 * 300;
  const huaanBuyFees = calcFees(huaanBuyGross, "BUY");
  const huaanSellGross = 7.14 * 300;
  const huaanSellFees = calcFees(huaanSellGross, "SELL");
  const huaanRealizedPnl = huaanSellGross - huaanSellFees.total - huaanBuyGross - huaanBuyFees.total;
  const aihuaBuyGross = 26.39 * 100;
  const aihuaBuyFees = calcFees(aihuaBuyGross, "BUY");

  account.cash = initialCash - huaanBuyGross - huaanBuyFees.total + huaanSellGross - huaanSellFees.total - aihuaBuyGross - aihuaBuyFees.total;
  account.positions = account.positions.filter((item) => item.code !== "600909" && item.code !== "603989");
  account.positions.push({
    code: "603989",
    name: "艾华集团",
    theme: "历史导入",
    shares: 100,
    avgCost: (aihuaBuyGross + aihuaBuyFees.total) / 100,
    price: 26.39,
    reason: "昨日买入导入",
    buyDay: 2,
    targetHoldDays: 5,
  });

  const importedTrades = [
    {
      type: "BUY",
      day: 1,
      date: "2026-05-20",
      code: "600909",
      name: "华安证券",
      price: 6.79,
      shares: 300,
      amount: huaanBuyGross + huaanBuyFees.total,
      fee: huaanBuyFees.total,
      feeDetail: huaanBuyFees,
      reason: "前天买入导入",
      time: "15:00",
    },
    {
      type: "SELL",
      day: 2,
      date: "2026-05-21",
      code: "600909",
      name: "华安证券",
      price: 7.14,
      shares: 300,
      amount: huaanSellGross - huaanSellFees.total,
      fee: huaanSellFees.total,
      feeDetail: huaanSellFees,
      pnl: huaanRealizedPnl,
      reason: "昨天卖出导入",
      time: "15:00",
    },
    {
      type: "BUY",
      day: 2,
      date: "2026-05-21",
      code: "603989",
      name: "艾华集团",
      price: 26.39,
      shares: 100,
      amount: aihuaBuyGross + aihuaBuyFees.total,
      fee: aihuaBuyFees.total,
      feeDetail: aihuaBuyFees,
      reason: "昨天买入导入",
      time: "15:00",
    },
  ];
  account.trades = [
    ...importedTrades,
    ...account.trades.filter((trade) => trade.code !== "600909" && !(trade.code === "603989" && trade.reason?.includes("导入"))),
  ];

  account.history = [
    { day: 1, date: "2026-05-20", equity: initialCash - huaanBuyFees.total, positionPct: ((huaanBuyGross / (initialCash - huaanBuyFees.total)) * 100), mood: 50, ret: (-huaanBuyFees.total / initialCash) * 100 },
    { day: 2, date: "2026-05-21", equity: initialCash + huaanRealizedPnl - aihuaBuyFees.total, positionPct: (aihuaBuyGross / (initialCash + huaanRealizedPnl - aihuaBuyFees.total)) * 100, mood: 55, ret: ((huaanRealizedPnl - aihuaBuyFees.total) / initialCash) * 100 },
    { day: 3, date: "2026-05-22", equity: account.cash + aihuaBuyGross, positionPct: (aihuaBuyGross / (account.cash + aihuaBuyGross)) * 100, mood: 55, ret: ((account.cash + aihuaBuyGross - initialCash) / initialCash) * 100 },
  ];
  account.comment = `已导入两天交易：华安证券实现盈利 ${huaanRealizedPnl.toFixed(2)} 元；当前持有艾华集团 100 股，成本含费用 ${((aihuaBuyGross + aihuaBuyFees.total) / 100).toFixed(3)}。`;
  saveAccount();
}

function enforceHuaanClosedOnce() {
  const batchId = "enforce-huaan-closed-2026-05-22";
  if (account.importedBatches.includes(batchId)) return;
  const huaanBuyShares = account.trades
    .filter((trade) => trade.type === "BUY" && trade.code === "600909")
    .reduce((sum, trade) => sum + Number(trade.shares || 0), 0);
  const huaanSellShares = account.trades
    .filter((trade) => trade.type === "SELL" && trade.code === "600909")
    .reduce((sum, trade) => sum + Number(trade.shares || 0), 0);
  if (huaanBuyShares > 0 && huaanSellShares >= huaanBuyShares) {
    account.positions = account.positions.filter((position) => position.code !== "600909");
    rebuildAccountFromTrades();
    account.comment = "已校正：华安证券 300 股已卖出清仓，只保留在已清仓查询中。";
  }
  account.importedBatches.push(batchId);
  account.history[account.history.length - 1] = {
    day: account.day,
    date: account.date,
    equity: totalEquity(),
    positionPct: positionPct(),
    mood: account.mood,
    ret: returnRate(),
  };
  saveAccount();
}

function migrateSimulationCapital30000Once() {
  const batchId = "manual-capital-30000-2026-05-22";
  if (account.importedBatches.includes(batchId)) return;
  const oldInitial = Number(account.initialCash) || 30000;
  const newInitial = 30000;
  account.cash += newInitial - oldInitial;
  account.initialCash = newInitial;
  account.importedBatches.push(batchId);
  account.history = account.history.map((item) => {
    const equityDelta = newInitial - oldInitial;
    const equity = Number(item.equity) + equityDelta;
    return {
      ...item,
      equity,
      ret: ((equity - newInitial) / newInitial) * 100,
      positionPct: equity > 0 ? (totalMarketValue() / equity) * 100 : 0,
    };
  });
  if (account.history.length) {
    account.history[account.history.length - 1] = {
      ...account.history[account.history.length - 1],
      equity: totalEquity(),
      ret: returnRate(),
      positionPct: positionPct(),
    };
  }
  account.comment = `本金已修正为 30000 元；保留历史交易和当前持仓，现金按本金差额同步调整。`;
  saveAccount();
}

function importNearCloseBafeiteBuysOnce() {
  const batchId = "bafeite-tail-buy-2026-05-22-000063-600498-light";
  if (account.importedBatches.includes(batchId)) return;
  if (account.importedBatches.includes("bafeite-tail-buy-2026-05-22-000063-600498-300")) return;
  if (!account.started) account.started = true;
  const picks = [
    {
      code: "000063",
      name: "中兴通讯",
      theme: "通信设备/5G",
      price: 35.62,
      shares: 100,
      reason: "bafeite尾盘轻仓：5G/通信技术强势，未封涨停，流动性好",
    },
    {
      code: "600498",
      name: "烽火通信",
      theme: "光通信/算力网络",
      price: 55.1,
      shares: 100,
      reason: "bafeite尾盘轻仓：光通信方向活跃，未封涨停，靠近强势板块",
    },
  ];
  picks.forEach((pick) => {
    if (account.positions.some((item) => item.code === pick.code)) return;
    const gross = pick.price * pick.shares;
    const fees = calcFees(gross, "BUY");
    const cost = gross + fees.total;
    if (account.cash < cost) return;
    account.cash -= cost;
    account.positions.push({
      code: pick.code,
      name: pick.name,
      theme: pick.theme,
      shares: pick.shares,
      avgCost: cost / pick.shares,
      price: pick.price,
      reason: pick.reason,
      buyDay: account.day,
      targetHoldDays: 3,
      quoteSource: "东方财富 14:49",
      quoteUpdatedAt: "2026-05-22 14:49:34",
      changePct: pick.code === "000063" ? 2.27 : 1.96,
      isLimitUp: false,
    });
    account.trades.unshift({
      type: "BUY",
      day: account.day,
      date: "2026-05-22",
      code: pick.code,
      name: pick.name,
      price: pick.price,
      shares: pick.shares,
      amount: cost,
      fee: fees.total,
      feeDetail: fees,
      reason: pick.reason,
      time: "14:50",
    });
  });
  account.importedBatches.push(batchId);
  account.history[account.history.length - 1] = {
    day: account.day,
    date: account.date,
    equity: totalEquity(),
    positionPct: positionPct(),
    mood: account.mood,
    ret: returnRate(),
  };
  account.comment = "已按bafeite尾盘规则轻仓买入：中兴通讯100股、烽火通信100股。避开已封死涨停前排，选择通信/光通信方向未涨停承接标的。";
  saveAccount();
}

function importFoxconnCloseBuyOnce() {
  const batchId = "manual-buy-601138-2026-05-25-close-100";
  if (account.importedBatches.includes(batchId)) return;
  if (!account.started) account.started = true;
  const tradeDate = "2026-05-25";
  const tradeDay = 6;
  const price = 70.3;
  const shares = 100;
  const gross = price * shares;
  const fees = calcFees(gross, "BUY");
  account.trades.unshift({
    type: "BUY",
    day: tradeDay,
    date: tradeDate,
    code: "601138",
    name: "工业富联",
    theme: "算力服务器",
    price,
    shares,
    amount: gross + fees.total,
    fee: fees.total,
    feeDetail: fees,
    reason: "用户导入：今天收盘价买入100股工业富联",
    time: "15:00",
  });
  account.importedBatches.push(batchId);
  saveAccount();
}

function correctFoxconnCloseBuyDateOnce() {
  const batchId = "correct-601138-close-buy-date-2026-05-25";
  if (account.importedBatches.includes(batchId)) return;
  let changed = false;
  account.trades.forEach((trade) => {
    const isFoxconnCloseBuy = trade.type === "BUY"
      && trade.code === "601138"
      && String(trade.reason || "").includes("用户导入：今天收盘价买入100股工业富联");
    if (!isFoxconnCloseBuy) return;
    if (trade.date !== "2026-05-25" || Number(trade.day || 0) !== 6 || trade.time !== "15:00") {
      trade.date = "2026-05-25";
      trade.day = 6;
      trade.time = "15:00";
      changed = true;
    }
  });
  account.importedBatches.push(batchId);
  if (changed) rebuildAccountFromTrades();
  saveAccount();
}

function removeSameDayFiberhomeRebuyOnce() {
  const batchId = "remove-same-day-rebuy-600498-2026-06-02";
  if (account.importedBatches.includes(batchId)) return;
  const soldDates = new Set(account.trades
    .filter((trade) => trade.type === "SELL" && trade.code === "600498")
    .map((trade) => trade.date));
  const before = account.trades.length;
  account.trades = account.trades.filter((trade) => {
    const sameDayRebuy = trade.type === "BUY"
      && trade.code === "600498"
      && soldDates.has(trade.date)
      && String(trade.reason || "").includes("AI交易");
    return !sameDayRebuy;
  });
  account.importedBatches.push(batchId);
  if (account.trades.length !== before) {
    rebuildAccountFromTrades();
    account.comment = "已校正：烽火通信今日止损卖出后不再当天买回，进入冷却观察。";
  }
  saveAccount();
}

function addUserCapital5000Once() {
  const batchId = "add-user-capital-5000-2026-06-02";
  if (account.importedBatches.includes(batchId)) return;
  account.initialCash = Number(account.initialCash || 0) + 5000;
  account.cash = Number(account.cash || 0) + 5000;
  account.started = true;
  account.importedBatches.push(batchId);
  account.comment = "已追加本金 5,000 元：只增加本金和可用现金，不计入交易收益。";
  saveAccount();
}

function importJushiTailBuyOnce() {
  const batchId = "bafeite-tail-buy-600176-2026-06-02-100";
  if (account.importedBatches.includes(batchId)) return;
  const alreadyBought = account.trades.some((trade) => trade.type === "BUY" && trade.code === "600176" && trade.date === "2026-06-02");
  if (alreadyBought) {
    account.importedBatches.push(batchId);
    saveAccount();
    return;
  }
  if (!account.started) account.started = true;
  syncAccountDateToToday();
  const price = 38.95;
  const shares = 100;
  const gross = price * shares;
  const fees = calcFees(gross, "BUY");
  const cost = gross + fees.total;
  if (account.cash < cost) {
    account.importedBatches.push(batchId);
    account.comment = "中国巨石试仓未执行：追加本金后可用现金仍不足以覆盖买入金额和费用。";
    saveAccount();
    return;
  }
  const stamp = currentTradeStamp();
  account.trades.unshift({
    type: "BUY",
    day: account.day,
    date: stamp.date,
    code: "600176",
    name: "中国巨石",
    theme: "玻纤/顺周期材料",
    price,
    shares,
    amount: cost,
    fee: fees.total,
    feeDetail: fees,
    reason: "bafeite 尾盘试仓：中国巨石玻纤板块轮动，涨幅>1%，价格低于150，先买100股观察",
    time: stamp.time,
  });
  account.importedBatches.push(batchId);
  account.comment = "已执行 bafeite 尾盘试仓：中国巨石 100 股，按 38.95 元记录，固定止损 5%，盈利按走势判断。";
  saveAccount();
}

function importZteTailTopUpOnce() {
  const batchId = "bafeite-tail-topup-000063-2026-06-02-100";
  if (account.importedBatches.includes(batchId)) return;
  const alreadyTopUp = account.trades.some((trade) => trade.type === "BUY"
    && trade.code === "000063"
    && trade.date === "2026-06-02"
    && String(trade.reason || "").includes("尾盘补仓"));
  if (alreadyTopUp) {
    account.importedBatches.push(batchId);
    saveAccount();
    return;
  }
  if (!account.started) account.started = true;
  syncAccountDateToToday();
  const price = 36.25;
  const shares = 100;
  const gross = price * shares;
  const fees = calcFees(gross, "BUY");
  const cost = gross + fees.total;
  if (account.cash < cost) {
    account.importedBatches.push(batchId);
    account.comment = "中兴通讯尾盘补仓未执行：可用现金不足以覆盖买入金额和费用。";
    saveAccount();
    return;
  }
  const stamp = currentTradeStamp();
  account.trades.unshift({
    type: "BUY",
    day: account.day,
    date: stamp.date,
    code: "000063",
    name: "中兴通讯",
    theme: "通信设备/5G",
    price,
    shares,
    amount: cost,
    fee: fees.total,
    feeDetail: fees,
    reason: "bafeite 尾盘补仓：通信方向强，中兴通讯浮盈稳定，未追高于36.40，补100股观察",
    time: stamp.time,
  });
  account.importedBatches.push(batchId);
  account.comment = "已执行 bafeite 尾盘补仓：中兴通讯 100 股，按 36.25 元记录；若跌破 35.70，优先处理这笔加仓。";
  saveAccount();
}

function migrateTailBuysTo300SharesOnce() {
  const batchId = "migrate-tail-buy-300-shares-disabled-2026-05-22";
  if (account.importedBatches.includes(batchId)) return;
  account.importedBatches.push(batchId);
  saveAccount();
}

function revertForcedTailTopUpOnce() {
  const batchId = "revert-forced-tail-top-up-2026-05-22";
  if (account.importedBatches.includes(batchId)) return;
  let changed = false;
  account.trades = account.trades
    .map((trade) => {
      const isTailBuy = trade.type === "BUY" && ["000063", "600498"].includes(trade.code) && trade.date === "2026-05-22";
      if (!isTailBuy) return trade;
      if (String(trade.reason || "").includes("补足300股起步")) {
        changed = true;
        return null;
      }
      if (String(trade.reason || "").includes("bafeite尾盘轻仓") && Number(trade.shares || 0) > 100) {
        const shares = 100;
        const gross = Number(trade.price || 0) * shares;
        const fees = calcFees(gross, "BUY");
        changed = true;
        return {
          ...trade,
          shares,
          amount: gross + fees.total,
          fee: fees.total,
          feeDetail: fees,
        };
      }
      return trade;
    })
    .filter(Boolean);
  if (changed) {
    rebuildAccountFromTrades();
    account.comment = "已撤销自动补足300股的记录，尾盘两只保留轻仓，释放现金用于后续补仓。";
  }
  account.importedBatches.push(batchId);
  account.history[account.history.length - 1] = {
    day: account.day,
    date: account.date,
    equity: totalEquity(),
    positionPct: positionPct(),
    mood: account.mood,
    ret: returnRate(),
  };
  saveAccount();
}

function migrateFeesByRuleOnce() {
  const batchId = "migrate-fees-by-a-share-rule-2026-05-22";
  if (account.importedBatches.includes(batchId)) return;
  account.cash = account.initialCash;
  const positionMap = new Map();
  const orderedTrades = [...account.trades].reverse();
  orderedTrades.forEach((trade) => {
    const gross = Number(trade.price || 0) * Number(trade.shares || 0);
    if (!gross) return;
    const fees = calcFees(gross, trade.type);
    trade.fee = fees.total;
    trade.feeDetail = fees;
    if (trade.type === "BUY") {
      const cost = gross + fees.total;
      trade.amount = cost;
      account.cash -= cost;
      const current = positionMap.get(trade.code) || {
        code: trade.code,
        name: trade.name,
        theme: "费用规则重算",
        shares: 0,
        avgCost: 0,
        price: trade.price,
        reason: trade.reason,
        buyDay: trade.day,
        targetHoldDays: 3,
      };
      current.avgCost = (current.avgCost * current.shares + cost) / (current.shares + Number(trade.shares || 0));
      current.shares += Number(trade.shares || 0);
      current.price = trade.price;
      positionMap.set(trade.code, current);
    } else if (trade.type === "SELL") {
      const proceeds = gross - fees.total;
      trade.amount = proceeds;
      const current = positionMap.get(trade.code);
      const costBasis = current ? current.avgCost * Number(trade.shares || 0) : gross;
      trade.pnl = proceeds - costBasis;
      account.cash += proceeds;
      if (current) {
        current.shares -= Number(trade.shares || 0);
        if (current.shares <= 0) positionMap.delete(trade.code);
      }
    }
  });
  account.positions.forEach((position) => {
    const rebuilt = positionMap.get(position.code);
    if (!rebuilt) return;
    position.shares = rebuilt.shares;
    position.avgCost = rebuilt.avgCost;
  });
  account.importedBatches.push(batchId);
  account.history[account.history.length - 1] = {
    day: account.day,
    date: account.date,
    equity: totalEquity(),
    positionPct: positionPct(),
    mood: account.mood,
    ret: returnRate(),
  };
  account.comment = "交易费用已按A股规则重算：净佣金、过户费、经手费、证管费，卖出另计印花税。";
  saveAccount();
}

function autoRefreshQuotesOnLoad() {
  window.setTimeout(() => {
    if (shouldSyncRealtime()) {
      refreshMarketInfo();
      if (account.started && account.positions.length) refreshRealtimeQuotes();
    } else {
      loadPausedMarketSnapshotIfNeeded();
    }
  }, 300);
}

function shouldSyncRealtime() {
  return getTradeSession().canTrade;
}

function hasTodayMarketSnapshot() {
  return Boolean(account.marketInfo?.ok && dateTextIncludesToday(account.marketInfo.updatedAt || account.marketInfo.snapshotDate));
}

function hasTodayPositionQuotes() {
  if (!account.positions.length) return true;
  return account.positions.every((position) => dateTextIncludesToday(position.quoteUpdatedAt));
}

function needsPausedMarketSnapshot() {
  return !shouldSyncRealtime() && (!hasTodayMarketSnapshot() || !hasTodayPositionQuotes());
}

async function loadPausedMarketSnapshotIfNeeded() {
  if (!needsPausedMarketSnapshot() || realtimeRefreshing) {
    markRealtimePaused();
    return;
  }
  const session = getTradeSession();
  realtimeRefreshing = true;
  account.quoteStatus = `${session.label}，正在载入最近收盘快照。收盘后不循环刷新，只保留最后有效数据。`;
  render();
  try {
    await refreshMarketInfo({ silent: true, pausedSnapshot: true });
    if (account.started && account.positions.length) {
      await refreshRealtimeQuotes({ silent: true, pausedSnapshot: true, skipRelatedMarketRefresh: true });
    }
  } finally {
    realtimeRefreshing = false;
    markRealtimePaused();
  }
}

function markRealtimePaused() {
  const session = getTradeSession();
  if (account.marketInfo?.ok) {
    account.marketInfo = ensureClosingMarketData({
      ...account.marketInfo,
      loading: false,
      stale: false,
      syncStatus: `${session.label}，已停止实时同步`,
    });
  }
  account.quoteStatus = `${session.label}，非交易时间停止实时刷新，保留最后有效行情。`;
  saveAccount();
  renderMarketInfo();
  renderQuoteTimer();
}

function startQuoteAutoRefresh() {
  renderQuoteTimer();
  window.setInterval(async () => {
    syncAccountDateToToday();
    if (!shouldSyncRealtime()) {
      await loadPausedMarketSnapshotIfNeeded();
      autoRunAfterCloseAnalysis();
      return;
    }
    if (realtimeRefreshing) return;
    realtimeRefreshing = true;
    try {
      await refreshMarketInfo({ silent: true });
      if (account.started && account.positions.length) await refreshRealtimeQuotes({ silent: true });
      autoRunAfterCloseAnalysis();
    } finally {
      realtimeRefreshing = false;
      renderQuoteTimer();
    }
  }, realtimeRefreshMs);
}

function renderQuoteTimer() {
  const timer = document.getElementById("quoteTimer");
  if (!timer) return;
  if (!shouldSyncRealtime()) {
    const session = getTradeSession();
    const marketTime = account.marketInfo?.updatedAt ? `最后盘面 ${account.marketInfo.updatedAt}` : "暂无盘面";
    const quoteTime = account.positions.length
      ? `最后持仓 ${account.positions[0]?.quoteUpdatedAt || "等待同步"}`
      : "暂无持仓行情";
    timer.textContent = `${session.label}：已停止实时同步 · ${marketTime} · ${quoteTime}`;
    return;
  }
  const marketTime = account.marketInfo?.updatedAt ? `盘面 ${account.marketInfo.updatedAt}` : "盘面等待同步";
  const quoteTime = account.positions.length
    ? `持仓 ${account.positions[0]?.quoteUpdatedAt || "等待同步"}`
    : "暂无持仓行情";
  timer.textContent = `实时同步：每 ${Math.round(realtimeRefreshMs / 1000)} 秒自动更新 · ${marketTime} · ${quoteTime}`;
}

async function manualRefreshRealtime() {
  if (!shouldSyncRealtime()) {
    markRealtimePaused();
    alert(`${getTradeSession().label}，非交易时间不刷新实时行情，保留最后有效盘面。`);
    return;
  }
  await refreshMarketInfo();
  await refreshRealtimeQuotes();
}

function startAccount() {
  const initialCash = Number(document.getElementById("initialCash").value);
  const maxPositionPct = Number(document.getElementById("maxPositionPct").value);
  if (!Number.isFinite(initialCash) || initialCash < 10000) {
    alert("初始资金至少 10000 元。");
    return;
  }
  account = {
    ...clone(defaultAccount),
    started: true,
    initialCash,
    cash: initialCash,
    maxPositionPct: Math.min(Math.max(maxPositionPct, 5), 100),
    history: [{ day: 1, equity: initialCash, positionPct: 0, mood: 50, ret: 0 }],
    comment: "实盘记录已启动，点击 AI 自动跑一天会先刷新 bafeite 候选池，再按评分记录买入。",
  };
  saveAccount();
  render();
}

function resetAccount() {
  account = clone(defaultAccount);
  localStorage.removeItem(storeKey);
  fetch("/api/account", { method: "DELETE" }).catch(() => {});
  latestCandidates = [];
  render();
}

function openResetModal() {
  document.getElementById("resetModal").classList.add("open");
  document.getElementById("resetModal").setAttribute("aria-hidden", "false");
}

function closeResetModal() {
  document.getElementById("resetModal").classList.remove("open");
  document.getElementById("resetModal").setAttribute("aria-hidden", "true");
}

function buyStock(stock, amount, reason = "手动买入", options = {}) {
  if (!ensureTradeOpen("买入")) return false;
  if (!account.started) {
    alert("请先设置初始资金并启动实盘记录。");
    return false;
  }
  const stamp = currentTradeStamp();
  const minShares = options.minShares || minBuyShares;
  const exactShares = Number(options.shares || 0);
  const enforcePositionLimit = options.enforcePositionLimit !== false;
  const orderAmount = exactShares > 0 ? exactShares * stock.price : Math.min(amount, account.cash);
  if (orderAmount < 100) return false;
  const shares = exactShares > 0 ? exactShares : Math.floor(orderAmount / stock.price / 100) * 100;
  if (shares < minShares) return false;
  const gross = shares * stock.price;
  const fees = calcFees(gross, "BUY");
  const cost = gross + fees.total;
  if (cost > account.cash) return false;
  const nextPositionPct = totalEquity() ? ((totalMarketValue() + gross) / totalEquity()) * 100 : 0;
  if (enforcePositionLimit && nextPositionPct > maxTotalPositionPct) return false;
  const existing = account.positions.find((item) => item.code === stock.code);
  if (existing) {
    existing.avgCost = (existing.avgCost * existing.shares + cost) / (existing.shares + shares);
    existing.shares += shares;
    existing.price = stock.price;
    existing.reason = reason;
  } else {
    account.positions.push({
      code: stock.code,
      name: stock.name,
      theme: stock.theme || "手动",
      shares,
      avgCost: cost / shares,
      price: stock.price,
      reason,
      buyDay: account.day,
      targetHoldDays: decideHoldDays(stock),
      holdReason: decideHoldReason(stock),
    });
  }
  account.cash -= cost;
  account.trades.unshift({
      type: "BUY",
      day: account.day,
      date: stamp.date,
      code: stock.code,
      name: stock.name,
      price: stock.price,
      shares,
      amount: cost,
      fee: fees.total,
      feeDetail: fees,
      reason,
    time: stamp.time,
  });
  return true;
}

function sellStock(code, reason = "手动卖出") {
  if (!ensureTradeOpen("卖出")) return false;
  const stamp = currentTradeStamp();
  const index = account.positions.findIndex((item) => item.code === code);
  if (index < 0) return false;
  const position = account.positions[index];
  const gross = position.shares * position.price;
  const fees = calcFees(gross, "SELL");
  const amount = gross - fees.total;
  const pnl = amount - position.avgCost * position.shares;
  account.cash += amount;
  account.trades.unshift({
      type: "SELL",
      day: account.day,
      date: stamp.date,
      code: position.code,
    name: position.name,
    price: position.price,
    shares: position.shares,
    amount,
    fee: fees.total,
    feeDetail: fees,
    pnl,
    reason,
    time: stamp.time,
  });
  account.positions.splice(index, 1);
  return true;
}

function manualBuy() {
  const stock = {
    code: document.getElementById("stockCode").value.trim(),
    name: document.getElementById("stockName").value.trim(),
    price: Number(document.getElementById("stockPrice").value),
    theme: "手动",
  };
  const amount = Number(document.getElementById("orderAmount").value);
  if (!allowedMainBoard.test(stock.code) || !stock.name || !Number.isFinite(stock.price) || stock.price <= 0) {
    alert("只允许沪深主板代码：600/601/603/605/000/001/002/003。");
    return;
  }
  if (stock.price > 150) {
    alert("按 bafeite 默认规则，股价超过 150 的股票不纳入买入记录。");
    return;
  }
  if (buyStock(stock, amount, "手动买入")) {
    saveAccount();
    render();
  } else {
    alert("可用资金不足，或买入金额低于300股起步。");
  }
}

function simulateMarketMove() {
  account.positions.forEach((position) => {
    const drift = (account.mood - 48) / 850;
    const shock = (Math.random() - 0.47) * 0.075;
    position.price = Math.max(0.01, position.price * (1 + drift + shock));
  });
}

function decideHoldDays(stock = {}) {
  const change = Number(stock.changePct || 0);
  const score = Number(stock.score || 0);
  const sector = sectorStrengthForStock(stock);
  if (score >= 88 || account.mood >= 72 || sector.score >= 75) return 5;
  if (score >= 82 || account.mood >= 55 || (change >= buyChangeMinPct && change <= buyChangeMaxPct)) return 3;
  return 1;
}

function decideHoldReason(stock = {}) {
  const days = decideHoldDays(stock);
  const score = Number(stock.score || 0);
  const change = Number(stock.changePct || 0);
  const sector = sectorStrengthForStock(stock);
  return `${days}天：评分${score || "--"}，涨幅${Number.isFinite(change) ? pct(change) : "--"}，板块强度${sector.score}，情绪${account.mood}`;
}

function sectorStrengthForStock(stock = {}) {
  return sectorStrengthForPosition({ theme: stock.theme || stock.name || "", name: stock.name || "" });
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((stock) => {
    if (!stock?.code || seen.has(stock.code)) return false;
    seen.add(stock.code);
    return true;
  });
}

function buildMarketDerivedCandidates() {
  const market = account.marketInfo || {};
  const hotBoards = [...(market.topConcepts || []), ...(market.topIndustries || [])]
    .filter((item) => Number(item.changePct || 0) >= 3)
    .slice(0, 8);
  const hotBoardNames = hotBoards.map((item) => item.name).filter(Boolean);
  const amountLeaders = (market.amountLeaders || [])
    .filter((item) => allowedMainBoard.test(String(item.code || "")))
    .filter((item) => Number(item.price || 0) > 0 && Number(item.price || 0) <= 150)
    .map((item) => {
      const change = Number(item.changePct || 0);
      const amountScore = Math.min(8, Number(item.amount || 0) / 100000000 / 20);
      const turnoverScore = Math.min(5, Number(item.turnoverRate || 0));
      return {
        code: String(item.code),
        name: item.name,
        theme: hotBoardNames[0] ? `成交额前排/${hotBoardNames[0]}` : "成交额前排",
        price: Number(item.price),
        changePct: change,
        amount: Number(item.amount || 0),
        turnoverRate: Number(item.turnoverRate || 0),
        volume: Number(item.volume || 0),
        score: Math.round(76 + Math.min(8, Math.max(0, change)) + amountScore + turnoverScore),
        confidence: "动态",
        trigger: "来自实时成交额前排，需日K站上均线且量能放大确认",
        riskCheck: "主板；价格低于150；需排除公告风险和高位放量滞涨",
        dynamicSource: "成交额前排",
      };
    });
  const boardMatchedPool = stockPool
    .filter((stock) => hotBoardNames.some((name) => stock.theme.includes(name) || name.includes(stock.theme.split("/")[0])))
    .map((stock) => ({
      ...stock,
      score: Math.min(96, Number(stock.score || 0) + 3),
      dynamicSource: "热门板块匹配",
    }));
  return uniqueCandidates([...amountLeaders, ...boardMatchedPool]);
}

function buildBafeiteCandidates() {
  latestCandidates = uniqueCandidates([...stockPool, ...buildMarketDerivedCandidates()])
    .filter((stock) => allowedMainBoard.test(stock.code) && stock.price <= 150)
    .map((stock) => ({ ...stock }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  return latestCandidates;
}

function average(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function technicalSnapshotFromCandles(candles) {
  const rows = Array.isArray(candles) ? candles.slice(-60) : [];
  if (rows.length < 20) return { ok: false, score: 55, label: "日K数据不足" };
  const closes = rows.map((item) => Number(item.close));
  const volumes = rows.map((item) => Number(item.volume || 0));
  const last = rows[rows.length - 1];
  const close = Number(last.close);
  const ma5 = average(closes.slice(-5));
  const ma10 = average(closes.slice(-10));
  const ma20 = average(closes.slice(-20));
  const vol5 = average(volumes.slice(-5));
  const vol20 = average(volumes.slice(-20));
  const volumeRatio = vol20 ? vol5 / vol20 : 1;
  const recentHigh = Math.max(...rows.slice(-20).map((item) => Number(item.high || item.close || 0)));
  const recentLow = Math.min(...rows.slice(-20).map((item) => Number(item.low || item.close || 0)).filter((value) => value > 0));
  const chipScore = recentHigh && recentLow && recentHigh > recentLow
    ? Math.max(0, Math.min(100, Math.round(100 - ((close - recentLow) / (recentHigh - recentLow)) * 45)))
    : 60;
  const aboveMa = close >= ma5 && close >= ma10;
  const maBull = ma5 >= ma10 && ma10 >= ma20;
  const volumeOk = volumeRatio >= 1.05;
  const closeNearHigh = Number(last.high || close) ? close / Number(last.high || close) >= 0.96 : false;
  const klineOk = close >= Number(last.open || close) && closeNearHigh;
  const chipOk = chipScore >= 58;
  const score = Math.round(
    52
    + (aboveMa ? 16 : -8)
    + (maBull ? 14 : 0)
    + (volumeOk ? Math.min(12, (volumeRatio - 1) * 18) : -4)
    + (closeNearHigh ? 6 : 0)
    + (chipOk ? 5 : -3)
  );
  const label = `日K${aboveMa ? "站上5/10日线" : "未站稳短均"}，均线${maBull ? "多头" : "待修复"}，K线${klineOk ? "收强" : "承接一般"}，量能${volumeRatio.toFixed(2)}倍，筹码代理${chipScore}`;
  return {
    ok: true,
    score: Math.max(0, Math.min(100, score)),
    label,
    ma5,
    ma10,
    ma20,
    volumeRatio,
    chipScore,
    aboveMa,
    maBull,
    volumeOk,
    klineOk,
    chipOk,
  };
}

async function enrichCandidatesTechnical(candidates) {
  const targets = candidates.slice(0, 8);
  await Promise.allSettled(targets.map(async (stock) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(`/api/kline?code=${stock.code}&period=daily`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const tech = technicalSnapshotFromCandles(payload.candles);
      stock.technical = tech;
      stock.score = Math.round(Number(stock.score || 70) * 0.7 + tech.score * 0.3);
      stock.trigger = `${stock.trigger}；${tech.label}`;
    } catch {
      stock.technical = { ok: false, score: 55, label: "日K接口暂不可用，降权观察" };
      stock.score = Math.max(60, Math.round(Number(stock.score || 70) - 4));
    } finally {
      window.clearTimeout(timer);
    }
  }));
  latestCandidates = candidates.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return latestCandidates;
}

async function refreshCandidateQuotes() {
  const candidates = buildBafeiteCandidates();
  if (!candidates.length) return candidates;
  try {
    const payload = await fetchQuotePayload(candidates.map((stock) => stock.code));
    if (!payload.ok || !Array.isArray(payload.quotes)) return candidates;
    payload.quotes.forEach((quote) => {
      const candidate = latestCandidates.find((stock) => stock.code === quote.code);
      if (!candidate || !Number.isFinite(Number(quote.price))) return;
      candidate.price = Number(quote.price);
      candidate.changePct = Number(quote.changePct);
      candidate.quoteSource = quote.provider;
      candidate.isLimitUp = Boolean(quote.isLimitUp);
      candidate.amount = Number(quote.amount || candidate.amount || 0);
      candidate.volume = Number(quote.volume || candidate.volume || 0);
      candidate.turnoverRate = Number(quote.turnoverRate || candidate.turnoverRate || 0);
    });
    return enrichCandidatesTechnical(latestCandidates);
  } catch {
    return enrichCandidatesTechnical(candidates);
  }
}

function recentLossRate() {
  const sells = account.trades.filter((trade) => trade.type === "SELL").slice(0, 8);
  if (!sells.length) return 0;
  return (sells.filter((trade) => trade.pnl <= 0).length / sells.length) * 100;
}

function improveStrategyAfterLosses() {
  const lossRate = recentLossRate();
  if (lossRate <= 50) return false;
  account.adaptiveBoost = Math.min(18, (account.adaptiveBoost || 0) + 3);
  account.comment = `连续卖出表现偏弱，已改进 bafeite 权重：提高强技术面、资金流入、均线量能和板块承接的筛选权重；固定止损仍为 ${fixedStopLossPct}%。`;
  return true;
}

function analyzePositionAction(position) {
  const gain = ((position.price - position.avgCost) / position.avgCost) * 100;
  const context = positionSellContext(position, gain);
  const autoSellWindow = canAutoSellNow();
  const emergency = isEmergencySell(position);
  const weakIntraday = context.stockWeak && context.marketWeak && gain <= -1.5;
  const profitTrendWeak = gain > 0 && isProfitTakeSignal(position, gain, context);
  const holdExpired = account.day - (position.buyDay || account.day) >= (position.targetHoldDays || 3);
  if (gain <= -fixedStopLossPct) {
    if (!autoSellWindow && !emergency) {
      return { action: "HOLD", reason: `${position.name} 触发止损但暂缓：浮亏 ${pct(gain)}；${deferSellReason()}；${context.summary}` };
    }
    return { action: "SELL", reason: `bafeite 风控止损：浮亏 ${pct(gain)}，跌破 ${fixedStopLossPct}% 固定止损线；${context.summary}` };
  }
  if (profitTrendWeak) {
    if (!autoSellWindow) {
      return { action: "HOLD", reason: `${position.name} 指标转弱但暂缓卖出：浮盈 ${pct(gain)}；${deferSellReason()}；${context.summary}` };
    }
    return { action: "SELL", reason: `bafeite 指标转弱止盈：浮盈 ${pct(gain)}；${context.summary}` };
  }
  if (weakIntraday) {
    if (!autoSellWindow && !emergency) {
      return { action: "HOLD", reason: `${position.name} 弱势但暂缓卖出：当日 ${pct(Number(position.changePct || 0))}；${deferSellReason()}；${context.summary}` };
    }
    return { action: "SELL", reason: `bafeite 弱势止损：当日 ${pct(Number(position.changePct || 0))} 且持仓亏损；${context.summary}` };
  }
  if (holdExpired && gain <= -1 && context.sectorScore < 55) {
    if (!autoSellWindow) {
      return { action: "HOLD", reason: `${position.name} 持有周期到期但暂缓卖出：${deferSellReason()}；${context.summary}` };
    }
    return { action: "SELL", reason: `bafeite 持有周期到期且未走出收益，释放仓位；${context.summary}` };
  }
  return { action: "HOLD", reason: `${position.name} 持有观察：浮动 ${pct(gain)}，${context.summary}` };
}

function positionSellContext(position, gain) {
  const change = Number(position.changePct || 0);
  const sector = sectorStrengthForPosition(position);
  const gate = marketTradeGate();
  const stockWeak = change <= -1.2 || (gain > 0 && change <= 0.3);
  const sectorWeak = sector.score < 45 || sector.changePct < 0;
  const marketWeak = !gate.allowed;
  const summary = `个股${pct(change)}，板块${sector.label}${pct(sector.changePct)}，强度${sector.score}，盘面${gate.allowed ? "可交易" : "转弱"}`;
  return {
    change,
    sector,
    sectorScore: sector.score,
    stockWeak,
    sectorWeak,
    marketWeak,
    summary,
  };
}

function isProfitTakeSignal(position, gain, context = positionSellContext(position, gain)) {
  const change = context.change;
  const holdDays = account.day - (position.buyDay || account.day);
  if (change <= -1.2 && gain >= 0.5 && context.sectorWeak) return true;
  if (context.marketWeak && change <= 0.3 && gain >= 0.5 && context.sectorScore < 60) return true;
  if (holdDays >= (position.targetHoldDays || 3) && change < 1 && gain >= 2 && context.sectorScore < 55) return true;
  return false;
}

function sectorStrengthForPosition(position) {
  const market = account.marketInfo || {};
  const boards = [...(market.topConcepts || []), ...(market.topIndustries || [])];
  const tokens = String(position.theme || position.name || "")
    .split(/[\/、,，\s]+/)
    .filter(Boolean);
  const matched = boards.find((item) => {
    const name = String(item.name || "");
    return tokens.some((token) => name.includes(token) || token.includes(name));
  });
  if (matched) {
    const changePct = Number(matched.changePct || 0);
    return {
      label: matched.name || "相关板块",
      changePct,
      score: Math.max(0, Math.min(100, Math.round(50 + changePct * 8))),
    };
  }
  const allChanges = boards.map((item) => Number(item.changePct || 0)).filter(Number.isFinite);
  const avgChange = allChanges.length ? allChanges.reduce((sum, value) => sum + value, 0) / allChanges.length : 0;
  return {
    label: "未匹配板块均值",
    changePct: avgChange,
    score: Math.max(0, Math.min(100, Math.round(50 + avgChange * 6))),
  };
}

function marketTradeGate() {
  const market = account.marketInfo;
  const mood = account.moodDetail;
  const hotConcepts = market?.topConcepts || [];
  const hotIndustries = market?.topIndustries || [];
  const indices = market?.indices || [];
  const avgIndex = indices.length
    ? indices.reduce((sum, item) => sum + Number(item.changePct || 0), 0) / indices.length
    : Number(mood?.indexGain || 0);
  const hotBoard = [...hotConcepts, ...hotIndustries].some((item) => Number(item.changePct || 0) >= 3);
  const enoughMood = Number(account.mood || 0) >= Math.max(fixedMoodThreshold, 55);
  const breadthOk = !mood?.ok || Number(mood.yangPct || 0) >= 35 || Number(mood.limitUpCount || 0) >= 50;
  const allowed = enoughMood && avgIndex >= 0.2 && hotBoard && breadthOk && positionPct() < maxTotalPositionPct;
  const reasons = [];
  if (!enoughMood) reasons.push(`情绪 ${account.mood} 未达进攻阈值`);
  if (avgIndex < 0.2) reasons.push(`指数均值 ${pct(avgIndex)} 偏弱`);
  if (!hotBoard) reasons.push("热点板块涨幅不足");
  if (!breadthOk) reasons.push(`阳线比例 ${mood?.yangPct ?? "--"}% 偏低`);
  if (positionPct() >= maxTotalPositionPct) reasons.push(`总仓位 ${positionPct().toFixed(0)}% 已接近上限`);
  return { allowed, reason: reasons.join("；") || "盘面允许小仓观察" };
}

function affordableAiShares(stock) {
  const fullGross = stock.price * minBuyShares;
  const fullCost = fullGross + calcFees(fullGross, "BUY").total;
  const fullNextPositionPct = totalEquity() ? ((totalMarketValue() + fullGross) / totalEquity()) * 100 : 0;
  if (fullCost <= account.cash && fullNextPositionPct <= maxTotalPositionPct) {
    return { shares: minBuyShares, gross: fullGross, cost: fullCost, enforcePositionLimit: true };
  }
  const fallbackGross = stock.price * aiFallbackBuyShares;
  const fallbackCost = fallbackGross + calcFees(fallbackGross, "BUY").total;
  if (fallbackCost <= account.cash) {
    return { shares: aiFallbackBuyShares, gross: fallbackGross, cost: fallbackCost, enforcePositionLimit: false };
  }
  return {
    blocked: true,
    minCost: fallbackCost,
  };
}

function capitalFlowOk(stock) {
  const amount = Number(stock.amount || 0);
  const turnover = Number(stock.turnoverRate || 0);
  const change = Number(stock.changePct || 0);
  return amount >= 800000000 || turnover >= 2 || (change >= 2 && amount >= 300000000);
}

function isStrongTrialCandidate(stock) {
  const tech = stock.technical || {};
  return Boolean(
    tech.ok
    && tech.aboveMa
    && tech.maBull
    && tech.klineOk
    && tech.volumeOk
    && tech.chipOk
    && capitalFlowOk(stock)
    && Number(stock.changePct || 0) > strongTrialChangeMinPct
  );
}

function candidateBuyDecision(stock, gate) {
  if (!gate.allowed) return { ok: false, reason: gate.reason };
  if (!allowedMainBoard.test(stock.code)) return { ok: false, reason: "非沪深主板" };
  if (stock.price > 150) return { ok: false, reason: "股价超过150" };
  if (stock.isLimitUp) return { ok: false, reason: "已封涨停，不追" };
  if (soldTodayCodes().has(stock.code)) return { ok: false, reason: "今日已卖出，冷却观察" };
  if (account.positions.some((position) => position.code === stock.code)) return { ok: false, reason: "已经持有，不重复买入" };
  if (account.positions.length >= maxHoldingCount) return { ok: false, reason: `持股已达${maxHoldingCount}只上限` };
  const order = affordableAiShares(stock);
  const change = Number(stock.changePct);
  const strongTrial = isStrongTrialCandidate(stock);
  const trendOk = Number.isFinite(change) && (
    (change >= buyChangeMinPct && change <= buyChangeMaxPct)
    || strongTrial
  );
  if (order.blocked) return { ok: false, reason: `可用现金不足，100股需约${yuan(order.minCost)}元` };
  if (stock.dynamicSource && !stock.technical?.ok) return { ok: false, reason: "日K/均线未确认" };
  if (stock.technical?.ok && !strongTrial && (!stock.technical.aboveMa || stock.technical.score < 68)) {
    return { ok: false, reason: stock.technical.label };
  }
  if (!strongTrial && stock.score < 82) return { ok: false, reason: `bafeite评分 ${stock.score} 不够` };
  if (!trendOk) return { ok: false, reason: `涨幅 ${Number.isFinite(change) ? pct(change) : "--"} 未达${buyChangeMinPct}%-${buyChangeMaxPct}%承接区间；强技术试仓需>${strongTrialChangeMinPct}%` };
  return {
    ok: true,
    shares: order.shares,
    amount: order.cost,
    enforcePositionLimit: order.enforcePositionLimit,
    reason: strongTrial ? `强技术试仓，计划买入${order.shares}股` : `满足条件，计划买入${order.shares}股`,
  };
}

function affordableAddShares(position) {
  const shares = aiFallbackBuyShares;
  const gross = Number(position.price || 0) * shares;
  if (!gross) return { blocked: true, reason: "价格无效" };
  const cost = gross + calcFees(gross, "BUY").total;
  if (cost > account.cash) return { blocked: true, reason: `可用现金不足，100股需约${yuan(cost)}元` };
  return { shares, gross, cost, enforcePositionLimit: false };
}

function positionAddDecision(position, gate) {
  if (!gate.allowed) return { ok: false, reason: gate.reason };
  if (!allowedMainBoard.test(position.code)) return { ok: false, reason: "非沪深主板" };
  if (Number(position.price || 0) > 150) return { ok: false, reason: "股价超过150" };
  if (position.isLimitUp) return { ok: false, reason: "已封涨停，不加仓" };
  const gain = ((position.price - position.avgCost) / position.avgCost) * 100;
  const context = positionSellContext(position, gain);
  if (gain < 1.5) return { ok: false, reason: `浮盈${pct(gain)}未稳定` };
  if (context.change < 0.8) return { ok: false, reason: `当日走势${pct(context.change)}不够强` };
  if (context.stockWeak) return { ok: false, reason: "个股分时转弱" };
  if (context.sectorScore < 60) return { ok: false, reason: `板块强度${context.sectorScore}不足` };
  const order = affordableAddShares(position);
  if (order.blocked) return { ok: false, reason: order.reason };
  return {
    ok: true,
    shares: order.shares,
    amount: order.cost,
    enforcePositionLimit: order.enforcePositionLimit,
    reason: `浮盈${pct(gain)}，个股${pct(context.change)}，板块强度${context.sectorScore}`,
  };
}

function candidateCanBuy(stock) {
  return candidateBuyDecision(stock, marketTradeGate()).ok;
}

async function aiTradeNow() {
  if (!account.started) {
    alert("请先设置初始资金并启动实盘记录。");
    return;
  }
  const session = getTradeSession();
  if (!session.canTrade) {
    alert(`${session.label}，当前只分析不记录买卖。A股交易时间为交易日 09:30-11:30、13:00-15:00。`);
  }
  account.quoteStatus = "AI交易：正在刷新持仓与 bafeite 候选行情";
  account.comment = "AI交易正在分析：先看持仓止损/止盈，再看市场候选买入机会。";
  render();

  if (session.canTrade) {
    await refreshMarketInfo();
    if (account.positions.length) await refreshRealtimeQuotes();
    await refreshCandidateQuotes();
  } else {
    markRealtimePaused();
    buildBafeiteCandidates();
  }

  const gate = marketTradeGate();
  const sells = [];
  const holds = [];
  [...account.positions].forEach((position) => {
    const decision = analyzePositionAction(position);
    if (decision.action === "SELL") sells.push({ position, reason: decision.reason });
    else holds.push(decision.reason);
  });

  const buys = [];
  const adds = [];
  if (session.canTrade) {
    const sellCodes = new Set(sells.map((item) => item.position.code));
    sells.forEach(({ position, reason }) => {
      sellStock(position.code, reason);
    });
    const addCandidates = [...account.positions]
      .filter((position) => !sellCodes.has(position.code))
      .map((position) => ({ position, decision: positionAddDecision(position, gate) }))
      .filter((item) => item.decision.ok)
      .sort((a, b) => {
        const aGain = ((a.position.price - a.position.avgCost) / a.position.avgCost) * 100;
        const bGain = ((b.position.price - b.position.avgCost) / b.position.avgCost) * 100;
        return bGain - aGain;
      })
      .slice(0, 1);
    addCandidates.forEach(({ position, decision }) => {
      const stock = {
        code: position.code,
        name: position.name,
        theme: position.theme,
        price: position.price,
        changePct: position.changePct,
        score: 86,
        isLimitUp: position.isLimitUp,
      };
      if (buyStock(stock, decision.amount, `AI交易 bafeite 加仓：${decision.reason}`, {
        minShares: aiFallbackBuyShares,
        shares: decision.shares,
        enforcePositionLimit: decision.enforcePositionLimit,
      })) {
        adds.push(`${position.name}${decision.shares}股`);
      }
    });
    const buyCandidates = latestCandidates
      .map((stock) => ({ stock, decision: candidateBuyDecision(stock, gate) }))
      .filter((item) => item.decision.ok)
      .slice(0, gate.allowed && account.mood >= 75 ? 2 : 1);
    buyCandidates.forEach(({ stock }) => {
      const decision = candidateBuyDecision(stock, gate);
      if (decision.ok && buyStock(stock, decision.amount, `AI交易 bafeite 买入：${stock.theme}，评分 ${stock.score}`, {
        minShares: aiFallbackBuyShares,
        shares: decision.shares,
        enforcePositionLimit: decision.enforcePositionLimit,
      })) {
        buys.push(`${stock.name}${decision.shares}股`);
      }
    });
  }

  account.history[account.history.length - 1] = {
    day: account.day,
    date: account.date,
    equity: totalEquity(),
    positionPct: positionPct(),
    mood: account.mood,
    ret: returnRate(),
  };
  const skipped = latestCandidates
    .filter((stock) => !account.positions.some((position) => position.code === stock.code))
    .map((stock) => ({ stock, decision: candidateBuyDecision(stock, gate) }))
    .filter((item) => !item.decision.ok)
    .slice(0, 2)
    .map((item) => `${item.stock.name}${item.decision.reason}`);
  const sessionText = session.canTrade ? "已按交易时间执行" : `${session.label}，只分析不记录买卖`;
  const sellText = sells.length ? `卖出 ${sells.map((item) => item.position.name).join("、")}` : "持仓未触发卖出";
  const deferred = holds.filter((text) => text.includes("暂缓"));
  const deferredText = deferred.length ? `，暂缓卖出 ${deferred.length} 只：${deferred.slice(0, 2).join("；")}` : "";
  const addText = adds.length ? `加仓 ${adds.join("、")}` : "未触发加仓";
  const buyText = buys.length ? `买入 ${buys.join("、")}` : "未触发新买入";
  const skipText = skipped.length ? `；跳过：${skipped.join("、")}` : "";
  account.comment = `AI交易完成：${sessionText}。盘面判断：${gate.reason}。${sellText}${deferredText}，${addText}，${buyText}${skipText}。`;
  saveAccount();
  render();
}

function autoTradeDay() {
  if (!ensureTradeOpen("自动交易")) return;
  if (!account.started) {
    alert("请先设置初始资金并启动实盘记录。");
    return;
  }
  account.day += 1;
  advanceDate();
  simulateMarketMove();

  [...account.positions].forEach((position) => {
    const decision = analyzePositionAction(position);
    if (decision.action === "SELL") sellStock(position.code, decision.reason);
  });

  const canBuy = account.mood >= fixedMoodThreshold && positionPct() < maxTotalPositionPct;
  if (canBuy) {
    const candidates = buildBafeiteCandidates().filter((stock) => stock.score >= 74);
    const buyTimes = account.mood > 72 ? 2 : 1;
    candidates.slice(0, buyTimes).forEach((stock) => {
      buyStock(stock, account.cash, `bafeite 评分 ${stock.score} 买入`);
    });
  } else {
    buildBafeiteCandidates();
  }

  const equity = totalEquity();
  account.history.push({
    day: account.day,
    equity,
    positionPct: positionPct(),
    mood: account.mood,
    ret: returnRate(),
  });
  account.history = account.history.slice(-52);
  const improved = improveStrategyAfterLosses();
  if (!improved) account.comment = buildComment();
  saveAccount();
  render();
}

function buildComment() {
  const buys = getTodayTrades("BUY").length;
  const sells = getTodayTrades("SELL").length;
  const moodText = account.mood >= 70 ? "高涨" : account.mood >= 45 ? "修复" : "低迷";
  const ret = returnRate();
  if (buys || sells) {
    return `Day ${account.day} · 情绪 ${account.mood} 分${moodText}，买入 ${buys} 只，卖出 ${sells} 只，累计收益 ${pct(ret)}。候选遵循 bafeite 主板排雷，并允许追强势高位趋势。`;
  }
  return `Day ${account.day} · 情绪 ${account.mood} 分${moodText}，未触发新交易，继续等待更清晰信号。`;
}

function exportReport() {
  const payload = {
    date: currentDateText(),
    day: account.day,
    initialCash: account.initialCash,
    equity: Math.round(totalEquity()),
    cash: Math.round(account.cash),
    returnRate: pct(returnRate()),
    positionPct: `${positionPct().toFixed(0)}%`,
    mood: account.mood,
    winRate: `${winRate().toFixed(1)}%`,
    positions: account.positions,
    todayTrades: account.trades
      .filter((trade) => trade.date === todayIso())
      .sort((a, b) => tradeOrderValue(b) - tradeOrderValue(a)),
    comment: account.comment,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `linlin-day-${account.day}-report.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  saveAccount();
  fetch("/api/backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account }),
  })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      if (!payload.ok) throw new Error(payload.error || "backup failed");
      document.getElementById("localSaveStatus").textContent = `数据库已备份：${new Date().toLocaleString("zh-CN", { hour12: false })}`;
      alert("数据库备份已完成，文件保存在 data/backups。");
    })
    .catch((error) => {
      alert(`数据库备份失败：${error.message}`);
    });
}

function exportPortablePackage() {
  saveAccount();
  window.location.href = "/api/export-portable";
}

function restoreLatestDatabaseBackup() {
  if (!confirm("确定恢复最近一份数据库备份吗？当前页面数据会被备份中的数据覆盖。")) return;
  fetch("/api/restore-latest", { method: "POST" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      if (!payload.ok || !payload.account) throw new Error(payload.error || "restore failed");
      account = normalizeAccount(payload.account);
      localStorage.setItem(storeKey, JSON.stringify(account));
      latestCandidates = [];
      render();
      alert(`已恢复最近数据库备份：${payload.restoredFrom || ""}`);
    })
    .catch((error) => {
      alert(`恢复失败：${error.message}`);
    });
}

function codeToSecid(code) {
  return code.startsWith("6") ? `1.${code}` : `0.${code}`;
}

async function refreshRealtimeQuotes(options = {}) {
  if (!account.positions.length) {
    account.quoteStatus = "当前没有持仓，无需刷新行情。";
    render();
    return;
  }
  const codes = account.positions.map((item) => item.code);
  if (!options.silent) {
    account.quoteStatus = "正在刷新实时行情：智兔Token → 腾讯行情 → 东方财富 → 新浪行情 → 网易财经 → 同花顺THSDK";
    render();
  }
  try {
    const payload = await fetchQuotePayload(codes);
    if (!payload.ok || !Array.isArray(payload.quotes) || !payload.quotes.length) {
      throw new Error((payload.errors || ["empty quote"]).join("；"));
    }
    payload.quotes.forEach(applyQuoteToPosition);
    const providers = [...new Set(payload.quotes.map((item) => item.provider).filter(Boolean))].join("、");
    account.quoteStatus = options.pausedSnapshot
      ? `收盘快照已载入：${new Date().toLocaleTimeString("zh-CN", { hour12: false })} · 来源 ${providers || "行情接口"}`
      : `实时行情已更新：${new Date().toLocaleTimeString("zh-CN", { hour12: false })} · 来源 ${providers || "行情接口"}`;
    account.history[account.history.length - 1] = {
      day: account.day,
      date: account.date,
      equity: totalEquity(),
      positionPct: positionPct(),
      mood: account.mood,
      ret: returnRate(),
    };
    saveAccount();
    render();
    if (!options.skipRelatedMarketRefresh) {
      refreshMarketMood();
      refreshMarketInfo();
    }
  } catch (error) {
    account.quoteStatus = `实时行情刷新失败：${error.message}。请检查网络，或稍后重试。`;
    render();
  }
}

async function refreshMarketMood() {
  try {
    const response = await fetch("/api/mood", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const mood = await response.json();
    if (!mood.ok) throw new Error((mood.errors || ["mood empty"]).join("；"));
    account.mood = mood.score;
    account.moodDetail = mood;
    account.quoteStatus = `${account.quoteStatus || "行情已刷新"}；市场情绪 ${mood.score}（阳 ${mood.yangPct}% / 阴 ${mood.yinPct}%）`;
    saveAccount();
    render();
  } catch (error) {
    account.moodDetail = {
      ok: false,
      error: error.message,
      provider: "市场情绪接口失败",
    };
    render();
  }
}

async function refreshMarketInfo(options = {}) {
  if (!options.silent) {
    account.marketInfo = account.marketInfo?.ok
      ? {
        ...account.marketInfo,
        loading: true,
        stale: true,
        syncStatus: "正在同步最新盘面",
      }
      : {
        ok: false,
        loading: true,
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      };
    renderMarketInfo();
  }
  try {
    const response = await fetch("/api/market", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const market = await response.json();
    if (!market.ok) throw new Error((market.errors || ["market empty"]).join("；"));
    account.marketInfo = mergeMarketInfo(account.marketInfo, {
      ...market,
      loading: false,
      stale: false,
      syncStatus: options.pausedSnapshot ? `${getTradeSession().label}，收盘快照已保留` : "",
      snapshotDate: todayIso(),
    });
    if (market.mood?.ok) {
      account.mood = market.mood.score;
      account.moodDetail = market.mood;
    }
    saveAccount();
    render();
  } catch (error) {
    account.marketInfo = account.marketInfo?.ok
      ? {
        ...account.marketInfo,
        loading: false,
        stale: true,
        syncStatus: `同步失败，保留上一帧：${error.message}`,
      }
      : {
        ok: false,
        error: error.message,
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      };
    renderMarketInfo();
  }
}

function mergeMarketInfo(previous, next) {
  const merged = {
    ...next,
    indices: nonEmptyOrPrevious(next.indices, previous?.indices),
    topConcepts: nonEmptyOrPrevious(next.topConcepts, previous?.topConcepts),
    topIndustries: nonEmptyOrPrevious(next.topIndustries, previous?.topIndustries),
    amountLeaders: nonEmptyOrPrevious(next.amountLeaders, previous?.amountLeaders),
    limitUpCount: next.limitUpCount ?? previous?.limitUpCount,
    limitDownCount: next.limitDownCount ?? previous?.limitDownCount,
    hotUpCount: next.hotUpCount ?? previous?.hotUpCount,
  };
  merged.limitUpCount = stableMarketCount(next.limitUpCount, previous?.limitUpCount, "limitUpCount");
  merged.limitDownCount = stableMarketCount(next.limitDownCount, previous?.limitDownCount, "limitDownCount");
  merged.hotUpCount = stableMarketCount(next.hotUpCount, previous?.hotUpCount, "hotUpCount");
  return ensureClosingMarketData(merged);
}

function nonEmptyOrPrevious(nextItems, previousItems) {
  return Array.isArray(nextItems) && nextItems.length ? nextItems : (Array.isArray(previousItems) ? previousItems : []);
}

function stableMarketCount(nextValue, previousValue, key) {
  const fallback = closingMarketFallback()[key];
  const next = nextValue === null || nextValue === undefined ? NaN : Number(nextValue);
  const previous = previousValue === null || previousValue === undefined ? NaN : Number(previousValue);
  if (!Number.isFinite(next)) return Number.isFinite(previous) ? previous : fallback;
  if (!shouldSyncRealtime() && next === 0 && Number.isFinite(previous) && previous > 0) return previous;
  if (!shouldSyncRealtime() && next === 0 && fallback > 0) return fallback;
  return next;
}

function ensureClosingMarketData(market) {
  if (!market?.ok) return market;
  const fallback = closingMarketFallback();
  return {
    ...market,
    topConcepts: Array.isArray(market.topConcepts) && market.topConcepts.length ? market.topConcepts : fallback.topConcepts,
    topIndustries: Array.isArray(market.topIndustries) && market.topIndustries.length ? market.topIndustries : fallback.topIndustries,
    amountLeaders: Array.isArray(market.amountLeaders) && market.amountLeaders.length ? market.amountLeaders : fallback.amountLeaders,
    limitUpCount: stableMarketCount(market.limitUpCount, null, "limitUpCount"),
    limitDownCount: stableMarketCount(market.limitDownCount, null, "limitDownCount"),
    hotUpCount: stableMarketCount(market.hotUpCount, null, "hotUpCount"),
  };
}

function closingMarketFallback() {
  return {
    limitUpCount: null,
    limitDownCount: null,
    hotUpCount: null,
    topConcepts: [],
    topIndustries: [],
    amountLeaders: [],
  };
}

async function fetchQuotePayload(codes) {
  const localUrl = `/api/quotes?codes=${encodeURIComponent(codes.join(","))}`;
  try {
    const response = await fetch(localUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`local HTTP ${response.status}`);
    return await response.json();
  } catch (localError) {
    const direct = await fetchEastmoneyDirect(codes);
    if (direct.ok) return direct;
    return {
      ok: false,
      quotes: [],
      errors: [`本地代理失败：${localError.message}`, ...(direct.errors || [])],
    };
  }
}

async function fetchEastmoneyDirect(codes) {
  try {
    const secids = codes.map((code) => codeToSecid(code)).join(",");
    const fields = "f12,f14,f2,f3,f18";
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(secids)}&fields=${fields}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Eastmoney HTTP ${response.status}`);
    const payload = await response.json();
    const rows = payload?.data?.diff || [];
    const quotes = rows
      .map((row) => ({
        code: String(row.f12),
        name: String(row.f14),
        price: Number(row.f2),
        prevClose: Number(row.f18),
        changePct: Number(row.f3),
        limitUpPrice: Number.isFinite(Number(row.f18)) ? roundPrice(Number(row.f18) * 1.1) : null,
        isLimitUp: Number(row.f3) >= 9.8,
        provider: "东方财富直连",
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      }))
      .filter((item) => Number.isFinite(item.price) && item.price > 0);
    return quotes.length ? { ok: true, quotes, errors: [] } : { ok: false, quotes: [], errors: ["东方财富直连无数据"] };
  } catch (error) {
    return { ok: false, quotes: [], errors: [`东方财富直连失败：${error.message}`] };
  }
}

function applyQuoteToPosition(quote) {
  const position = account.positions.find((item) => item.code === quote.code);
  if (!position || !Number.isFinite(Number(quote.price))) return;
  position.price = Number(quote.price);
  position.quoteUpdatedAt = quote.updatedAt || new Date().toISOString();
  position.quoteSource = quote.provider || "行情接口";
  position.changePct = Number(quote.changePct);
  position.limitUpPrice = quote.limitUpPrice;
  position.isLimitUp = Boolean(quote.isLimitUp);
}

function restoreBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const payload = JSON.parse(String(reader.result));
      const nextAccount = payload.account || payload;
      if (!nextAccount || typeof nextAccount !== "object" || !Array.isArray(nextAccount.history)) {
        throw new Error("Invalid backup");
      }
      account = normalizeAccount(nextAccount);
      saveAccount();
      latestCandidates = [];
      render();
      alert("本地备份已恢复。");
    } catch {
      alert("备份文件格式不正确，无法恢复。");
    } finally {
      document.getElementById("restoreInput").value = "";
    }
  });
  reader.readAsText(file);
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderMarketInfo() {
  const market = account.marketInfo;
  document.getElementById("marketUpdatedAt").textContent = market?.ok
    ? `${market.updatedAt} · ${market.provider}${market.syncStatus ? ` · ${market.syncStatus}` : ""}`
    : market?.loading ? "正在刷新盘面数据" : market?.error ? `刷新失败：${market.error}` : "等待刷新";
  const indexGrid = document.getElementById("indexGrid");
  const indices = market?.indices || [];
  indexGrid.innerHTML = indices.length
    ? indices.map((item) => {
      const change = Number(item.changePct || 0);
      const cls = change >= 0 ? "up" : "down";
      const arrow = change >= 0 ? "▲" : "▼";
      return `
        <article class="index-card">
          <span>${item.name}</span>
          <strong>${Number(item.price || 0).toFixed(2)}</strong>
          <small class="${cls}">${arrow} ${pct(change)}</small>
        </article>
      `;
    }).join("")
    : `<article class="index-card"><span>指数</span><strong>--</strong><small>等待实时数据</small></article>`;
  document.getElementById("limitUpCount").textContent = market?.limitUpCount ?? "--";
  document.getElementById("limitDownCount").textContent = market?.limitDownCount ?? "--";
  document.getElementById("hotUpCount").textContent = market?.hotUpCount ?? "--";
  const concepts = market?.topConcepts || [];
  document.getElementById("conceptList").innerHTML = concepts.length
    ? concepts.slice(0, 5).map((item) => `
      <div class="mini-row">
        <span>${item.name}</span>
        <strong class="${Number(item.changePct || 0) >= 0 ? "up" : "down"}">${pct(Number(item.changePct || 0))}</strong>
        <small>领涨 ${item.leader || "--"} ${item.leaderChangePct !== undefined ? pct(Number(item.leaderChangePct || 0)) : ""} · 阳 ${item.up ?? "--"} / 阴 ${item.down ?? "--"}</small>
      </div>
    `).join("")
    : `<small>等待概念热度数据</small>`;
  const industries = market?.topIndustries || [];
  document.getElementById("industryList").innerHTML = industries.length
    ? industries.slice(0, 5).map((item) => `
      <div class="mini-row">
        <span>${item.name}</span>
        <strong class="${Number(item.changePct || 0) >= 0 ? "up" : "down"}">${pct(Number(item.changePct || 0))}</strong>
        <small>领涨 ${item.leader || "--"} ${item.leaderChangePct !== undefined ? pct(Number(item.leaderChangePct || 0)) : ""} · 阳 ${item.up ?? "--"} / 阴 ${item.down ?? "--"}</small>
      </div>
    `).join("")
    : `<small>等待行业涨幅数据</small>`;
  const leaders = market?.amountLeaders || [];
  document.getElementById("amountLeaderList").innerHTML = leaders.length
    ? leaders.slice(0, 6).map((item) => `
      <div class="mini-row">
        <span>${item.name} <small>${item.code}</small></span>
        <strong>${amountYi(item.amount)}</strong>
        <small class="${Number(item.changePct || 0) >= 0 ? "up" : "down"}">${pct(Number(item.changePct || 0))} · ${volumeWan(item.volume)} · 换手 ${Number(item.turnoverRate || 0).toFixed(2)}%</small>
      </div>
    `).join("")
    : `<small>等待成交额排名数据</small>`;
  renderAuctionAnalysis();
}

function marketAverageIndexChange() {
  const indices = account.marketInfo?.indices || [];
  if (!indices.length) return Number(account.moodDetail?.indexGain || 0);
  return indices.reduce((sum, item) => sum + Number(item.changePct || 0), 0) / indices.length;
}

function topBoardText() {
  const boards = [...(account.marketInfo?.topConcepts || []), ...(account.marketInfo?.topIndustries || [])]
    .filter((item) => item?.name)
    .sort((a, b) => Number(b.changePct || 0) - Number(a.changePct || 0));
  if (!boards.length) return "热点板块等待确认";
  return `${boards[0].name}${pct(Number(boards[0].changePct || 0))}`;
}

function auctionScore(type) {
  const mood = Number(account.mood || 0);
  const indexChange = marketAverageIndexChange();
  const limitUp = Number(account.marketInfo?.limitUpCount || account.moodDetail?.limitUpCount || 0);
  const limitDown = Number(account.marketInfo?.limitDownCount || 0);
  const hotUp = Number(account.marketInfo?.hotUpCount || 0);
  const hotBoard = [...(account.marketInfo?.topConcepts || []), ...(account.marketInfo?.topIndustries || [])]
    .some((item) => Number(item.changePct || 0) >= 3);
  let score = mood * 0.45 + Math.max(-20, Math.min(25, indexChange * 10)) + Math.min(18, limitUp / 5) - Math.min(15, limitDown / 2);
  if (hotBoard) score += 8;
  if (hotUp >= 80) score += 6;
  if (type === "close") score += positionPct() < 45 ? 3 : -4;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function auctionText(type, score) {
  const board = topBoardText();
  const indexText = pct(marketAverageIndexChange());
  const limitUp = Number(account.marketInfo?.limitUpCount || account.moodDetail?.limitUpCount || 0);
  const limitDown = Number(account.marketInfo?.limitDownCount || 0);
  if (!account.marketInfo?.ok) return "等待实时盘面、指数和板块数据后再判断。";
  if (type === "open") {
    if (score >= 75) return `早盘竞价可积极观察。指数均值 ${indexText}，涨停 ${limitUp}，跌停 ${limitDown}，主线 ${board}，重点看竞价高开后是否有承接。`;
    if (score >= 55) return `早盘竞价偏中性。指数均值 ${indexText}，主线 ${board}，只看放量承接和回踩不破，不急着追。`;
    return `早盘竞价偏弱。指数均值 ${indexText}，跌停 ${limitDown}，先控制仓位，等开盘后确认承接。`;
  }
  if (score >= 75) return `尾盘竞价可保留强势仓位。主线 ${board}，涨停 ${limitUp}，若个股不破均价且板块未退潮，可继续持有。`;
  if (score >= 55) return `尾盘竞价以筛选为主。主线 ${board}，指数均值 ${indexText}，只处理指标转弱或板块掉队的持仓。`;
  return `尾盘竞价偏防守。指数均值 ${indexText}，跌停 ${limitDown}，优先降低弱势股，少开新仓。`;
}

function renderAuctionAnalysis() {
  const updated = document.getElementById("auctionUpdatedAt");
  if (!updated) return;
  const openScore = auctionScore("open");
  const closeScore = auctionScore("close");
  updated.textContent = account.marketInfo?.ok ? `基于 ${account.marketInfo.updatedAt} 盘面推理` : "等待盘面数据";
  document.getElementById("openAuctionScore").textContent = account.marketInfo?.ok ? openScore : "--";
  document.getElementById("closeAuctionScore").textContent = account.marketInfo?.ok ? closeScore : "--";
  document.getElementById("openAuctionText").textContent = auctionText("open", openScore);
  document.getElementById("closeAuctionText").textContent = auctionText("close", closeScore);
}

function afterCloseKey() {
  return `after-close-${todayIso()}`;
}

function shouldAutoRunAfterClose() {
  const now = new Date();
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return day >= 1 && day <= 5 && minutes >= 15 * 60 + 5;
}

async function runAfterCloseAnalysis(options = {}) {
  const status = document.getElementById("afterCloseUpdatedAt");
  if (status) status.textContent = "正在分析盘面和消息面";
  try {
    const response = await fetch("/api/after-close", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const report = await response.json();
    if (!report.ok) throw new Error((report.errors || ["after-close empty"]).join("；"));
    account.afterCloseReport = {
      ...report,
      key: afterCloseKey(),
    };
    saveAccount();
    renderAfterCloseAnalysis();
  } catch (error) {
    if (status) status.textContent = `分析失败，保留上一份：${error.message}`;
    if (!options.silent) alert(`盘后分析失败：${error.message}`);
  }
}

function autoRunAfterCloseAnalysis() {
  if (!shouldAutoRunAfterClose()) {
    renderAfterCloseAnalysis();
    return;
  }
  if (account.afterCloseReport?.key === afterCloseKey()) {
    renderAfterCloseAnalysis();
    return;
  }
  runAfterCloseAnalysis({ silent: true });
}

function renderAfterCloseAnalysis() {
  const report = account.afterCloseReport;
  const updated = document.getElementById("afterCloseUpdatedAt");
  if (!updated) return;
  if (!report) {
    updated.textContent = "交易日 15:05 后自动生成";
    document.getElementById("afterCloseConclusion").textContent = "等待收盘分析";
    document.getElementById("afterCloseSummary").textContent = "交易日 15:05 后会自动分析盘面、国内政策、海外局势、油价和金价。";
    document.getElementById("domesticNewsList").innerHTML = "<small>等待国内消息数据</small>";
    document.getElementById("globalNewsList").innerHTML = "<small>等待国际和商品数据</small>";
    document.getElementById("afterClosePlanList").innerHTML = "<small>等待收盘后生成计划</small>";
    return;
  }
  updated.textContent = `${report.generatedAt} · ${report.sources?.join(" + ") || "公开数据源"}`;
  document.getElementById("afterCloseConclusion").textContent = `明日环境：${report.conclusion}`;
  document.getElementById("afterCloseSummary").textContent = report.summary || "盘后数据已更新。";
  document.getElementById("domesticNewsList").innerHTML = renderNewsRows(report.domesticNews, "暂无国内政策消息");
  document.getElementById("globalNewsList").innerHTML = renderGlobalRows(report.globalNews, report.globalQuotes);
  document.getElementById("afterClosePlanList").innerHTML = renderTextRows([...(report.nextPlan || []), ...(report.risks || []).slice(0, 2)], "等待明日计划");
}

function renderNewsRows(items, emptyText) {
  if (!Array.isArray(items) || !items.length) return `<small>${emptyText}</small>`;
  return items.slice(0, 6).map((item) => `
    <div class="mini-row">
      <span>${item.title || item}</span>
      <small>${item.source || ""} ${item.time || ""}</small>
    </div>
  `).join("");
}

function renderGlobalRows(news, quotes) {
  const quoteRows = Array.isArray(quotes) ? quotes.slice(0, 5).map((item) => ({
    title: `${item.name || item.symbol} ${Number.isFinite(Number(item.changePct)) ? pct(Number(item.changePct)) : "--"}`,
    source: item.source || "",
    time: "",
  })) : [];
  const rows = [...quoteRows, ...(Array.isArray(news) ? news : [])];
  return renderNewsRows(rows, "暂无国际和商品数据");
}

function renderTextRows(items, emptyText) {
  if (!Array.isArray(items) || !items.length) return `<small>${emptyText}</small>`;
  return items.slice(0, 8).map((text) => `
    <div class="mini-row">
      <span>${text}</span>
    </div>
  `).join("");
}

function renderTrades(type, targetId) {
  const trades = getOperationTrades(type);
  document.getElementById(targetId).innerHTML = trades.length
    ? trades.map((trade) => `
      <div class="trade-item">
        <strong><span>${trade.name}</span><span>${formatTradeStamp(trade)}</span></strong>
        <small>${trade.reason} · ${trade.shares} 股 · ¥${money(trade.amount)}${trade.fee ? ` · 手续费 ¥${money(trade.fee)}` : ""}</small>
      </div>
    `).join("")
    : `<div class="trade-item"><small>今日暂无${type === "BUY" ? "买入" : "卖出"}</small></div>`;
}

function renderHistoryTrades() {
  const list = document.getElementById("historyTradeList");
  if (!account.trades.length) {
    list.innerHTML = `<div class="trade-item"><small>暂无历史成交。</small></div>`;
    return;
  }
  const term = document.getElementById("historyTradeSearch")?.value.trim() || "";
  list.innerHTML = account.trades
    .slice()
    .filter((trade) => !term || trade.code.includes(term) || trade.name.includes(term))
    .sort((a, b) => tradeOrderValue(b) - tradeOrderValue(a))
    .map((trade) => {
      const side = trade.type === "BUY" ? "买入" : "卖出";
      const pnlText = trade.type === "SELL" && typeof trade.pnl === "number" ? ` · 盈亏 ${trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)}` : "";
      return `
        <div class="trade-item">
          <strong><span>${side} ${trade.name}</span><span>${formatTradeStamp(trade)}</span></strong>
          <small>${trade.code} · ${trade.shares} 股 · ${trade.price.toFixed(3)} · 手续费 ¥${money(trade.fee || 0)}${pnlText}</small>
        </div>
      `;
    })
    .join("") || `<div class="trade-item"><small>没有匹配的历史成交。</small></div>`;
}

function renderHoldings() {
  const list = document.getElementById("holdingList");
  if (!account.positions.length) {
    list.innerHTML = `<div class="holding-item"><small>当前空仓，等待 AI 信号或手动下单。</small></div>`;
    return;
  }
  list.innerHTML = account.positions.map((position) => {
    const gain = ((position.price - position.avgCost) / position.avgCost) * 100;
    const buyPrice = avgBuyPriceForCode(position.code, position.avgCost);
    const lotsText = buyLotsTextForCode(position.code);
    const buyLabel = lotsText ? "均买价" : "买入价";
    const lotDetail = lotsText ? ` · 分笔 ${lotsText}` : "";
    return `
      <article class="holding-item">
        <div class="holding-main">
          <div class="holding-top">
            <strong>${position.name} <small>${position.code}${position.isLimitUp ? " · 涨停" : ""}</small></strong>
            <strong class="${gain >= 0 ? "profit" : "loss"}">${pct(gain)}</strong>
          </div>
          <small class="holding-detail">${position.theme} · ${position.shares} 股 · ${buyLabel} ${buyPrice.toFixed(3)}${lotDetail} · 含费成本 ${position.avgCost.toFixed(3)} · 现价 ${position.price.toFixed(2)}${position.changePct ? ` · 涨跌 ${pct(position.changePct)}` : ""} · 计划持有 ${position.targetHoldDays || 3} 天${position.holdReason ? ` · ${position.holdReason}` : ""}</small>
        </div>
        <button class="sell-button" type="button" data-sell="${position.code}">卖出</button>
      </article>
    `;
  }).join("");
}

function buyLotsForCode(code) {
  return account.trades
    .filter((trade) => trade.type === "BUY" && trade.code === code)
    .sort((a, b) => tradeOrderValue(a) - tradeOrderValue(b))
    .map((trade) => ({
      price: Number(trade.price || 0),
      shares: Number(trade.shares || 0),
    }))
    .filter((lot) => lot.price > 0 && lot.shares > 0);
}

function buyLotsTextForCode(code) {
  const lots = buyLotsForCode(code);
  if (lots.length <= 1) return "";
  return lots.map((lot) => `${lot.price.toFixed(3)}×${lot.shares}股`).join(" / ");
}

function buyFeeForCode(code) {
  return account.trades
    .filter((trade) => trade.type === "BUY" && trade.code === code)
    .reduce((sum, trade) => sum + Number(trade.fee || 0), 0);
}

function buyStatsForCode(code) {
  return account.trades
    .filter((trade) => trade.type === "BUY" && trade.code === code)
    .reduce((stats, trade) => {
      const shares = Number(trade.shares || 0);
      const gross = Number(trade.price || 0) * shares;
      stats.shares += shares;
      stats.gross += gross;
      stats.fee += Number(trade.fee || 0);
      return stats;
    }, { shares: 0, gross: 0, fee: 0 });
}

function avgBuyPriceForCode(code, fallback = 0) {
  const stats = buyStatsForCode(code);
  return stats.shares ? stats.gross / stats.shares : fallback;
}

function feeDetailText(detail) {
  if (!detail) return "无明细";
  const parts = [
    `佣金${yuan(detail.commission)}`,
    `过户${yuan(detail.transfer)}`,
    `经手${yuan(detail.handling)}`,
    `证管${yuan(detail.supervision)}`,
  ];
  if (Number(detail.stampDuty || 0) > 0) parts.push(`印花税${yuan(detail.stampDuty)}`);
  return parts.join(" / ");
}

function mergedFeeDetailForCode(code) {
  return account.trades
    .filter((trade) => trade.type === "BUY" && trade.code === code)
    .reduce((merged, trade) => {
      const detail = trade.feeDetail || {};
      merged.commission += Number(detail.commission || 0);
      merged.transfer += Number(detail.transfer || 0);
      merged.handling += Number(detail.handling || 0);
      merged.supervision += Number(detail.supervision || 0);
      merged.stampDuty += Number(detail.stampDuty || 0);
      return merged;
    }, { commission: 0, transfer: 0, handling: 0, supervision: 0, stampDuty: 0 });
}

function realizedClosedPositions() {
  const lotsByCode = new Map();
  const closed = [];
  [...account.trades]
    .sort((a, b) => tradeOrderValue(a) - tradeOrderValue(b))
    .forEach((trade) => {
      const shares = Number(trade.shares || 0);
      const gross = Number(trade.price || 0) * shares;
      if (!shares || !gross) return;
      if (trade.type === "BUY") {
        const feeDetail = calcFees(gross, "BUY");
        const lots = lotsByCode.get(trade.code) || [];
        lots.push({
          shares,
          cost: gross + feeDetail.total,
          feeDetail,
        });
        lotsByCode.set(trade.code, lots);
        return;
      }
      if (trade.type !== "SELL") return;
      const lots = lotsByCode.get(trade.code) || [];
      const sellFeeDetail = calcFees(gross, "SELL");
      let remaining = shares;
      let buyCost = 0;
      const buyFeeDetail = { commission: 0, transfer: 0, handling: 0, supervision: 0, stampDuty: 0 };
      while (remaining > 0 && lots.length) {
        const lot = lots[0];
        const used = Math.min(remaining, lot.shares);
        const ratio = used / lot.shares;
        buyCost += lot.cost * ratio;
        buyFeeDetail.commission += lot.feeDetail.commission * ratio;
        buyFeeDetail.transfer += lot.feeDetail.transfer * ratio;
        buyFeeDetail.handling += lot.feeDetail.handling * ratio;
        buyFeeDetail.supervision += lot.feeDetail.supervision * ratio;
        buyFeeDetail.stampDuty += lot.feeDetail.stampDuty * ratio;
        lot.cost -= lot.cost * ratio;
        lot.shares -= used;
        remaining -= used;
        if (lot.shares <= 0) lots.shift();
      }
      const proceeds = gross - sellFeeDetail.total;
      closed.push({
        code: trade.code,
        name: trade.name,
        shares,
        buyPrice: shares ? buyCost / shares : 0,
        sellPrice: trade.price,
        fee: sellFeeDetail.total + buyFeeDetail.commission + buyFeeDetail.transfer + buyFeeDetail.handling + buyFeeDetail.supervision + buyFeeDetail.stampDuty,
        feeDetail: {
          commission: sellFeeDetail.commission + buyFeeDetail.commission,
          transfer: sellFeeDetail.transfer + buyFeeDetail.transfer,
          handling: sellFeeDetail.handling + buyFeeDetail.handling,
          supervision: sellFeeDetail.supervision + buyFeeDetail.supervision,
          stampDuty: sellFeeDetail.stampDuty + buyFeeDetail.stampDuty,
        },
        pnl: proceeds - buyCost,
        date: trade.date || `Day ${trade.day}`,
      });
    });
  return closed.reverse();
}

function renderPositionQueries() {
  const openTerm = document.getElementById("openPositionSearch").value.trim();
  const closedTerm = document.getElementById("closedPositionSearch").value.trim();
  const openItems = account.positions.filter((item) => !openTerm || item.code.includes(openTerm) || item.name.includes(openTerm));
  const closedItems = realizedClosedPositions().filter((item) => !closedTerm || item.code.includes(closedTerm) || item.name.includes(closedTerm));
  document.getElementById("openPositionQueryList").innerHTML = openItems.length
    ? openItems.map((item) => {
      const marketValue = item.price * item.shares;
      const cost = item.avgCost * item.shares;
      const pnl = marketValue - cost;
      const buyPrice = avgBuyPriceForCode(item.code, item.avgCost);
      const lotsText = buyLotsTextForCode(item.code);
      const buyLabel = lotsText ? "均买价" : "买入价";
      return `
        <article class="query-item">
          <strong>${item.name} ${item.code}</strong>
          <div class="query-grid">
            <span>${buyLabel}<b>${buyPrice.toFixed(3)}</b></span>
            ${lotsText ? `<span>分笔买入<b>${lotsText}</b></span>` : ""}
            <span>含费成本价<b>${item.avgCost.toFixed(3)}</b></span>
            <span>费用合计<b>${yuan(buyFeeForCode(item.code))} 元</b></span>
            <span>当前价格<b>${item.price.toFixed(2)}</b></span>
            <span>当前市值<b>${yuan(marketValue)} 元</b></span>
            <span>股票收益<b class="${pnl >= 0 ? "profit" : "loss"}">${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} 元</b></span>
          </div>
          <small>${feeDetailText(mergedFeeDetailForCode(item.code))}</small>
        </article>
      `;
    }).join("")
    : `<article class="query-item"><small>没有匹配的现有持仓。</small></article>`;
  document.getElementById("closedPositionQueryList").innerHTML = closedItems.length
    ? closedItems.map((item) => `
      <article class="query-item">
        <strong>${item.name} ${item.code}</strong>
        <div class="query-grid">
          <span>清仓数量<b>${item.shares} 股</b></span>
          <span>买入价格<b>${item.buyPrice.toFixed(3)}</b></span>
          <span>卖出价格<b>${Number(item.sellPrice).toFixed(3)}</b></span>
          <span>费用合计<b>${yuan(item.fee)} 元</b></span>
          <span>已实现收益<b class="${item.pnl >= 0 ? "profit" : "loss"}">${item.pnl >= 0 ? "+" : ""}${item.pnl.toFixed(2)} 元</b></span>
        </div>
        <small>${feeDetailText(item.feeDetail)}</small>
      </article>
    `).join("")
    : `<article class="query-item"><small>没有匹配的已清仓股票。</small></article>`;
}

function renderCandidates() {
  if (!latestCandidates.length) buildBafeiteCandidates();
  document.getElementById("candidateList").innerHTML = latestCandidates.map((stock) => {
    const source = stock.dynamicSource || "观察池";
    const technical = stock.technical?.label ? ` · ${stock.technical.label}` : "";
    return `
      <article class="candidate-item">
        <div>
          <strong>${stock.name} <small>${stock.code}</small></strong>
          <small>${stock.theme} · ${source} · 参考价 ${stock.price.toFixed(2)} · ${stock.trigger}</small>
          <small>${stock.riskCheck} · 置信度 ${stock.confidence}${technical}</small>
        </div>
        <span class="candidate-score">${stock.score}</span>
      </article>
    `;
  }).join("");
}

function render() {
  syncAccountDateToToday();
  const equity = totalEquity();
  const ret = returnRate();
  const posPct = positionPct();
  document.getElementById("setupPanel").style.display = account.started ? "none" : "block";
  document.getElementById("runStatus").textContent = account.started
    ? `已启动：初始资金 ${money(account.initialCash)} 元，可用现金 ${money(account.cash)} 元，bafeite 进攻模式运行中。`
    : "未启动：请先设置初始资金。";
  document.getElementById("quoteStatus").textContent = `行情状态：${account.quoteStatus || "等待刷新"}`;
  const session = getTradeSession();
  document.getElementById("aiTradeBtn").disabled = !account.started;
  document.getElementById("autoTradeBtn").disabled = !session.canTrade;
  document.getElementById("buyBtn").disabled = !session.canTrade;
  document.querySelectorAll(".sell-button").forEach((button) => {
    button.disabled = !session.canTrade;
  });
  renderQuoteTimer();
  document.getElementById("localSaveStatus").textContent = savedAtText();
  document.getElementById("dayCount").textContent = account.day;
  document.getElementById("heroDay").textContent = account.day;
  document.getElementById("tradeDate").textContent = currentDateText();
  document.getElementById("totalProfit").textContent = yuan(equity - account.initialCash);
  document.getElementById("returnRate").textContent = pct(ret);
  document.getElementById("returnRate").className = ret >= 0 ? "profit" : "loss";
  document.getElementById("holdingCount").textContent = `${account.positions.length}只`;
  document.getElementById("holdingTitleCount").textContent = account.positions.length;
  document.getElementById("moodScore").textContent = account.mood;
  document.getElementById("moodLabel").textContent = account.mood >= 70 ? "高涨" : account.mood >= 45 ? "修复" : "低迷";
  document.getElementById("moodBreadth").textContent = account.moodDetail?.ok
    ? `阳 ${account.moodDetail.yangPct}% / 阴 ${account.moodDetail.yinPct}% · ${account.moodDetail.provider}`
    : "等待实时盘面推理";
  document.getElementById("positionPct").textContent = `${posPct.toFixed(0)}%`;
  document.getElementById("positionBar").style.width = `${Math.min(100, posPct)}%`;
  document.getElementById("availableCash").textContent = money(account.cash);
  document.getElementById("aiComment").textContent = account.comment;
  document.getElementById("buyCount").textContent = getOperationTrades("BUY").length;
  document.getElementById("sellCount").textContent = getOperationTrades("SELL").length;
  document.getElementById("initialCash").value = account.initialCash;
  document.getElementById("maxPositionPct").value = account.maxPositionPct;
  renderMarketInfo();
  renderAfterCloseAnalysis();
  renderTrades("BUY", "buyList");
  renderTrades("SELL", "sellList");
  renderHistoryTrades();
  renderHoldings();
  renderPositionQueries();
  renderCandidates();
  renderRoute();
}

function wireEvents() {
  document.getElementById("startBtn").addEventListener("click", startAccount);
  document.getElementById("resetBtn").addEventListener("click", openResetModal);
  document.getElementById("cancelResetBtn").addEventListener("click", closeResetModal);
  document.getElementById("confirmResetBtn").addEventListener("click", () => {
    closeResetModal();
    resetAccount();
  });
  document.getElementById("resetModal").addEventListener("click", (event) => {
    if (event.target.id === "resetModal") closeResetModal();
  });
  document.getElementById("aiTradeBtn").addEventListener("click", aiTradeNow);
  document.getElementById("autoTradeBtn").addEventListener("click", autoTradeDay);
  document.getElementById("refreshQuotesBtn").addEventListener("click", manualRefreshRealtime);
  document.getElementById("afterCloseBtn").addEventListener("click", () => runAfterCloseAnalysis());
  document.getElementById("refreshCandidatesBtn").addEventListener("click", async () => {
    account.quoteStatus = "正在刷新热门板块、成交额前排和日K评分";
    render();
    if (shouldSyncRealtime()) await refreshMarketInfo({ silent: true });
    await refreshCandidateQuotes();
    renderCandidates();
  });
  document.getElementById("exportBtn").addEventListener("click", exportReport);
  document.getElementById("backupBtn").addEventListener("click", exportBackup);
  document.getElementById("restoreBtn").addEventListener("click", restoreLatestDatabaseBackup);
  document.getElementById("portableBtn").addEventListener("click", exportPortablePackage);
  document.getElementById("restoreInput").addEventListener("change", (event) => {
    restoreBackup(event.target.files[0]);
  });
  document.getElementById("openOrderBtn").addEventListener("click", () => {
    document.getElementById("orderForm").classList.toggle("open");
  });
  document.getElementById("buyBtn").addEventListener("click", manualBuy);
  document.getElementById("openPositionSearch").addEventListener("input", renderPositionQueries);
  document.getElementById("closedPositionSearch").addEventListener("input", renderPositionQueries);
  document.querySelectorAll("[data-query-open]").forEach((button) => {
    button.addEventListener("click", () => openQueryPage(button.dataset.queryOpen));
  });
  document.querySelectorAll("[data-query-tab]").forEach((button) => {
    button.addEventListener("click", () => openQueryPage(button.dataset.queryTab));
  });
  document.getElementById("queryBackBtn").addEventListener("click", closeQueryPage);
  document.getElementById("openHistoryBtn").addEventListener("click", openHistoryPage);
  document.getElementById("historyBackBtn").addEventListener("click", closeQueryPage);
  document.getElementById("openCandidatesBtn").addEventListener("click", openCandidatePage);
  document.getElementById("candidateBackBtn").addEventListener("click", closeQueryPage);
  document.getElementById("historyTradeSearch").addEventListener("input", renderHistoryTrades);
  window.addEventListener("hashchange", renderRoute);
  document.getElementById("holdingList").addEventListener("click", (event) => {
    const code = event.target.dataset.sell;
    if (!code) return;
    sellStock(code, "人工卖出");
    saveAccount();
    render();
  });
}

importHistoricalTradesOnce();
enforceHuaanClosedOnce();
migrateSimulationCapital30000Once();
importNearCloseBafeiteBuysOnce();
importFoxconnCloseBuyOnce();
correctFoxconnCloseBuyDateOnce();
removeSameDayFiberhomeRebuyOnce();
addUserCapital5000Once();
importJushiTailBuyOnce();
importZteTailTopUpOnce();
migrateTailBuysTo300SharesOnce();
migrateFeesByRuleOnce();
revertForcedTailTopUpOnce();
recalculateAccountLedger();
syncAccountDateToToday();
wireEvents();
render();
persistAccountToDatabase(account, false);
if (shouldSyncRealtime()) refreshMarketInfo();
else loadPausedMarketSnapshotIfNeeded();
autoRefreshQuotesOnLoad();
startQuoteAutoRefresh();
autoRunAfterCloseAnalysis();
