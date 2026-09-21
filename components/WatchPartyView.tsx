import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ApiService } from '../services/api';
import { MovieResult, VideoSource, Subtitle, Season } from '../types';
import VideoPlayer from './VideoPlayer';

declare const io: any;

interface WatchRoom {
    roomId: string;
    roomName: string;
    creator: string;
    movie: any;
    currentSeason?: number;
    currentEpisode?: number;
    users: { id: string; name: string; isCreator: boolean }[];
    currentTime: number;
    paused: boolean;
}

export const WatchPartyView: React.FC<{
    onBack: () => void;
    onSelectMovieToWatch?: (movie: MovieResult) => void;
}> = ({ onBack }) => {
    const [socket, setSocket] = useState<any>(null);
    const [activeRooms, setActiveRooms] = useState<WatchRoom[]>([]);
    const [currentRoom, setCurrentRoom] = useState<WatchRoom | null>(null);
    const [username, setUsername] = useState<string>(() => localStorage.getItem('slflix_username') || `Viewer_${Math.floor(Math.random() * 10000)}`);
    const [roomNameInput, setRoomNameInput] = useState('');
    const [chatMessages, setChatMessages] = useState<{ username: string; message: string; timestamp: number }[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [inStreamLatestChat, setInStreamLatestChat] = useState<{ username: string; message: string } | null>(null);
    const [pauseNotice, setPauseNotice] = useState<string | null>(null);
    const [inviteCopied, setInviteCopied] = useState(false);
    const [roomSyncTimestamp, setRoomSyncTimestamp] = useState<number>(Date.now());
    
    // Main Search Engine Integration for Room Creation / Movie Switch
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<MovieResult[]>([]);
    const [selectedMovie, setSelectedMovie] = useState<MovieResult | null>(null);
    
    // TV Series & Episode Management
    const [movieDetails, setMovieDetails] = useState<any | null>(null);
    const [selectedSeason, setSelectedSeason] = useState<number>(1);
    const [selectedEpisode, setSelectedEpisode] = useState<number>(1);
    const [autoPlayNext, setAutoPlayNext] = useState<boolean>(true);
    const [showEpisodeSelector, setShowEpisodeSelector] = useState<boolean>(false);
    
    // Timer Features
    const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
    const [timerRemainingSeconds, setTimerRemainingSeconds] = useState<number | null>(null);
    const [showTimerMenu, setShowTimerMenu] = useState<boolean>(false);

    // Stream & Video Player State
    const [sources, setSources] = useState<VideoSource[]>([]);
    const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
    const [loadingStream, setLoadingStream] = useState<boolean>(false);

    // Initialize Socket
    useEffect(() => {
        const s = typeof io !== 'undefined' ? io() : null;
        if (!s) return;
        setSocket(s);

        s.emit('get_active_rooms');

        s.on('active_rooms_list', (rooms: WatchRoom[]) => {
            setActiveRooms(rooms);
        });

        s.on('room_state', (room: WatchRoom) => {
            setCurrentRoom(room);
            setRoomSyncTimestamp(Date.now());
            if (room.movie) {
                setSelectedMovie(room.movie);
                if (room.currentSeason) setSelectedSeason(room.currentSeason);
                if (room.currentEpisode) setSelectedEpisode(room.currentEpisode);
            }
        });

        s.on('room_sync', (data: { action: string; currentTime: number; paused: boolean; movie: any; season?: number; episode?: number; username: string }) => {
            setCurrentRoom(prev => prev ? { 
                ...prev, 
                currentTime: data.currentTime !== undefined ? data.currentTime : prev.currentTime, 
                paused: data.paused !== undefined ? data.paused : prev.paused, 
                movie: data.movie || prev.movie,
                currentSeason: data.season || prev.currentSeason,
                currentEpisode: data.episode || prev.currentEpisode
            } : null);
            setRoomSyncTimestamp(Date.now());

            if (data.movie) {
                setSelectedMovie(prev => {
                    if (!prev || (data.movie.subjectId && prev.subjectId !== data.movie.subjectId) || (!data.movie.subjectId && prev.title !== data.movie.title)) {
                        return data.movie;
                    }
                    return prev;
                });
            }
            if (data.season !== undefined) setSelectedSeason(data.season);
            if (data.episode !== undefined) setSelectedEpisode(data.episode);

            if (data.action === 'pause' && data.username) {
                setPauseNotice(`Paused by ${data.username}`);
                setTimeout(() => setPauseNotice(null), 3500);
            } else if (data.action === 'play' && data.username) {
                setPauseNotice(`Resumed by ${data.username}`);
                setTimeout(() => setPauseNotice(null), 2500);
            }
        });

        s.on('room_chat_message', (msg: { username: string; message: string; timestamp: number }) => {
            setChatMessages(prev => [...prev, msg]);
            setInStreamLatestChat({ username: msg.username, message: msg.message });
            setTimeout(() => setInStreamLatestChat(null), 5000);
        });

        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        if (roomParam) {
            setTimeout(() => {
                const storedName = localStorage.getItem('slflix_username') || username;
                s.emit('join_room', { roomId: roomParam, username: storedName });
            }, 600);
        }

        return () => {
            s.disconnect();
        };
    }, []);

    const isCreator = currentRoom ? (currentRoom.users.find(u => u.name === username)?.isCreator || currentRoom.creator === username) : false;

    // Load sources when selected movie / episode changes
    useEffect(() => {
        if (!selectedMovie) return;
        let isMounted = true;
        const loadMovieStreams = async () => {
            setLoadingStream(true);
            try {
                // Fetch full details if series
                const details = await ApiService.getDetails(selectedMovie);
                if (isMounted) setMovieDetails(details);

                const sourceRes = await ApiService.getSources(
                    selectedMovie.subjectId || (selectedMovie as any).id || 'search',
                    selectedMovie.type || 'Movie',
                    selectedSeason,
                    selectedEpisode,
                    selectedMovie.detailPath,
                    selectedMovie.title
                );
                if (isMounted && sourceRes && sourceRes.videos && sourceRes.videos.length > 0) {
                    setSources(sourceRes.videos);
                    setSubtitles(sourceRes.subs || []);
                }
            } catch (err) {
                console.error('Failed to fetch room video sources:', err);
            } finally {
                if (isMounted) setLoadingStream(false);
            }
        };
        loadMovieStreams();
        return () => { isMounted = false; };
    }, [selectedMovie, selectedSeason, selectedEpisode]);

    // Timer Countdown logic
    useEffect(() => {
        if (!timerRemainingSeconds) return;
        const interval = setInterval(() => {
            setTimerRemainingSeconds(prev => {
                if (prev === null || prev <= 1) {
                    clearInterval(interval);
                    if (socket && currentRoom) {
                        socket.emit('room_action', { 
                            roomId: currentRoom.roomId, 
                            action: 'pause', 
                            currentTime: currentRoom.currentTime || 0, 
                            paused: true,
                            username 
                        });
                    }
                    setPauseNotice('Playback stopped by Sleep Timer');
                    setTimeout(() => setPauseNotice(null), 4000);
                    return null;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [timerRemainingSeconds, currentRoom, socket, username]);

    // Search Engine Execution
    const executeSearch = async (q: string) => {
        setSearchQuery(q);
        if (q.trim().length < 2) {
            setSearchResults([]);
            return;
        }
        setIsSearching(true);
        try {
            const res = await ApiService.search(q.trim(), 1);
            setSearchResults(res.results || []);
        } catch (e) {
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    };

    // Master Host / Viewer Action Handler
    const handleHostAction = useCallback((action: 'play' | 'pause' | 'seek', time: number) => {
        if (!socket || !currentRoom) return;
        const isPaused = action === 'pause';
        socket.emit('room_action', {
            roomId: currentRoom.roomId,
            action: action,
            currentTime: time,
            paused: isPaused,
            username
        });
    }, [socket, currentRoom, username]);

    const handlePlayNextEpisode = useCallback(() => {
        if (!autoPlayNext) return;
        const currentSeasonData = movieDetails?.seasons?.find((s: any) => (s.seasonNumber || s.season) === selectedSeason);
        const epCount = currentSeasonData?.episodes?.length || currentSeasonData?.episodeCount || 12;
        
        if (selectedEpisode < epCount) {
            const nextEp = selectedEpisode + 1;
            setSelectedEpisode(nextEp);
            if (socket && currentRoom) {
                socket.emit('room_action', {
                    roomId: currentRoom.roomId,
                    action: 'change_episode',
                    season: selectedSeason,
                    episode: nextEp,
                    currentTime: 0,
                    username
                });
            }
        }
    }, [autoPlayNext, movieDetails, selectedSeason, selectedEpisode, socket, currentRoom, username]);

    const handleSelectEpisode = useCallback((seasonNum: number, epNum: number) => {
        setSelectedSeason(seasonNum);
        setSelectedEpisode(epNum);
        setShowEpisodeSelector(false);
        if (socket && currentRoom) {
            socket.emit('room_action', {
                roomId: currentRoom.roomId,
                action: 'change_episode',
                season: seasonNum,
                episode: epNum,
                currentTime: 0,
                username
            });
        }
    }, [socket, currentRoom, username]);

    const handleCreateRoom = (e: React.FormEvent) => {
        e.preventDefault();
        if (!roomNameInput.trim() || !socket) return;
        localStorage.setItem('slflix_username', username);
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        socket.emit('create_room', {
            roomId,
            roomName: roomNameInput.trim(),
            username,
            movie: selectedMovie || { title: 'Avengers: Endgame', cover: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800', subjectId: 'demo' },
            season: selectedSeason,
            episode: selectedEpisode
        });
        window.history.pushState({}, '', `/watch-party?room=${roomId}`);
    };

    const handleJoinRoom = (roomId: string) => {
        if (!socket) return;
        if (!socket.connected) {
            socket.connect();
        }
        localStorage.setItem('slflix_username', username);
        socket.emit('join_room', { roomId, username });
        window.history.pushState({}, '', `/watch-party?room=${roomId}`);
    };

    const handleLeaveRoom = () => {
        if (socket && currentRoom) {
            socket.emit('leave_room', { roomId: currentRoom.roomId, username });
        }
        setCurrentRoom(null);
        setSelectedMovie(null);
        setSources([]);
        setSubtitles([]);
        window.history.pushState({}, '', '/watch-party');
        if (socket) {
            socket.emit('get_active_rooms');
        }
    };

    const handleSendChat = (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatInput.trim() || !currentRoom || !socket) return;
        socket.emit('room_chat', { roomId: currentRoom.roomId, username, message: chatInput.trim() });
        setChatInput('');
    };

    const formatSeconds = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    return (
        <div className="min-h-screen bg-[#07080d] text-white pt-20 pb-20 px-4 sm:px-8">
            <div className="max-w-7xl mx-auto">
                {/* Header Navigation */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
                    <div>
                        <button onClick={onBack} className="text-gray-400 hover:text-cyan-400 text-xs font-bold flex items-center gap-2 mb-2 transition-colors">
                            <i className="fa-solid fa-arrow-left"></i> Back to Main Catalog
                        </button>
                        <h1 className="text-2xl sm:text-3xl font-black bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-500 bg-clip-text text-transparent flex items-center gap-3">
                            <i className="fa-solid fa-users-viewfinder text-cyan-400"></i> Watch Party Cinema
                        </h1>
                        <p className="text-gray-400 text-xs mt-0.5">Real-time synchronized video streaming, host master controls, live chat, and viewer metrics.</p>
                    </div>
                </div>

                {/* ROOM NOT JOINED YET: CREATE OR JOIN ACTIVE ROOM */}
                {!currentRoom ? (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Room Creation Card */}
                        <div className="bg-[#121322] border border-white/10 rounded-3xl p-6 shadow-2xl">
                            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-cyan-400">
                                <i className="fa-solid fa-circle-plus"></i> Create Watch Party Room
                            </h2>
                            <form onSubmit={handleCreateRoom} className="space-y-4">
                                <div>
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Your Display Name</label>
                                    <input 
                                        type="text" 
                                        value={username} 
                                        onChange={(e) => setUsername(e.target.value)} 
                                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-white text-xs outline-none focus:border-cyan-500 font-bold"
                                        placeholder="Enter your nickname"
                                        required 
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Room Name</label>
                                    <input 
                                        type="text" 
                                        value={roomNameInput} 
                                        onChange={(e) => setRoomNameInput(e.target.value)} 
                                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-white text-xs outline-none focus:border-cyan-500"
                                        placeholder="e.g. Cinema Night with Friends"
                                        required 
                                    />
                                </div>

                                {/* Main Search Engine Picker */}
                                <div>
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 flex items-center justify-between">
                                        <span>Pick Movie or Series</span>
                                        <span className="text-cyan-400 font-normal">Main Search Engine</span>
                                    </label>
                                    <div className="relative mb-2">
                                        <input 
                                            type="text" 
                                            value={searchQuery} 
                                            onChange={(e) => executeSearch(e.target.value)} 
                                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-8 pr-3 text-white text-xs outline-none focus:border-cyan-500"
                                            placeholder="Search catalog for movies, series, anime..."
                                        />
                                        <i className="fa-solid fa-search absolute left-2.5 top-2.5 text-gray-400 text-xs"></i>
                                        {isSearching && <div className="absolute right-2.5 top-2.5 w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>}
                                    </div>

                                    {/* Selected Movie Preview */}
                                    {selectedMovie && (
                                        <div className="flex items-center gap-3 bg-cyan-500/10 border border-cyan-500/30 p-2.5 rounded-xl mb-2">
                                            <img src={selectedMovie.cover} alt="" className="w-10 h-14 object-cover rounded-lg flex-shrink-0" />
                                            <div className="min-w-0">
                                                <div className="text-xs font-bold text-cyan-300 truncate">{selectedMovie.title}</div>
                                                <div className="text-[10px] text-gray-400">{selectedMovie.releaseDate || 'Ready to Stream'}</div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Live Search Engine Results */}
                                    {searchResults.length > 0 && (
                                        <div className="max-h-48 overflow-y-auto bg-[#0a0b14] border border-white/10 rounded-xl p-2 space-y-1.5 shadow-xl">
                                            {searchResults.map((m, i) => (
                                                <div 
                                                    key={i} 
                                                    onClick={() => { setSelectedMovie(m); setSearchResults([]); setSearchQuery(m.title); }} 
                                                    className="flex items-center gap-2.5 p-1.5 hover:bg-white/10 rounded-lg cursor-pointer text-xs group transition-colors"
                                                >
                                                    <img src={m.cover} alt="" className="w-8 h-10 object-cover rounded flex-shrink-0" />
                                                    <div className="truncate">
                                                        <p className="font-bold text-white group-hover:text-cyan-400 truncate">{m.title}</p>
                                                        <p className="text-[10px] text-gray-400">{m.type || 'Movie'} • {m.releaseDate || '2024'}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <button type="submit" className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-cyan-500/20 transition-all cursor-pointer">
                                    Launch Watch Room
                                </button>
                            </form>
                        </div>

                        {/* Active Rooms Listing */}
                        <div className="lg:col-span-2 bg-[#121322] border border-white/10 rounded-3xl p-6 shadow-2xl">
                            <h2 className="text-lg font-bold mb-4 flex items-center justify-between text-purple-400">
                                <span className="flex items-center gap-2">
                                    <i className="fa-solid fa-satellite-dish"></i> Live Watch Parties ({activeRooms.length})
                                </span>
                                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full font-mono font-bold">
                                    Active Now
                                </span>
                            </h2>
                            {activeRooms.length === 0 ? (
                                <div className="text-center py-20 text-gray-400">
                                    <i className="fa-solid fa-tv text-4xl mb-3 opacity-30 text-cyan-400"></i>
                                    <p className="text-xs font-bold text-gray-300">No active watch rooms right now.</p>
                                    <p className="text-[11px] text-gray-500 mt-1">Be the first to create one and share your invite link!</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {activeRooms.map(room => (
                                        <div key={room.roomId} className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 flex flex-col justify-between hover:border-cyan-500/50 transition-all group">
                                            <div>
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="bg-cyan-500/20 text-cyan-400 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full">
                                                        ROOM #{room.roomId}
                                                    </span>
                                                    <span className="text-[11px] text-emerald-400 font-bold flex items-center gap-1.5">
                                                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                                        {room.users.length} {room.users.length === 1 ? 'Viewer' : 'Viewers'}
                                                    </span>
                                                </div>
                                                <h3 className="text-sm font-black text-white mb-0.5 group-hover:text-cyan-400 transition-colors">{room.roomName}</h3>
                                                <p className="text-[11px] text-gray-400 mb-3">Host: <span className="text-gray-300 font-semibold">{room.creator}</span></p>
                                                {room.movie && (
                                                    <div className="flex items-center gap-3 bg-black/50 p-2 rounded-xl mb-4 border border-white/5">
                                                        <img src={room.movie.cover} alt="" className="w-10 h-14 object-cover rounded-lg flex-shrink-0" />
                                                        <div className="truncate">
                                                            <div className="text-xs font-bold text-gray-200 truncate">{room.movie.title}</div>
                                                            <div className="text-[10px] text-cyan-400 font-mono mt-0.5 flex items-center gap-1.5">
                                                                {room.paused ? (
                                                                    <>
                                                                        <i className="fa-solid fa-pause text-amber-400"></i>
                                                                        <span>Paused</span>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <i className="fa-solid fa-play text-cyan-400"></i>
                                                                        <span>Streaming</span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <button 
                                                onClick={() => handleJoinRoom(room.roomId)}
                                                className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black font-extrabold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                                            >
                                                <i className="fa-solid fa-play"></i> Join & Watch Party
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    /* INSIDE ACTIVE ROOM: UNIFIED GLOBAL STREAMING PLAYER & REAL-TIME PARTY CONTROLS */
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                        <div className="lg:col-span-3 space-y-4">
                            {/* Unified VideoPlayer Component */}
                            {loadingStream ? (
                                <div className="w-full aspect-video bg-black/90 rounded-2xl border border-white/10 flex flex-col items-center justify-center text-center p-6 shadow-2xl">
                                    <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mb-4"></div>
                                    <p className="text-sm font-bold text-white">Connecting Global Stream...</p>
                                    <p className="text-xs text-gray-400 mt-1">Synchronizing room audio & video tracks</p>
                                </div>
                            ) : sources.length > 0 ? (
                                <VideoPlayer
                                    title={selectedMovie?.title || currentRoom.movie?.title || 'Watch Party Stream'}
                                    subTitle={(() => {
                                        const rawType = String(selectedMovie?.type || movieDetails?.type || currentRoom.movie?.type || '').toLowerCase();
                                        const isMovie = rawType === 'movie' || rawType.includes('feature');
                                        const isSer = !isMovie && (rawType.includes('series') || rawType.includes('tv') || rawType.includes('anime') || (movieDetails?.seasons && movieDetails.seasons.length > 1));
                                        return isSer ? `Season ${selectedSeason} • Episode ${selectedEpisode}` : undefined;
                                    })()}
                                    sources={sources}
                                    subtitles={subtitles}
                                    onClose={handleLeaveRoom}
                                    embedded={true}
                                    movie={movieDetails || selectedMovie || currentRoom.movie}
                                    currentSeason={selectedSeason}
                                    currentEpisode={selectedEpisode}
                                    onSeasonChange={(s) => setSelectedSeason(s)}
                                    onEpisodeChange={handleSelectEpisode}
                                    onPlayNext={handlePlayNextEpisode}
                                    watchPartyProps={{
                                        isHost: isCreator,
                                        viewersCount: currentRoom.users?.length || 1,
                                        viewersList: currentRoom.users || [],
                                        inStreamChat: inStreamLatestChat,
                                        pauseNotice: pauseNotice,
                                        onHostAction: handleHostAction,
                                        syncTime: currentRoom.currentTime,
                                        syncPaused: currentRoom.paused,
                                        syncTimestamp: roomSyncTimestamp
                                    }}
                                />
                            ) : (
                                <div className="w-full aspect-video bg-[#121324] rounded-2xl border border-white/10 flex flex-col items-center justify-center p-6 text-center shadow-2xl">
                                    <i className="fa-solid fa-circle-exclamation text-amber-400 text-4xl mb-3"></i>
                                    <p className="text-sm font-bold text-white">Stream Sources Loading...</p>
                                    <p className="text-xs text-gray-400 mt-1">Please select another title or wait a moment.</p>
                                </div>
                            )}

                            {/* SERIES EPISODES SELECTOR DRAWER */}
                            {(() => {
                                const rawType = String(selectedMovie?.type || movieDetails?.type || currentRoom.movie?.type || '').toLowerCase();
                                const isMovie = rawType === 'movie' || rawType.includes('feature');
                                const isSer = !isMovie && (rawType.includes('series') || rawType.includes('tv') || rawType.includes('anime') || (movieDetails?.seasons && movieDetails.seasons.length > 1));
                                if (!isSer || !showEpisodeSelector || !movieDetails?.seasons) return null;
                                return (
                                    <div className="bg-[#121324] border border-white/10 rounded-2xl p-4 animate-fade-in">
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className="text-xs font-bold uppercase text-cyan-400">Select Episode to Stream</h3>
                                            <button onClick={() => setShowEpisodeSelector(false)} className="text-gray-400 hover:text-white text-xs">
                                                <i className="fa-solid fa-xmark"></i>
                                            </button>
                                        </div>
                                        <div className="space-y-3">
                                            {movieDetails.seasons.map((season: Season) => {
                                                const seasonNum = season.seasonNumber || 1;
                                                const epList: number[] = season.episodes && season.episodes.length > 0 
                                                    ? season.episodes.map(e => e.episodeNumber)
                                                    : Array.from({ length: season.episodeCount || 1 }, (_, idx) => idx + 1);

                                                return (
                                                    <div key={seasonNum}>
                                                        <p className="text-[11px] font-bold text-gray-400 mb-1.5">Season {seasonNum}</p>
                                                        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                                                            {epList.map((epNum) => {
                                                                const isCurrent = selectedSeason === seasonNum && selectedEpisode === epNum;
                                                                return (
                                                                    <button
                                                                        key={epNum}
                                                                        onClick={() => handleSelectEpisode(seasonNum, epNum)}
                                                                        disabled={!isCreator}
                                                                        className={`py-1.5 px-2 rounded-xl text-xs font-bold border transition-all ${
                                                                            isCurrent 
                                                                                ? 'bg-cyan-500 text-black border-cyan-400' 
                                                                                : 'bg-white/5 border-white/5 hover:bg-white/10 text-gray-300'
                                                                        } ${!isCreator ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                                                    >
                                                                        EP {epNum}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* ROOM CONTROLS & TIMERS BAR */}
                            <div className="bg-[#121322] border border-white/10 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
                                <div>
                                    <div className="text-xs text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-2">
                                        <span>Room: {currentRoom.roomName} (#{currentRoom.roomId})</span>
                                        {isCreator && (
                                            <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                                <i className="fa-solid fa-crown text-[10px] text-amber-300"></i>
                                                <span>Creator</span>
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm font-extrabold text-white mt-0.5">
                                        Now Watching: {selectedMovie?.title || currentRoom.movie?.title}
                                    </div>
                                </div>
                                <div className="flex items-center flex-wrap gap-2">
                                    {/* Series Episode Selector Button */}
                                    {(() => {
                                        const rawType = String(selectedMovie?.type || movieDetails?.type || currentRoom.movie?.type || '').toLowerCase();
                                        const isMovie = rawType === 'movie' || rawType.includes('feature');
                                        const isSer = !isMovie && (rawType.includes('series') || rawType.includes('tv') || rawType.includes('anime') || (movieDetails?.seasons && movieDetails.seasons.length > 1));
                                        if (!isSer || !movieDetails?.seasons) return null;
                                        return (
                                            <button 
                                                onClick={() => setShowEpisodeSelector(!showEpisodeSelector)}
                                                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-cyan-400 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                                            >
                                                <i className="fa-solid fa-list-ol"></i>
                                                <span>S{selectedSeason} E{selectedEpisode}</span>
                                                <i className="fa-solid fa-chevron-down text-[10px]"></i>
                                            </button>
                                        );
                                    })()}

                                    {/* Auto-Play Next Toggle for Creator */}
                                    {(() => {
                                        const rawType = String(selectedMovie?.type || movieDetails?.type || currentRoom.movie?.type || '').toLowerCase();
                                        const isMovie = rawType === 'movie' || rawType.includes('feature');
                                        const isSer = !isMovie && (rawType.includes('series') || rawType.includes('tv') || rawType.includes('anime') || (movieDetails?.seasons && movieDetails.seasons.length > 1));
                                        if (!isSer || !isCreator || !movieDetails?.seasons) return null;
                                        return (
                                            <button 
                                                onClick={() => setAutoPlayNext(!autoPlayNext)}
                                                className={`px-3 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                                                    autoPlayNext ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-white/5 text-gray-400'
                                                }`}
                                            >
                                                Auto-Next: {autoPlayNext ? 'ON' : 'OFF'}
                                            </button>
                                        );
                                    })()}

                                    {/* Sleep Timer Menu */}
                                    <div className="relative">
                                        <button 
                                            onClick={() => setShowTimerMenu(!showTimerMenu)}
                                            className="px-3 py-2 bg-white/10 hover:bg-white/20 text-cyan-400 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                                            title="Set Sleep Timer"
                                        >
                                            <i className="fa-solid fa-stopwatch"></i>
                                            <span>{timerRemainingSeconds ? formatSeconds(timerRemainingSeconds) : 'Timer'}</span>
                                        </button>

                                        {showTimerMenu && (
                                            <div className="absolute left-0 bottom-full mb-2 bg-[#121324]/95 backdrop-blur-xl border border-white/20 rounded-2xl p-2 shadow-2xl z-50 w-36 space-y-1 text-xs">
                                                <div className="text-[10px] font-bold text-gray-400 px-2 py-1 uppercase">Sleep Timer</div>
                                                {[15, 30, 45, 60, 90].map(mins => (
                                                    <button
                                                        key={mins}
                                                        onClick={() => {
                                                            setSleepTimerMinutes(mins);
                                                            setTimerRemainingSeconds(mins * 60);
                                                            setShowTimerMenu(false);
                                                        }}
                                                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/10 text-white font-semibold cursor-pointer transition-colors"
                                                    >
                                                        {mins} Minutes
                                                    </button>
                                                ))}
                                                <button
                                                    onClick={() => {
                                                        setSleepTimerMinutes(null);
                                                        setTimerRemainingSeconds(null);
                                                        setShowTimerMenu(false);
                                                    }}
                                                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-red-500/20 text-red-400 font-semibold cursor-pointer transition-colors"
                                                >
                                                    Turn Off
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Copy Invite Link */}
                                    <button 
                                        onClick={() => {
                                            navigator.clipboard.writeText(`${window.location.origin}/watch-party?room=${currentRoom.roomId}`);
                                            setInviteCopied(true);
                                            setTimeout(() => setInviteCopied(false), 2000);
                                        }}
                                        className="px-3.5 py-2 bg-cyan-500/10 hover:bg-cyan-500 hover:text-black text-cyan-400 border border-cyan-500/30 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                                    >
                                        <i className="fa-solid fa-link"></i>
                                        <span>{inviteCopied ? 'Copied!' : 'Invite'}</span>
                                    </button>

                                    {/* Leave Room */}
                                    <button 
                                        onClick={handleLeaveRoom}
                                        className="px-3.5 py-2 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
                                    >
                                        Leave
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* ROOM CHAT & PARTICIPANTS SIDEBAR */}
                        <div className="bg-[#121322] border border-white/10 rounded-3xl p-5 flex flex-col h-[580px] shadow-2xl">
                            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-cyan-400 flex items-center gap-2">
                                    <i className="fa-solid fa-comments"></i> Room Chat ({currentRoom.users.length})
                                </h3>
                                <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Live
                                </span>
                            </div>

                            {/* Chat messages list */}
                            <div className="flex-1 overflow-y-auto space-y-2.5 mb-3 pr-1">
                                {chatMessages.length === 0 ? (
                                    <div className="text-center py-20 text-gray-500 text-xs">
                                        No messages yet. Send a message to the watch room!
                                    </div>
                                ) : (
                                    chatMessages.map((msg, i) => {
                                        const isMe = msg.username === username;
                                        return (
                                            <div key={i} className={`p-2.5 rounded-xl border ${isMe ? 'bg-cyan-500/10 border-cyan-500/30 ml-4' : 'bg-white/5 border-white/5 mr-4'}`}>
                                                <div className="flex items-center justify-between text-[10px] font-bold mb-1">
                                                    <span className={isMe ? 'text-cyan-300' : 'text-purple-300'}>{msg.username}</span>
                                                    <span className="text-gray-500 text-[9px]">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>
                                                <div className="text-xs text-gray-200 leading-relaxed break-words">{msg.message}</div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* Chat input box */}
                            <form onSubmit={handleSendChat} className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={chatInput} 
                                    onChange={(e) => setChatInput(e.target.value)} 
                                    placeholder="Type message..." 
                                    className="flex-1 bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-xs text-white outline-none focus:border-cyan-500"
                                />
                                <button type="submit" className="px-4 py-2 bg-cyan-500 text-black font-black text-xs rounded-xl hover:scale-105 transition-transform cursor-pointer">
                                    Send
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
