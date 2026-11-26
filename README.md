# ClueKeeper

El repositorio está organizado por capas:

- `frontend/`: aplicación web React con Vite y PWA.
- `backend/`: API REST (Node + Express + SQLite). Ver `backend/README.md`.

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Para validar la aplicación, ejecuta `npm run lint` y `npm run build` desde `frontend/`.

El proyecto de Vercel debe usar `frontend/` como su Root Directory.
En Vercel define `VITE_API_BASE_URL=https://cluekeeper.onrender.com/api`. En Render, `CORS_ORIGINS` debe contener la URL pública exacta del frontend (sin `/` final) y `APP_BASE_URL` la misma URL; estas variables no se pueden inferir durante el build.

El workflow de GitHub Pages configura automáticamente la ruta base del repositorio para sus recursos y el service worker. Para que el login funcione allí, agrega también la URL publicada por Pages a `CORS_ORIGINS` en Render.

## Backend

```bash
cd backend
npm install
cp .env.example .env
npm run seed
npm run dev
npm test
```
