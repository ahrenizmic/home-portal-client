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
  const result = [];
  for (const entity of bundle.entities) {
    if (entity.type !== "project") continue;        // события пропускаем
    for (const task of entity.tasks) {
      if (task.status !== "todo") continue;         // только невыполненные
      if (task.due === null) continue;              // без срока — не показываем
      if (task.due > today) continue;               // будущее — не показываем
      result.push({
        text: task.text,
        due: task.due,
        priority: task.priority,
        project: entity.title,
      });
    }
  }
  // сортировка по due (строки ISO): просрочка всплывает наверх
  result.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return result;
}

// ── Отрисовать список задач ──
function renderTasks(tasks) {
  const list = document.getElementById("list");
  list.innerHTML = "";
  if (tasks.length === 0) {
    list.innerHTML = "<p>Нет задач на сегодня 🎉</p>";
    return;
  }
  for (const t of tasks) {
    const div = document.createElement("div");
    div.className = "task";
    div.innerHTML =
      `<div class="task-due">${t.due}</div>` +
      `<div class="task-text">${t.text}</div>` +
      `<div class="task-project">${t.project}</div>`;
    list.appendChild(div);
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