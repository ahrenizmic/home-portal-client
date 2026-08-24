// ── Откуда качаем данные (Pages репозитория с данными) ──
const DATA_BASE = "https://ahrenizmic.github.io/home-portal-data";
const enc = new TextEncoder();
const dec = new TextDecoder();

// "Сегодня" — реальная дата устройства в формате YYYY-MM-DD.
// toLocaleDateString("sv-SE") даёт ISO-формат в ЛОКАЛЬНОЙ зоне.
// НЕ используем toISOString() — он вернул бы дату в UTC и мог сдвинуть день.
const TODAY = new Date().toLocaleDateString("sv-SE");

// ── Вывод ключа: зеркально plugin.deriveKey ──
async function deriveKey(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 250000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]                 // ← только decrypt: клиент не шифрует
  );
}

// ── base64 → байты: зеркально btoa(...) в plugin.prepareKey ──
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ArrayBuffer/Uint8Array → base64-строка (для хранения в localStorage)
function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ── Расшифровать пакет [iv(12)][ciphertext] данным ключом ──
async function decryptPacked(buffer, key) {
  const packed = new Uint8Array(buffer);
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const plainBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv }, key, ciphertext
  );
  return dec.decode(plainBytes);
}

function setupTabs() {
  const tabTasks = document.getElementById("tab-tasks");
  const tabCalendar = document.getElementById("tab-calendar");
  const screenTasks = document.getElementById("screen-tasks");
  const screenCalendar = document.getElementById("screen-calendar");

  tabTasks.addEventListener("click", () => {
    screenTasks.style.display = "block";
    screenCalendar.style.display = "none";
    tabTasks.classList.add("active");
    tabCalendar.classList.remove("active");
  });

  tabCalendar.addEventListener("click", () => {
    screenTasks.style.display = "none";
    screenCalendar.style.display = "block";
    tabCalendar.classList.add("active");
    tabTasks.classList.remove("active");
  });
}

// ── Собрать задачи "due <= сегодня, todo" из всех проектов ──
function collectDueTasks(bundle, today) {
  const horizon = addDays(today, 14);              // граница "ближайших 2 недель" включительно
  const result = [];
  for (const entity of bundle.entities) {
    if (entity.type !== "project") continue;
    for (const task of entity.tasks) {
      if (task.status !== "todo") continue;
      if (task.due === null) continue;
      if (task.due > horizon) continue;            // дальше 2 недель — не берём

      // класс задачи: overdue / today / future
      let group;
      if (task.due < today) group = "overdue";
      else if (task.due === today) group = "today";
      else group = "future";                       // today < due <= horizon

      result.push({
        text: task.text,
        due: task.due,
        priority: task.priority,
        project: entity.title,
        group,
      });
    }
  }
  result.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return result;
}

