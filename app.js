// ── Откуда качаем данные (Pages репозитория с данными) ──
const DATA_BASE = "https://ahrenizmic.github.io/home-portal-data";
const enc = new TextEncoder();
const dec = new TextDecoder();

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

async function loadAndShow(password) {
  const status = document.getElementById("status");
  const raw = document.getElementById("raw");
  raw.textContent = "";
  status.textContent = "Загрузка...";
  status.className = "";

  try {
    // 1. keyparams (открытый JSON — парсим сразу)
    const keyparams = await (await fetch(`${DATA_BASE}/keyparams.json`)).json();

    // 2. data (зашифрованный бинарь — сначала arrayBuffer, потом расшифровка)
    const dataBuffer = await (await fetch(`${DATA_BASE}/data`)).arrayBuffer();

    // 3. Ключ из пароля и соли
    const salt = base64ToBytes(keyparams.salt);
    const key = await deriveKey(password, salt);

    // 4. Расшифровать data
    const bundleText = await decryptPacked(dataBuffer, key);
    const bundle = JSON.parse(bundleText);

    // 5. ДИАГНОСТИКА: показать сырой bundle целиком
    status.textContent =
      `formatVersion: ${bundle.formatVersion}, ` +
      `сущностей: ${bundle.entities.length}, ` +
      `связей: ${bundle.links.length}`;
    raw.textContent = JSON.stringify(bundle, null, 2);
  } catch (err) {
    status.textContent = "Ошибка: неверный пароль или данные повреждены";
    status.className = "error";
    console.error(err);
  }
}

document.getElementById("loadBtn").addEventListener("click", () => {
  loadAndShow(document.getElementById("password").value);
});