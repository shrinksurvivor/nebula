# Размещение на GitHub Pages

Чтобы разместить это приложение на бесплатном хостинге GitHub Pages, выполните следующие шаги:

## 1. Подготовка репозитория
1. Экспортируйте этот проект (скачайте ZIP или выгрузите сразу в свой GitHub через настройки в AI Studio).
2. Загрузите файлы в ваш новый репозиторий на GitHub.

## 2. Настройка Vite
Если ваш репозиторий не называется `ваш-юзернейм.github.io` (то есть проект будет по адресу `https://username.github.io/repo-name/`), откройте файл `vite.config.ts` и поменяйте `base`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/ВАШ_РЕПОЗИТОРИЙ/', // <--- Добавьте эту строку
})
```
*Если используете корневой репозиторий (`username.github.io`), то настройка `base` не нужна.*

## 3. Настройка GitHub Actions (Автоматический деплой)
В вашем репозитории создайте файл по пути `.github/workflows/deploy.yml` и вставьте следующий код:

```yaml
# Simple workflow for deploying static content to GitHub Pages
name: Deploy static content to Pages

on:
  push:
    branches: ['main'] # Или 'master'

# Sets permissions of the GITHUB_TOKEN to allow deployment to GitHub Pages
permissions:
  contents: read
  pages: write
  id-token: write

# Allow one concurrent deployment
concurrency:
  group: 'pages'
  cancel-in-progress: true

jobs:
  # Single deploy job since we're just deploying
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Build
        run: npm run build
      - name: Setup Pages
        uses: actions/configure-pages@v4
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          # Upload dist repository
          path: './dist'
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

## 4. Настройка GitHub Pages
1. Перейдите в ваш репозиторий на GitHub -> **Settings** (Настройки) -> **Pages**.
2. В разделе **Build and deployment**, в выпадающем списке **Source** выберите **GitHub Actions**.
3. Запушьте код (`git push`), после чего GitHub Actions сам соберет и опубликует ваш сайт. Вы увидите ссылку на ваш готовый проект.

---
**Важно про Firebase:**
Домены `*.github.io` по умолчанию могут быть не в белом списке авторизации Google Firebase. Зайдите в [настройки Firebase Authentication - Settings - Authorized domains](https://console.firebase.google.com/project/gen-lang-client-0349579008/authentication/settings) и добавьте туда ваш домен (например, `username.github.io`), чтобы вход через Google продолжал работать на хостинге.
