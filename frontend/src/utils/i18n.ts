const STORAGE_LANG_KEY = 'yacht_language';

export type Language = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'fr' | 'de';

export const LANGUAGE_LABELS: Record<Language, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  zh: '中文',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
};

export const KO_STRINGS = {
  myTurn: '내 차례 (P1)',
  opponentShort: '상대 (P2)',
  opponentTurn: '상대 차례 (P2)',
  aiTurn: 'AI 차례',
  homeConfirmTitle: '메인 메뉴로 돌아가시겠습니까?',
  homeConfirmDesc: '현재 게임 진행이 초기화됩니다.',
  confirm: '확인',
  cancel: '취소',
  close: '닫기',
  scoreDiff: '점 차이',
  rematch: '다시 하기',
  mainMenu: '메인 메뉴',
  rollPrefix: '굴림',
  reroll: '다시 굴리기',
} as const;

export type TranslationKey = keyof typeof KO_STRINGS;

type TranslationTable = Record<TranslationKey, string>;

const TRANSLATIONS: Record<Language, TranslationTable> = {
  ko: { ...KO_STRINGS },
  en: {
    myTurn: 'Your Turn (P1)',
    opponentShort: 'Opponent (P2)',
    opponentTurn: "Opponent's Turn (P2)",
    aiTurn: "AI's Turn",
    homeConfirmTitle: 'Return to main menu?',
    homeConfirmDesc: 'Current game progress will be reset.',
    confirm: 'OK',
    cancel: 'Cancel',
    close: 'Close',
    scoreDiff: ' point gap',
    rematch: 'Rematch',
    mainMenu: 'Main Menu',
    rollPrefix: 'Roll',
    reroll: 'Re-roll',
  },
  ja: {
    myTurn: '自分のターン (P1)',
    opponentShort: '相手 (P2)',
    opponentTurn: '相手のターン (P2)',
    aiTurn: 'AIのターン',
    homeConfirmTitle: 'メインメニューに戻りますか？',
    homeConfirmDesc: '現在のゲーム進行がリセットされます。',
    confirm: '確認',
    cancel: 'キャンセル',
    close: '閉じる',
    scoreDiff: '点差',
    rematch: 'もう一度',
    mainMenu: 'メインメニュー',
    rollPrefix: '振り',
    reroll: '振り直す',
  },
  zh: {
    myTurn: '我的回合 (P1)',
    opponentShort: '对手 (P2)',
    opponentTurn: '对手的回合 (P2)',
    aiTurn: 'AI 回合',
    homeConfirmTitle: '返回主菜单？',
    homeConfirmDesc: '当前游戏进度将被重置。',
    confirm: '确认',
    cancel: '取消',
    close: '关闭',
    scoreDiff: '分差',
    rematch: '再来一局',
    mainMenu: '主菜单',
    rollPrefix: '掷骰',
    reroll: '重新掷骰',
  },
  es: {
    myTurn: 'Tu turno (P1)',
    opponentShort: 'Rival (P2)',
    opponentTurn: 'Turno del rival (P2)',
    aiTurn: 'Turno de la IA',
    homeConfirmTitle: '¿Volver al menú principal?',
    homeConfirmDesc: 'El progreso actual se reiniciará.',
    confirm: 'Aceptar',
    cancel: 'Cancelar',
    close: 'Cerrar',
    scoreDiff: ' pts de diferencia',
    rematch: 'Revancha',
    mainMenu: 'Menú principal',
    rollPrefix: 'Tirada',
    reroll: 'Volver a tirar',
  },
  fr: {
    myTurn: 'Votre tour (P1)',
    opponentShort: 'Adversaire (P2)',
    opponentTurn: "Tour de l'adversaire (P2)",
    aiTurn: "Tour de l'IA",
    homeConfirmTitle: 'Retourner au menu principal ?',
    homeConfirmDesc: 'La progression actuelle sera réinitialisée.',
    confirm: 'Confirmer',
    cancel: 'Annuler',
    close: 'Fermer',
    scoreDiff: ' pts d\'écart',
    rematch: 'Revanche',
    mainMenu: 'Menu principal',
    rollPrefix: 'Lancer',
    reroll: 'Relancer',
  },
  de: {
    myTurn: 'Dein Zug (P1)',
    opponentShort: 'Gegner (P2)',
    opponentTurn: 'Zug des Gegners (P2)',
    aiTurn: 'Zug der KI',
    homeConfirmTitle: 'Zurück zum Hauptmenü?',
    homeConfirmDesc: 'Der aktuelle Spielstand wird zurückgesetzt.',
    confirm: 'OK',
    cancel: 'Abbrechen',
    close: 'Schließen',
    scoreDiff: ' Punkte Differenz',
    rematch: 'Nochmal',
    mainMenu: 'Hauptmenü',
    rollPrefix: 'Wurf',
    reroll: 'Neu würfeln',
  },
};

function loadLang(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_LANG_KEY);
    if (stored && stored in LANGUAGE_LABELS) return stored as Language;
  } catch {}
  return 'ko';
}

type Listener = () => void;

class I18n {
  private _lang: Language;
  private _listeners = new Set<Listener>();

  constructor() {
    this._lang = loadLang();
  }

  get lang(): Language {
    return this._lang;
  }

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private notify() {
    this._listeners.forEach((l) => l());
  }

  t(key: TranslationKey): string {
    return TRANSLATIONS[this._lang][key];
  }

  setLanguage(lang: Language) {
    this._lang = lang;
    try {
      localStorage.setItem(STORAGE_LANG_KEY, lang);
    } catch {}
    this.notify();
  }
}

export const i18n = new I18n();
