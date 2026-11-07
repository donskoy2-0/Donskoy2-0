# Донской 2.0

![Обложка книги](Donskoy2-0-source-upload/demo/art/cover.webp)

**Дмитрий Иванович Филатов** · интерактивный роман · RU / UA / EN

[Читать полную книгу](https://donskoy2-0.pages.dev/) · [Открыть демо](https://donskoy2-0.github.io/Donskoy2-0/)

Антрополог Аркадий Левшин соглашается подтвердить подлинность княжеских останков. Его подпись запускает маршрут, который приведёт его из Архангельского собора к фронту.

### Исходный код

- [Читалка](Donskoy2-0-source-upload/src/reader/) — оформление прозы и диалогов, звук, иллюстрации и блокнот.
- [Ядро](Donskoy2-0-source-upload/src/kernel/) и [граф сцен](Donskoy2-0-source-upload/canon/) — переходы между главами и возврат к прочитанному.
- [Клиент](Donskoy2-0-source-upload/src/runtime/) — последовательное чтение и управление состоянием экрана.
- [Тесты](Donskoy2-0-source-upload/tests/) — переходы, воспроизведение звука и навигация.

### Локальный запуск

Скачайте репозиторий и откройте [demo/index.html](Donskoy2-0-source-upload/demo/index.html) в браузере. Демо содержит первые 231 знак земной сцены каждой из 12 глав на русском, украинском и английском и поддерживает импорт [JSON](Donskoy2-0-source-upload/demo/data/edition.json).

Для проверки исходников с Node.js 22 или новее:

```sh
cd Donskoy2-0-source-upload
npm test
npm run build
```

© 2026 Дмитрий Иванович Филатов (псевдоним). [Right to Read 2.0](Donskoy2-0-source-upload/license/right-to-read-2.0.html).
