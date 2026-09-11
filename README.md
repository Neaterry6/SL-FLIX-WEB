# SL FLIX PRO

SL FLIX PRO is a modern, high-performance streaming and media application engineered with React, TypeScript, Express, and Tailwind CSS. Built for modern web and mobile devices, it delivers a smooth cinema experience with Live TV channels, real-time sports updates, webtoon reader, and on-demand streaming.

## Features

- **Live TV & IPTV Network**: Over 500+ HD streaming stations with smart stream resolution, logo proxier, and continuous background playlist synchronization.
- **Movie & Series Catalog**: High-definition movie details, dub selection, episode guide, and interactive player overlay.
- **Live Sports Hub**: Real-time scores, match schedules, live action feeds, and sports highlights.
- **Webtoon & Reader**: Interactive digital webtoon collection with continuous page viewer and reading history.
- **HLS Streaming Player**: Custom HTML5/HLS video player with adaptive bitrate control, quality switching, and volume controls.
- **Floating Navigation Dock**: Responsive desktop and mobile navigation dock with smooth spring animations.

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Motion (Framer Motion), Lucide React
- **Video Engine**: Hls.js, HTML5 Media Source Extensions
- **Backend Server**: Node.js, Express, Custom Caching Engine
- **Build System**: Vite, Esbuild, PostCSS

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Build for production:
   ```bash
   npm run build
   ```

4. Run production server:
   ```bash
   npm run start
   ```

## Project Structure

```
├── components/          # React components (LiveTv, Navbar, Footer, Dock, etc.)
├── server/              # Express backend server and IPTV storage engine
├── data/                # Local data storage and cached station lists
├── services/            # Client data services
├── types.ts             # Global TypeScript type definitions
└── server.js            # Main server entry point
```

## License

MIT License. Built for seamless media streaming.
