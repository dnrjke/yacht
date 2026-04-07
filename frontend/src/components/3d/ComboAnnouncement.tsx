import { useEffect, useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Sparkles } from '@react-three/drei';
import { useGameStore } from '../../store/gameStore';
import * as THREE from 'three';

const COMBO_DISPLAY_DURATION = 1800;
const YACHT_DISPLAY_DURATION = 2500;
const FADE_OUT_DURATION = 400;

// Scratch vectors — reused every frame (same pattern as DecisionButton)
const _forward = new THREE.Vector3();
const _right   = new THREE.Vector3();
const _up      = new THREE.Vector3();
const _center  = new THREE.Vector3();

const styles = `
  .combo-container {
    pointer-events: none;
  }

  .combo-text {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    white-space: nowrap;
    color: #f5f0e8;
    text-shadow:
      0 0 4px rgba(0, 0, 0, 0.8),
      0 0 8px rgba(0, 0, 0, 0.5),
      0 2px 12px rgba(0, 0, 0, 0.4);
    font-size: 1.6rem;
    animation: comboIn 0.4s ease-out forwards;
  }

  .combo-text.fade-out {
    animation: comboOut 0.4s ease-in forwards;
  }

  .combo-text.tier-yacht {
    font-size: 2.2rem;
    text-shadow: none;
    background: linear-gradient(90deg, #e8c86a, #fff5d6, #e8c86a);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: comboIn 0.4s ease-out forwards, shimmer 3s ease-in-out infinite;
    filter:
      drop-shadow(0 0 2px rgba(0, 0, 0, 0.9))
      drop-shadow(0 0 6px rgba(0, 0, 0, 0.6))
      drop-shadow(0 0 10px rgba(212, 168, 85, 0.5))
      drop-shadow(0 0 20px rgba(212, 168, 85, 0.3));
  }

  .combo-backdrop {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 110%;
    height: 180%;
    background: radial-gradient(ellipse, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0) 55%);
    border-radius: 50%;
    pointer-events: none;
  }

  .combo-text.tier-yacht.fade-out {
    animation: comboOut 0.4s ease-in forwards, shimmer 3s ease-in-out infinite;
  }

  @keyframes comboIn {
    0%   { opacity: 0; transform: translateY(12px) scale(1.05); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes comboOut {
    0%   { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-10px); }
  }

  @keyframes shimmer {
    0%   { background-position: 200% center; }
    100% { background-position: -200% center; }
  }
`;

// Inject styles once
let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);
  stylesInjected = true;
}

// ── Yacht VFX: Golden Wave Stream (custom shader) ──────────────────────────

const WAVE_INTRO_DURATION = 0.6;
const WAVE_OUTRO_DURATION = 0.4;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const waveVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const waveFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;

  // Gold color palette
  const vec3 GOLD_DEEP  = vec3(0.83, 0.66, 0.33);  // #d4a855
  const vec3 GOLD_LIGHT = vec3(0.96, 0.90, 0.72);  // #f5e6b8
  const vec3 GOLD_WHITE = vec3(1.0, 0.97, 0.88);   // warm white peak

  // Single wave ribbon: returns intensity at point
  float waveRibbon(vec2 uv, float freq, float amp, float phase, float speed, float width) {
    float wave = amp * sin(uv.x * freq + uTime * speed + phase);
    float dist = abs(uv.y - wave);
    return smoothstep(width, width * 0.15, dist);
  }

  void main() {
    // Remap UV: center origin, x range [-1,1], y range [-1,1]
    vec2 uv = (vUv - 0.5) * 2.0;

    // Horizontal fade: soft edges at left/right
    float hFade = smoothstep(0.0, 0.3, 1.0 - abs(uv.x));

    // Vertical containment: fade at top/bottom
    float vFade = smoothstep(0.0, 0.4, 1.0 - abs(uv.y));

    // Accumulate wave ribbons (additive)
    float intensity = 0.0;

    // Wave 1: primary wide ribbon
    intensity += waveRibbon(uv, 3.0, 0.25, 0.0, 1.2, 0.12) * 0.6;

    // Wave 2: secondary, different frequency
    intensity += waveRibbon(uv, 4.5, 0.18, 2.1, -0.9, 0.09) * 0.45;

    // Wave 3: thin fast accent
    intensity += waveRibbon(uv, 6.0, 0.12, 4.2, 1.8, 0.06) * 0.35;

    // Wave 4: subtle wide undulation
    intensity += waveRibbon(uv, 2.0, 0.30, 1.0, 0.6, 0.18) * 0.25;

    // Apply fades
    intensity *= hFade * vFade;

    // Soft central glow (very subtle)
    float glow = exp(-dot(uv * vec2(0.8, 1.5), uv * vec2(0.8, 1.5)) * 1.5) * 0.2;
    intensity += glow * hFade;

    // Color: blend from deep gold to bright gold/white based on intensity
    vec3 color = mix(GOLD_DEEP, GOLD_LIGHT, smoothstep(0.0, 0.5, intensity));
    color = mix(color, GOLD_WHITE, smoothstep(0.5, 1.0, intensity));

    // Global opacity (intro fade-in + fade-out)
    intensity *= uOpacity;

    gl_FragColor = vec4(color, intensity);
  }
