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

  renderGroup(list, "Просрочено", overdue, "overdue");
  renderGroup(list, "На сегодня", todayTasks, "today");
  renderGroup(list, "В ближайшие 2 недели", future, "future");
}

function renderGroup(container, title, tasks, cls) {
  if (tasks.length === 0) return;                  // пустую группу не рисуем
  const header = document.createElement("h2");
  header.textContent = title;
  header.className = "group-header";
  container.appendChild(header);
  for (const t of tasks) {
    const div = document.createElement("div");
    div.className = `task ${cls}`;
    const dueEl = document.createElement("div");
    dueEl.className = "task-due";
    dueEl.textContent = t.due;
    const textEl = document.createElement("div");
    textEl.className = "task-text";
    textEl.textContent = t.text;                   // ← textContent, не innerHTML
    const projEl = document.createElement("div");
    projEl.className = "task-project";
    projEl.textContent = t.project;
    div.append(dueEl, textEl, projEl);
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
    // --- расшифровка (без изменений, доказано) ---
    const keyparams = await (await fetch(`${DATA_BASE}/keyparams.json`)).json();
    const dataBuffer = await (await fetch(`${DATA_BASE}/data`)).arrayBuffer();
    const salt = base64ToBytes(keyparams.salt);
    const key = await deriveKey(password, salt);
    const bundleText = await decryptPacked(dataBuffer, key);
    const bundle = JSON.parse(bundleText);

    // --- НОВОЕ: фильтр и отрисовка ---
    const tasks = collectDueTasks(bundle, TODAY);
    status.textContent = `Задач на сегодня и просроченных: ${tasks.length}`;
    renderTasks(tasks);
  } catch (err) {
    status.textContent = "Ошибка: неверный пароль или данные повреждены";
    status.className = "error";
    console.error(err);
  }
}

document.getElementById("loadBtn").addEventListener("click", () => {
  loadAndShow(document.getElementById("password").value);
});