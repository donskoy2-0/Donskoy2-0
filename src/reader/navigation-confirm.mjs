// One native, styleable confirmation dialog for Reader history commands.
// This is presentation-only. It never mutates Story or persists navigation intent.
const COPY = Object.freeze({
  ru: {
    eyebrow: "SYSTEM  /  NAVIGATION", cancel: "ОТМЕНА", proceed: "ПРОДОЛЖИТЬ",
    point: "Перейти к точке «{target}»?",
    rewind: "Вернуться к точке «{target}»?",
    restart: "Начать историю заново?",
    reset: "Очистить сессию и начать заново?",
    resetWarning: "Вы выйдете из текущего прохождения. Cookie и данные этого сайта будут очищены. Для нового входа потребуется подтверждение HUMAN.",
    rewindWarning: "Прогресс после выбранной точки придётся пройти заново.",
    restartWarning: "Текущий прогресс будет сброшен. Вы вернётесь к началу истории.",
    chapter: "Глава", earth: "Земля", heaven: "Небеса",
  },
  en: {
    eyebrow: "SYSTEM  /  NAVIGATION", cancel: "CANCEL", proceed: "CONTINUE",
    point: "Go to {target}?",
    rewind: "Return to {target}?",
    restart: "Restart the story?",
    reset: "Clear the session and start fresh?",
    resetWarning: "Your current reading session will end. This site's cookie and stored data will be cleared. A new HUMAN verification will be required.",
    rewindWarning: "You will need to replay the story after this checkpoint.",
    restartWarning: "Current progress will be reset. You will return to the beginning.",
    chapter: "Chapter", earth: "Earth", heaven: "Heaven",
  },
  ua: {
    eyebrow: "SYSTEM  /  NAVIGATION", cancel: "СКАСУВАТИ", proceed: "ПРОДОВЖИТИ",
    point: "Перейти до точки «{target}»?",
    rewind: "Повернутися до точки «{target}»?",
    restart: "Почати історію спочатку?",
    reset: "Очистити сесію і почати спочатку?",
    resetWarning: "Поточне проходження завершиться. Cookie й дані цього сайту буде очищено. Для нового входу потрібна перевірка HUMAN.",
    rewindWarning: "Подальший шлях після обраної точки доведеться пройти заново.",
    restartWarning: "Поточний прогрес буде скинуто. Ви повернетеся на початок історії.",
    chapter: "Розділ", earth: "Земля", heaven: "Небеса",
  },
});

function destination(label, copy) {
  const match = /^CH\s+(\d{1,2})\s*·\s*(EARTH|HEAVEN)$/u.exec(label ?? "");
  if (!match) return label || "";
  const chapter = match[1].padStart(2, "0");
  return `${copy.chapter} ${chapter} · ${match[2] === "EARTH" ? copy.earth : copy.heaven}`;
}

export function installNavigationConfirmation(root, { getLanguage = () => "en" } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "reader-nav-confirm";
  dialog.setAttribute("aria-labelledby", "reader-nav-confirm-title");
  dialog.setAttribute("aria-describedby", "reader-nav-confirm-detail");

  const form = document.createElement("form");
  form.method = "dialog";
  form.className = "reader-nav-confirm__form";
  const eyebrow = document.createElement("div");
  eyebrow.className = "reader-nav-confirm__eyebrow";
  const title = document.createElement("h2");
  title.id = "reader-nav-confirm-title";
  title.className = "reader-nav-confirm__title";
  const detail = document.createElement("p");
  detail.id = "reader-nav-confirm-detail";
  detail.className = "reader-nav-confirm__detail";
  const actions = document.createElement("div");
  actions.className = "reader-nav-confirm__actions";
  const cancelButton = document.createElement("button");
  cancelButton.type = "submit";
  cancelButton.value = "cancel";
  cancelButton.className = "reader-nav-confirm__button reader-nav-confirm__button--cancel";
  const continueButton = document.createElement("button");
  continueButton.type = "submit";
  continueButton.value = "confirm";
  continueButton.className = "reader-nav-confirm__button reader-nav-confirm__button--continue";
  actions.append(cancelButton, continueButton);
  form.append(eyebrow, title, detail, actions);
  dialog.append(form);
  root.append(dialog);

  let pending = null;
  let disposed = false;

  function onClose() {
    const request = pending;
    pending = null;
    if (disposed || dialog.returnValue !== "confirm" || !request || !request.valid()) return;
    try {
      const result = request.action();
      if (result && typeof result.catch === "function") {
        void result.catch((error) => console.error("Reader confirmed navigation failed", error));
      }
    } catch (error) {
      console.error("Reader confirmed navigation failed", error);
    }
  }
  function onBackdropClick(event) {
    if (event.target === dialog) dialog.close("cancel");
  }
  dialog.addEventListener("close", onClose);
  dialog.addEventListener("click", onBackdropClick);

  function request({ kind, label, action, valid = () => true } = {}) {
    if (disposed || dialog.open || typeof action !== "function") return false;
    if (!["point", "rewind", "restart", "reset"].includes(kind)) return false;
    const copy = COPY[getLanguage()] ?? COPY.en;
    eyebrow.textContent = copy.eyebrow;
    const target = destination(label, copy);
    title.textContent = kind === "restart" || kind === "reset"
      ? copy[kind] : copy[kind].replace("{target}", target);
    detail.textContent = kind === "reset" ? copy.resetWarning
      : kind === "restart" ? copy.restartWarning : copy.rewindWarning;
    cancelButton.textContent = copy.cancel;
    continueButton.textContent = copy.proceed;
    dialog.returnValue = "cancel";
    pending = { action, valid };
    try {
      dialog.showModal();
      cancelButton.focus();
    } catch (error) {
      pending = null;
      console.error("Reader navigation dialog unavailable", error);
      return false; // fail closed: never execute destructive navigation without consent
    }
    return true;
  }

  function cancel() {
    pending = null;
    if (dialog.open) dialog.close("cancel");
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancel();
    dialog.removeEventListener("close", onClose);
    dialog.removeEventListener("click", onBackdropClick);
    dialog.remove();
  }

  return Object.freeze({ request, cancel, dispose });
}
