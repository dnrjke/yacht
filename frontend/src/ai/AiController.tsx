import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { GAME_CONSTANTS } from '@yacht/core';
import { soundManager } from '../utils/soundManager';
import { getPhysicsEngine, requestAiPour } from '../physics/physicsEngine';
import { applyScoreAndAdvance } from '../components/ui/useScoreClick';
import { chooseAction } from './yachtAi';

// 싱글 모드 AI(P2) 턴 오케스트레이터. 화면 출력 없음.
// store 상태 전이에 반응: canPour → 붓기 요청 / placement → 키핑·리롤·기입.
// 모든 스텝은 사람 같은 딜레이를 두고 실행하며, 실행 직전 상태를 재검증한다
// (홈 이탈·리셋·리매치 도중 잔여 타이머가 오동작하지 않도록).

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function stillAiTurn(): boolean {
  const s = useGameStore.getState();
  return s.gameMode === 'single' && s.currentTurn === 'p2' && s.phase === 'GAME';
}

// DecisionButton의 리롤 동작 재현
function doReroll() {
  const store = useGameStore.getState();
  if (!store.isInPlacementMode) return;
  soundManager.play('reroll');
  store.setIsInPlacementMode(false);
  store.setIsSyncingDice(true);

  if (store.placementOrder.length > 0) {
    store.setIsReturningToCup(true);
  } else {
    const physics = getPhysicsEngine();
    if (physics) {
      physics.spawnNonKeptDiceInCup(store.keptDiceSlots);
    }
    store.setIsSyncingDice(false);
    store.setCanPour(true);
  }
}

export function AiController() {
  const gameMode = useGameStore(s => s.gameMode);
  const currentTurn = useGameStore(s => s.currentTurn);
  const canPour = useGameStore(s => s.canPour);
  const isInPlacementMode = useGameStore(s => s.isInPlacementMode);

  const isAiTurn = gameMode === 'single' && currentTurn === 'p2';

  // 붓기: 사고 딜레이 후 PhysicsCup에 셰이크 요청
  useEffect(() => {
    if (!isAiTurn || !canPour || isInPlacementMode) return;
    const id = window.setTimeout(() => {
      if (stillAiTurn() && useGameStore.getState().canPour) {
        requestAiPour();
      }
    }, rand(700, 1300));
    return () => clearTimeout(id);
  }, [isAiTurn, canPour, isInPlacementMode]);

  // placement: 키핑 조정 → 리롤 또는 점수 기입
  useEffect(() => {
    if (!isAiTurn || !isInPlacementMode) return;

    let cancelled = false;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        if (!cancelled && stillAiTurn() && useGameStore.getState().isInPlacementMode) fn();
      }, ms);
      timers.push(id);
    };

    later(() => {
      const s = useGameStore.getState();
      const rollsLeft = GAME_CONSTANTS.MAX_ROLLS_PER_TURN - s.rollCount;
      const decision = chooseAction(s.currentDiceValues, s.scores.p2, rollsLeft);

      if (decision.action === 'score') {
        later(() => applyScoreAndAdvance(decision.category), 450);
        return;
      }

      // 현재 킵 상태와 목표 킵의 차이만큼 순차 탭
      const kept = s.keptDiceSlots.filter((v): v is number => v !== null);
      const toUnkeep = kept.filter(i => !decision.keepIndices.includes(i));
      const toKeep = decision.keepIndices.filter(i => !kept.includes(i));

      let delay = 0;
      toUnkeep.forEach(i => {
        delay += rand(320, 480);
        later(() => {
          useGameStore.getState().unkeepDie(i);
          soundManager.play('tap_smooth');
        }, delay);
      });
      toKeep.forEach(i => {
        delay += rand(320, 480);
        later(() => {
          useGameStore.getState().keepDie(i);
          soundManager.play('tap');
        }, delay);
      });

      later(() => doReroll(), delay + rand(550, 800));
    }, rand(800, 1300));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [isAiTurn, isInPlacementMode]);

  return null;
}