`;

function GoldenWaveStream({ fading }: { fading: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const mountTime = useRef<number | null>(null);
  const opacityRef = useRef(0);

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: waveVertexShader,
    fragmentShader: waveFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  }), []);

  useFrame(({ clock }, delta) => {
    if (mountTime.current === null) mountTime.current = clock.elapsedTime;

    const age = clock.elapsedTime - mountTime.current;
    const introTarget = easeOutCubic(Math.min(age / WAVE_INTRO_DURATION, 1));

    // Fade toward target: 1 when active, 0 when fading
    const target = fading ? 0 : introTarget;
    const speed = fading ? (1 / WAVE_OUTRO_DURATION) : (1 / WAVE_INTRO_DURATION);
    opacityRef.current += (target - opacityRef.current) * Math.min(speed * delta * 5, 1);

    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uOpacity.value = opacityRef.current;
  });

  return (
    <mesh ref={meshRef} material={material} renderOrder={98}>
      <planeGeometry args={[16, 4]} />
    </mesh>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function ComboAnnouncement() {
  const activeCombo = useGameStore(state => state.activeCombo);
  const setActiveCombo = useGameStore(state => state.setActiveCombo);
  const groupRef = useRef<THREE.Group>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    injectStyles();
  }, []);

  useEffect(() => {
    if (!activeCombo) {
      setIsFading(false);
      return;
    }

    // Clear any pending timer
    if (timerRef.current) clearTimeout(timerRef.current);

    // Remove fade-out class on new combo
    if (fadeRef.current) fadeRef.current.classList.remove('fade-out');
    setIsFading(false);

    const displayDuration = activeCombo.tier === 2 ? YACHT_DISPLAY_DURATION : COMBO_DISPLAY_DURATION;

    // Start fade-out, then clear
    timerRef.current = setTimeout(() => {
      if (fadeRef.current) fadeRef.current.classList.add('fade-out');
      setIsFading(true);
      timerRef.current = setTimeout(() => {
        setActiveCombo(null);
      }, FADE_OUT_DURATION);
    }, displayDuration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeCombo, setActiveCombo]);

  // Camera-relative positioning (same pattern as DecisionButton/PhysicsDice)
  useFrame(({ camera }) => {
    if (!groupRef.current) return;

    const cam = camera as THREE.PerspectiveCamera;
    const hudDepth = 15;
    const fovRad = cam.fov * Math.PI / 180;
    const visibleHeight = 2 * Math.tan(fovRad / 2) * hudDepth;

    _forward.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    _center.copy(cam.position).addScaledVector(_forward, hudDepth);

    // Compute dice top edge dynamically (mirrors PhysicsDice HUD logic)
    const visibleWidth = visibleHeight * cam.aspect;
    const hudCount = useGameStore.getState().placementOrder.length || 5;
    const slotWidth = (visibleWidth * 0.85) / Math.max(hudCount, 1);
    const dieScale = Math.min(slotWidth * 0.65, 1.8) / 2;
    const diceCenterY = visibleHeight * 0.05;       // same as PhysicsDice
    const diceTopEdge = diceCenterY + dieScale;      // top of the tallest die
    const gap = visibleHeight * 0.03 + 0.8;           // 3% viewport + fixed 0.8 world-unit margin
    groupRef.current.position.copy(_center)
      .addScaledVector(_up, diceTopEdge + gap);

    // Billboard: face camera
    groupRef.current.quaternion.copy(cam.quaternion);
  });

  if (!activeCombo) return null;

  const isYacht = activeCombo.tier === 2;
  const tierClass = isYacht ? 'tier-yacht' : '';

  return (
    <group ref={groupRef}>
      {isYacht && (
        <>
          <GoldenWaveStream fading={isFading} />
          <Sparkles
            count={20}
            size={1.5}
            color="#d4a855"
            speed={0.3}
            opacity={0.5}
            scale={[14, 3, 2]}
            position={[0, 0, 0]}
          />
        </>
      )}
      <Html center style={{ pointerEvents: 'none' }}>
        <div className="combo-container">
          {isYacht && <div className="combo-backdrop" />}
          <div ref={fadeRef} className={`combo-text ${tierClass}`}>
            {activeCombo.name}
          </div>
        </div>
      </Html>
    </group>
  );
}
