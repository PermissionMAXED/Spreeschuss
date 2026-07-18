import type { AppLanguage } from "../core/contracts/i18n";
import type { MinigameId, ShopId } from "../core/contracts/scenes";
import type { StickerId, StickerPageId } from "../core/contracts/stickers";

export interface NeedCopy {
  readonly label: string;
  readonly icon: string;
  readonly shape: string;
}

export interface WardrobeOptionCopy {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
}

export interface FurnitureCopyItem {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly count: number;
}

export interface ShopCopy {
  readonly title: string;
  readonly icon: string;
  readonly description: string;
}

export interface MinigameCopy {
  readonly title: string;
  readonly icon: string;
  readonly instructions: string;
}

export interface StickerCopy {
  readonly title: string;
  readonly description: string;
}

/**
 * The complete typed string surface. Both shipped languages implement this
 * interface, so missing or extra keys fail the type-check before any runtime
 * parity test runs.
 */
export interface AppStrings {
  readonly appName: string;
  readonly home: string;
  readonly close: string;
  readonly back: string;
  readonly locked: string;
  readonly levelShort: string;
  readonly score: string;
  readonly newBest: string;
  readonly nav: {
    readonly Places: string;
    readonly Play: string;
    readonly Wardrobe: string;
    readonly Items: string;
    readonly Settings: string;
  };
  readonly needs: {
    readonly hunger: NeedCopy;
    readonly energy: NeedCopy;
    readonly hygiene: NeedCopy;
    readonly fun: NeedCopy;
  };
  readonly actions: {
    readonly feed: string;
    readonly feedHint: string;
    readonly sleep: string;
    readonly sleepHint: string;
    readonly wake: string;
    readonly place: string;
    readonly equip: string;
    readonly equipped: string;
    readonly play: string;
    readonly startTrip: string;
    readonly chooseDestination: string;
  };
  readonly onboarding: {
    readonly eyebrow: string;
    readonly introTitle: string;
    readonly introBody: string;
    readonly introAction: string;
    readonly petTitle: string;
    readonly petBody: string;
    readonly petHint: string;
    readonly petAction: string;
    readonly feedTitle: string;
    readonly feedBody: string;
    readonly feedHint: string;
    readonly metersTitle: string;
    readonly metersBody: string;
    readonly metersAction: string;
    readonly waiting: string;
    readonly progress: string;
  };
  readonly places: {
    readonly title: string;
    readonly subtitle: string;
    readonly homeGroup: string;
    readonly cityGroup: string;
    readonly boardTitle: string;
    readonly boardBody: string;
    readonly selected: string;
    readonly travelNote: string;
    readonly returnBlocked: string;
    readonly livingRoom: string;
    readonly livingRoomHint: string;
    readonly kitchen: string;
    readonly bathroom: string;
    readonly bedroom: string;
    readonly garden: string;
    readonly comingSoon: string;
  };
  readonly play: {
    readonly title: string;
    readonly subtitle: string;
    readonly unlockAt: (level: number) => string;
    readonly best: (score: number) => string;
    readonly noScore: string;
    readonly rewardPreview: string;
  };
  readonly results: {
    readonly eyebrow: string;
    readonly title: string;
    readonly score: string;
    readonly coins: string;
    readonly xp: string;
    readonly done: string;
    readonly again: string;
  };
  readonly wardrobe: {
    readonly title: string;
    readonly subtitle: string;
    readonly preview: string;
    readonly slots: string;
    readonly head: string;
    readonly neck: string;
    readonly body: string;
    readonly none: string;
    readonly saved: string;
  };
  readonly items: {
    readonly title: string;
    readonly subtitle: string;
    readonly food: string;
    readonly furniture: string;
    readonly owned: (count: number) => string;
    readonly carrot: string;
    readonly carrotBody: string;
    readonly placeHandoff: (item: string) => string;
    readonly decorControls: string;
    readonly moveForward: string;
    readonly moveBack: string;
    readonly moveLeft: string;
    readonly moveRight: string;
    readonly rotate: string;
    readonly remove: string;
  };
  readonly sleep: {
    readonly title: string;
    readonly body: string;
    readonly remaining: string;
    readonly earlyWake: string;
    readonly earlyWakeNote: string;
    readonly rationaleTitle: string;
    readonly rationaleBody: string;
    readonly rationaleAccept: string;
    readonly rationaleLater: string;
    readonly celebrationTitle: string;
    readonly celebrationBody: string;
    readonly celebrationAction: string;
  };
  readonly settings: {
    readonly title: string;
    readonly subtitle: string;
    readonly audio: string;
    readonly audioBody: string;
    readonly haptics: string;
    readonly hapticsBody: string;
    readonly motion: string;
    readonly motionBody: string;
    readonly notifications: string;
    readonly notificationsBody: string;
    readonly on: string;
    readonly off: string;
    readonly credits: string;
    readonly creditsBody: string;
    readonly privacy: string;
    readonly privacyBody: string;
    readonly clearData: string;
    readonly clearDataTitle: string;
    readonly clearDataBody: string;
    readonly clearDataConfirm: string;
    readonly uiScale: string;
    readonly uiScaleBody: string;
    readonly volumes: string;
    readonly volumesBody: string;
    readonly volumeMaster: string;
    readonly volumeMusic: string;
    readonly volumeSfx: string;
    readonly volumeUi: string;
    readonly volumeVoice: string;
    readonly language: string;
    readonly languageBody: string;
    readonly languageAuto: string;
    readonly languageEnglish: string;
    readonly languageGerman: string;
    readonly devWorkshop: string;
    readonly devWorkshopBody: string;
  };
  readonly chrome: {
    readonly town: string;
    readonly pause: string;
    readonly driving: string;
    readonly minigame: string;
  };
  readonly toasts: {
    readonly outfitSaved: string;
    readonly settingSaved: string;
    readonly gameLocked: string;
    readonly noCarrots: string;
  };
  readonly stickers: {
    readonly title: string;
    readonly subtitle: string;
    readonly progress: (unlocked: number, total: number) => string;
    readonly lockedHint: string;
  };
  readonly minigameCommon: {
    readonly howToPlay: string;
    readonly next: string;
    readonly back: string;
    readonly start: string;
    readonly pause: string;
    readonly paused: string;
    readonly resume: string;
    readonly restart: string;
    readonly quitNoReward: string;
    readonly finishAndCollect: string;
    readonly collect: string;
    readonly playAgain: string;
    readonly time: string;
    readonly score: string;
    readonly best: string;
    readonly streak: string;
    readonly ready: string;
    readonly go: string;
    readonly roundOver: string;
    readonly newBest: string;
    readonly keyboardHint: string;
  };
}

export interface LanguageCatalog {
  readonly language: AppLanguage;
  readonly strings: AppStrings;
  readonly shops: Readonly<Record<ShopId, ShopCopy>>;
  readonly minigames: Readonly<Record<MinigameId, MinigameCopy>>;
  readonly wardrobe: {
    readonly head: readonly WardrobeOptionCopy[];
    readonly neck: readonly WardrobeOptionCopy[];
    readonly body: readonly WardrobeOptionCopy[];
  };
  readonly furniture: readonly FurnitureCopyItem[];
  readonly stickerPages: Readonly<Record<StickerPageId, string>>;
  readonly stickers: Readonly<Record<StickerId, StickerCopy>>;
}