// Прибавить N дней к дате "YYYY-MM-DD", вернуть тоже "YYYY-MM-DD".
// Парсим числами (локальная зона), не через new Date(строка) — тот трактует дефисы как UTC.
function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);        // локальная полночь, m-1 т.к. месяцы 0-11
  dt.setDate(dt.getDate() + days);         // setDate корректно переносит через границы месяцев
  // обратно в YYYY-MM-DD (локально), padStart для ведущих нулей
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Дата "YYYY-MM-DD" → "20 августа 2026". Год показываем всегда.
// Парсим числами (new Date(y, m-1, d)) — локально, без UTC-ловушки.
function formatHuman(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function renderFutureGrouped(container, tasks) {
  if (tasks.length === 0) return;

  // заголовок группы
  const header = document.createElement("h2");
  header.textContent = "В ближайшие 2 недели";
  header.className = "group-header";
  container.appendChild(header);

  // сгруппировать задачи по due (tasks уже отсортированы по due в collectDueTasks)
  const byDate = new Map();                       // "2026-08-20" -> [задачи]
  for (const t of tasks) {
    if (!byDate.has(t.due)) byDate.set(t.due, []);
    byDate.get(t.due).push(t);
  }

  // для каждой даты — сворачиваемая подгруппа
  for (const [due, dateTasks] of byDate) {
    // заголовок подгруппы (кликабельный)
    const sub = document.createElement("div");
    sub.className = "subgroup-header collapsed";   // по умолчанию свёрнуто
    sub.textContent = `▸ ${formatHuman(due)} (${dateTasks.length})`;

    // контейнер с задачами этой даты (скрыт по умолчанию)
    const body = document.createElement("div");
    body.className = "subgroup-body";
    body.style.display = "none";                   // свёрнуто
    for (const t of dateTasks) {
      const div = document.createElement("div");
      div.className = "task future";
      const textEl = document.createElement("div");
      textEl.className = "task-text";
      textEl.textContent = t.text;
      const projEl = document.createElement("div");
      projEl.className = "task-project";
      projEl.textContent = t.project;
      div.append(textEl, projEl);                  // дату НЕ дублируем — она в заголовке подгруппы
      body.appendChild(div);
    }

    // клик по заголовку — свернуть/развернуть
    sub.addEventListener("click", () => {
      const isCollapsed = body.style.display === "none";
      body.style.display = isCollapsed ? "block" : "none";
      sub.textContent = `${isCollapsed ? "▾" : "▸"} ${formatHuman(due)} (${dateTasks.length})`;
    });

    container.appendChild(sub);
    container.appendChild(body);
  }
}

// ── Отрисовать список задач ──
function renderTasks(tasks) {
  const list = document.getElementById("list");
  list.innerHTML = "";

  const overdue = tasks.filter(t => t.group === "overdue");
  const todayTasks = tasks.filter(t => t.group === "today");
  const future = tasks.filter(t => t.group === "future");

  document.getElementById("status").textContent =
    `Просрочено: ${overdue.length} · На сегодня: ${todayTasks.length} · Ближайшие 2 недели: ${future.length}`;

  if (tasks.length === 0) {
    list.innerHTML = "<p>Нет задач 🎉</p>";
    return;
  }

  renderGroup(list, "Просрочено", overdue, "overdue", true);
  renderGroup(list, "На сегодня", todayTasks, "today", false);
  renderFutureGrouped(list, future);              // ← вместо renderGroup для будущего
}

function renderGroup(container, title, tasks, cls, showDate) {
  if (tasks.length === 0) return;
  const header = document.createElement("h2");
  header.textContent = title;
  header.className = "group-header";
  container.appendChild(header);
  for (const t of tasks) {
    const div = document.createElement("div");
    div.className = `task ${cls}`;

    if (showDate) {                              // ← дату рисуем только если просили
      const dueEl = document.createElement("div");
      dueEl.className = "task-due";
      dueEl.textContent = formatHuman(t.due);    // ← человеческий формат
      div.appendChild(dueEl);
    }

    const textEl = document.createElement("div");
    textEl.className = "task-text";
    textEl.textContent = t.text;
    const projEl = document.createElement("div");
    projEl.className = "task-project";
    projEl.textContent = t.project;
    div.append(textEl, projEl);                  // дата уже добавлена выше (если была)
    container.appendChild(div);
  }
}

async function loadAndShow(password) {
  const status = document.getElementById("status");
  const list = document.getElementById("list");
  list.innerHTML = "";
  status.textContent = "Загрузка...";
  status.className = "";
  document.getElementById("today").textContent = `Сегодня: ${TODAY}`;

  try {
    const keyparams = await (await fetch(`${DATA_BASE}/keyparams.json`)).json();
    const salt = base64ToBytes(keyparams.salt);
    const key = await deriveKey(password, salt);          // ОДИН вывод ключа

    // ── Б1: читаем manifest тем же ключом ──
    const manifestBuffer = await (await fetch(`${DATA_BASE}/manifest`)).arrayBuffer();
    const manifestText = await decryptPacked(manifestBuffer, key);
    const manifest = JSON.parse(manifestText);

    // ── Б2: data из кэша или из сети, по publishId ──
    const savedId = localStorage.getItem("hp_publishId");
    const savedData = localStorage.getItem("hp_data");
    let dataBuffer;

    if (manifest.publishId === savedId && savedData) {
      // id совпал И кэш есть → берём из кэша, сеть НЕ трогаем
      dataBuffer = base64ToBytes(savedData).buffer;
    } else {
      // изменилось / первый раз / кэша нет → качаем из сети
      dataBuffer = await (await fetch(`${DATA_BASE}/data`)).arrayBuffer();
      // сохраняем: СНАЧАЛА data, ПОТОМ id (печать актуальности — последней)
      localStorage.setItem("hp_data", bytesToBase64(dataBuffer));
      localStorage.setItem("hp_publishId", manifest.publishId);
    }

    // расшифровка — общая для обоих путей
    let bundle;
    try {
      const bundleText = await decryptPacked(dataBuffer, key);
      bundle = JSON.parse(bundleText);
    } catch (e) {
      // Ловушка №2: кэш подвёл (битый) → откат в сеть
      dataBuffer = await (await fetch(`${DATA_BASE}/data`)).arrayBuffer();
      localStorage.setItem("hp_data", bytesToBase64(dataBuffer));
      localStorage.setItem("hp_publishId", manifest.publishId);
      const bundleText = await decryptPacked(dataBuffer, key);
      bundle = JSON.parse(bundleText);
    }

    // --- НОВОЕ: фильтр и отрисовка ---
    const tasks = collectDueTasks(bundle, TODAY);
    status.textContent = `Задач на сегодня и просроченных: ${tasks.length}`;
    renderTasks(tasks);
    document.getElementById("app").style.display = "block";
  } catch (err) {
    status.textContent = "Ошибка: неверный пароль или данные повреждены";
    status.className = "error";
    console.error(err);
  }
}

setupTabs();

document.getElementById("loadBtn").addEventListener("click", () => {
  loadAndShow(document.getElementById("password").value);
});