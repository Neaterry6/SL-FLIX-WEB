
# SL-FLIX PRO - Streaming Web App

This is a premium React + Vite + Express streaming application.

## How it Works
1. **Frontend**: React 18 + Tailwind CSS + Vite, builds to `dist/`.
2. **Backend**: Node/Express server serves static `dist/`, proxies streaming APIs, handles search/sources, visitor stats, Socket.io.
3. **APIs**: Fetches from external sources (cineverse, moviebox.ph proxies), caches results, streams via token proxy.
4. **Production**: `npm run build && npm start` (or `npm run production`).
5. **Security**: Rate limiting, CSP, source file blocking, anti-right-click.

## Local Development
```
npm install
npm run dev  # Vite dev server + Express proxy on :3000
```

## Production Build & Serve
```
npm run build  # Vite build to dist/
npm start      # node server.js (build && server)
# or
npm run production  # Optimized prod build + server
```

## Deploy to Render (Free Tier Web Service)

### Prerequisites
- GitHub account with repo pushed.
- Render.com account (free).

### Steps
1. **Push to GitHub**:
   ```
   git init
   git add .
   git commit -m "Prepare for Render deploy"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

2. **Render Dashboard**:
   - New → **Web Service**.
   - Connect GitHub → Select repo/branch `main`.
   - **Runtime**: Node.
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - Create service.

3. **Auto-deploys** on git push. Render URL: `https://your-service.onrender.com`.

4. **Custom Domain** (Settings → Custom Domains).

### Verify
- Homepage loads.
- `/api/home` returns data.
- Search, movie details, streams work.
- Logs: "SLFLIX Server running on port $PORT".

## Security Notes
- Client-side anti-cloning (index.html).
- Server: Rate limits, CSP, proxies hide origins.
- External APIs may change; monitor logs.

Test locally first: `npm run production`.
