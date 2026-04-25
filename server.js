// server.js - TensorFlow.js через CDN, БЕЗ Firebase Storage
import express from "express";
import multer from "multer";
import admin from "firebase-admin";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// === FIREBASE (только Firestore, БЕЗ Storage!) ===
const firebaseKeyPath = join(__dirname, "firebase-key.json");
if (!fs.existsSync(firebaseKeyPath)) {
  console.error("❌ Файл firebase-key.json не найден!");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(firebaseKeyPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log("✅ Firebase инициализирован (только Firestore)");

// === КЛАССЫ И ИНДЕКСЫ ===
const CLASSES = ["red", "orange", "yellow", "green"];
const INDEX_SCORES = { red: 10, orange: 7, yellow: 4, green: 1 };

// === EXPRESS ===
const app = express();
const upload = multer({ dest: join(__dirname, "uploads"), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

// Папки
const uploadsDir = join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Раздача модели Teachable Machine (для сайта)
const modelDir = join(__dirname, "teachable_machine");
if (fs.existsSync(modelDir)) {
  app.use("/teachable_machine", express.static(modelDir));
  console.log("📁 Папка модели подключена");
} else {
  console.log("⚠️ Папка teachable_machine не найдена");
}

// === ЭНДПОИНТЫ ===

// ESP32 отправляет фото и координаты
app.post("/upload", upload.single("photo"), async (req, res) => {
  let imgPath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Фото не отправлено" });
    }
    
    imgPath = req.file.path;
    const lat = req.body.lat ? parseFloat(req.body.lat) : null;
    const lng = req.body.lng ? parseFloat(req.body.lng) : null;
    
    const dataToSave = {
      gps: { lat, lng },
      time: Date.now(),
      status: "pending"
    };
    
    const docRef = await db.collection("microplastic").add(dataToSave);
    console.log(`📸 Данные сохранены: ${docRef.id}, lat=${lat}, lng=${lng}`);
    
    // Удаляем временное фото (оно не нужно)
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    
    res.json({ ok: true, id: docRef.id });
    
  } catch (err) {
    console.error("❌ Ошибка:", err);
    res.status(500).json({ error: err.message });
    if (imgPath && fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
});

// Получение данных для сайта
app.get("/data", async (req, res) => {
  try {
    const snapshot = await db.collection("microplastic").orderBy("time", "desc").limit(100).get();
    const data = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      data.push({
        id: doc.id,
        lat: d.gps?.lat,
        lng: d.gps?.lng,
        concentration: d.concentration,
        waterPollutionIndex: d.waterPollutionIndex,
        level: d.level,
        time: d.time,
        confidence: d.confidence
      });
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Обновление результата (сайт отправляет после анализа через TensorFlow.js)
app.post("/update-result", async (req, res) => {
  try {
    const { id, concentration, waterPollutionIndex, level, confidence } = req.body;
    
    await db.collection("microplastic").doc(id).update({
      concentration,
      waterPollutionIndex,
      level,
      confidence,
      status: "analyzed",
      analyzedAt: Date.now()
    });
    
    console.log(`✅ Обновлен результат: ${id} → ${level} (индекс: ${waterPollutionIndex})`);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Ошибка update-result:", err);
    res.status(500).json({ error: err.message });
  }
});

// Проверка здоровья
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("\n" + "=".repeat(50));
  console.log("🚀 СЕРВЕР ЗАПУЩЕН");
  console.log("=".repeat(50));
  console.log(`📡 Порт: ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log("=".repeat(50) + "\n");
  
  console.log("📊 Доступные эндпоинты:");
  console.log(`   GET  /health     - Проверка`);
  console.log(`   GET  /data       - Данные для сайта`);
  console.log(`   POST /upload     - ESP32 отправляет фото`);
  console.log(`   POST /update-result - Результат анализа`);
  console.log(`   GET  /teachable_machine/model.json - Модель для сайта`);
  console.log("\n" + "=".repeat(50) + "\n");
});
