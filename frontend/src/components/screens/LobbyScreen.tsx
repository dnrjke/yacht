import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { connectSocket, getSocket, disconnectSocket } from '../../network/socket';
import { getOrCreateIdentity, saveIdentity, saveReconnectInfo } from '../../network/identity';

type LobbyState = 'idle' | 'waiting' | 'joining';

export function LobbyScreen() {
  const setPhase = useGameStore(s => s.setPhase);
  const setGameMode = useGameStore(s => s.setGameMode);
  const setMyRole = useGameStore(s => s.setMyRole);
  const setRoomId = useGameStore(s => s.setRoomId);
  const setOpponentName = useGameStore(s => s.setOpponentName);
  const resetGame = useGameStore(s => s.resetGame);

  const identity = useRef(getOrCreateIdentity());
  const [nickname, setNickname] = useState(() => {
    const stored = sessionStorage.getItem('yacht_nickname');
    if (stored) return stored;
    return 'Guest_' + identity.current.playerId.slice(0, 4);
  });
  const [lobbyState, setLobbyState] = useState<LobbyState>('idle');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const sock = connectSocket({ autoReconnect: false });

    const onRoomCreated = ({ roomId, code }: { roomId: string; code: string }) => {
      setRoomCode(code);
      setRoomId(roomId);
      setLobbyState('waiting');
      setError('');
      saveReconnectInfo(identity.current.playerId, identity.current.secret, roomId, nickname);
    };

    const onJoinError = ({ reason }: { reason: string }) => {
      setError(reason === 'invalid_code' ? '방을 찾을 수 없습니다' :
               reason === 'room_full' ? '방이 가득 찼습니다' :
               reason === 'server_full' ? '서버가 가득 찼습니다' : reason);
      setLobbyState('idle');
    };

    const onGameStart = ({ roomId, players, yourRole }: { roomId: string; players: { name: string }[]; yourRole: 'p1' | 'p2' }) => {
      resetGame();
      setGameMode('online');
      setMyRole(yourRole);
      setRoomId(roomId);
      const opIdx = yourRole === 'p1' ? 1 : 0;
      setOpponentName(players[opIdx]?.name ?? 'Opponent');
      saveReconnectInfo(identity.current.playerId, identity.current.secret, roomId, nickname);
      setPhase('GAME');
    };

    sock.on('ROOM_CREATED', onRoomCreated);
    sock.on('JOIN_ERROR', onJoinError);
    sock.on('GAME_START', onGameStart);

    return () => {
      sock.off('ROOM_CREATED', onRoomCreated);
      sock.off('JOIN_ERROR', onJoinError);
      sock.off('GAME_START', onGameStart);
    };
  }, [nickname, resetGame, setGameMode, setMyRole, setOpponentName, setPhase, setRoomId]);

  const handleNicknameChange = (val: string) => {
    const trimmed = val.trim().slice(0, 12);
    setNickname(trimmed || 'Guest_' + identity.current.playerId.slice(0, 4));
    sessionStorage.setItem('yacht_nickname', trimmed);
    identity.current.playerName = trimmed;
    saveIdentity(identity.current);
  };

  const handleCreateRoom = () => {
    const sock = getSocket();
    if (!sock) return;
    identity.current.playerName = nickname;
    saveIdentity(identity.current);
    sock.emit('CREATE_ROOM', {
      playerName: nickname,
      playerId: identity.current.playerId,
      secret: identity.current.secret,
    });
    setLobbyState('waiting');
  };

  const handleJoinRoom = () => {
    if (joinCode.length < 6) return;
    const sock = getSocket();
    if (!sock) return;
    identity.current.playerName = nickname;
    saveIdentity(identity.current);
    sock.emit('JOIN_ROOM', {
      code: joinCode,
      playerName: nickname,
      playerId: identity.current.playerId,
      secret: identity.current.secret,
    });
    setLobbyState('joining');
  };

  const handleBack = () => {
    disconnectSocket();
    setLobbyState('idle');
    setRoomCode('');
    setError('');
    setPhase('MAIN_MENU');
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode).catch(() => {});
  };

  const containerStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
    alignItems: 'center', justifyContent: 'center', background: '#222', color: '#fff',
    gap: '16px', padding: '20px', boxSizing: 'border-box',
  };

  const inputStyle: React.CSSProperties = {
    padding: '10px 14px', fontSize: '1rem', background: '#333', color: '#fff',
    border: '1px solid #555', borderRadius: '6px', textAlign: 'center',
  };

  const btnStyle: React.CSSProperties = {
    padding: '12px 28px', fontSize: '1rem', cursor: 'pointer', color: '#fff',
    border: 'none', borderRadius: '6px',
  };

  if (lobbyState === 'waiting') {
    return (
      <div style={containerStyle}>
        <button onClick={handleBack} style={{ ...btnStyle, background: '#666', alignSelf: 'flex-start' }}>
          ← Back
        </button>
        <div style={{ fontSize: '0.9rem', color: '#aaa' }}>Nickname: {nickname}</div>
        <div style={{ margin: '20px 0', textAlign: 'center' }}>
          <div style={{ fontSize: '0.85rem', color: '#aaa', marginBottom: '8px' }}>Room Code</div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', letterSpacing: '0.3em', fontFamily: 'monospace' }}>
            {roomCode}
          </div>
          <button onClick={handleCopyCode} style={{ ...btnStyle, background: '#555', marginTop: '8px', fontSize: '0.85rem' }}>
            Copy
          </button>
        </div>
        <div style={{ color: '#aaa' }}>Waiting for opponent...</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{ animation: 'blink 1.2s infinite' }}>●</span>
          <span style={{ animation: 'blink 1.2s 0.4s infinite' }}>●</span>
          <span style={{ animation: 'blink 1.2s 0.8s infinite' }}>●</span>
        </div>
        <style>{`@keyframes blink { 0%,100%{opacity:0.2} 50%{opacity:1} }`}</style>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <button onClick={handleBack} style={{ ...btnStyle, background: '#666', alignSelf: 'flex-start' }}>
        ← Back
      </button>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '0.85rem', color: '#aaa', marginBottom: '6px' }}>Nickname</div>
        <input
          value={nickname}
          onChange={e => handleNicknameChange(e.target.value)}
          maxLength={12}
          style={{ ...inputStyle, width: '200px' }}
        />
      </div>

      <div style={{ width: '80%', maxWidth: '300px', borderTop: '1px solid #444', margin: '8px 0' }} />

      <button
        onClick={handleCreateRoom}
        disabled={lobbyState === 'joining'}
        style={{ ...btnStyle, background: '#FF9800', width: '220px' }}
      >
        Create Room
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <input
          value={joinCode}
          onChange={e => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="Code"
          inputMode="numeric"
          maxLength={6}
          style={{ ...inputStyle, width: '120px' }}
        />
        <button
          onClick={handleJoinRoom}
          disabled={joinCode.length < 6 || lobbyState === 'joining'}
          style={{ ...btnStyle, background: joinCode.length >= 6 ? '#4CAF50' : '#555' }}
        >
          Join
        </button>
      </div>

      {error && <div style={{ color: '#ff6b6b', fontSize: '0.9rem' }}>{error}</div>}
    </div>
  );
}
