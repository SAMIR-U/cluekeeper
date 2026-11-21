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

## Backend

```bash
cd backend
npm install
cp .env.example .env
npm run seed
npm run dev
npm test
```
