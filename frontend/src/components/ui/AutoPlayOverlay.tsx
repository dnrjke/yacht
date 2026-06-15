import { useGameStore } from '../../store/gameStore';
import { getSocket } from '../../network/socket';

export function AutoPlayOverlay() {
  const autoPlayActive = useGameStore(s => s.autoPlayActive);
  const myRole = useGameStore(s => s.myRole);

  if (!autoPlayActive || autoPlayActive !== myRole) return null;

  const handleResume = () => {
    const sock = getSocket();
    if (sock) sock.emit('RESUME_CONTROL');
  };

  return (
    <div
      onClick={handleResume}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 90,
        cursor: 'pointer',
        gap: '12px',
      }}
    >
      <div style={{
        color: '#FFD700',
        fontSize: '1.1rem',
        fontWeight: 'bold',
        textShadow: '0 2px 8px rgba(0,0,0,0.6)',
      }}>
        자동 진행 중
      </div>
      <div style={{
        color: '#fff',
        fontSize: '0.85rem',
        opacity: 0.8,
        animation: 'autoPlayPulse 2s ease-in-out infinite',
      }}>
        터치하여 복귀
      </div>
      <style>{`@keyframes autoPlayPulse { 0%,100%{opacity:0.5} 50%{opacity:1} }`}</style>
    </div>
  );
}
