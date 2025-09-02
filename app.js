// Инициализация SDK
const tg = window.Telegram?.WebApp;
tg?.expand(); // делает экран высоким
tg?.ready();

// Тема из Telegram
document.documentElement.style.setProperty(
  "--tg-bg",
  tg?.themeParams?.bg_color || "#0b0f15"
);
document.documentElement.style.setProperty(
  "--tg-text",
  tg?.themeParams?.text_color || "#eaf1fb"
);

// Обработчик
document.getElementById("send").addEventListener("click", () => {
  const payload = {
    name: document.getElementById("name").value?.trim(),
    plan: document.getElementById("plan").value,
    initData: tg?.initData || null,      // при необходимости проверки на бэке
    initDataUnsafe: tg?.initDataUnsafe || null
  };
  // Отправляем строку в бота
  tg.sendData(JSON.stringify(payload));
  tg.close(); // закрыть мини-апп
});
