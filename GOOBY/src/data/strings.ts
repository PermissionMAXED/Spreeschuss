import type { MinigameId, ShopId } from "../core/contracts/scenes";

export const STRINGS = {
  appName: "Gooby",
  home: "Living Room",
  close: "Close",
  back: "Back",
  locked: "Locked",
  levelShort: "Lv",
  score: "High score",
  newBest: "New best!",
  nav: {
    Places: "Places",
    Play: "Play",
    Wardrobe: "Wardrobe",
    Items: "Items",
    Settings: "Settings",
  },
  needs: {
    hunger: { label: "Full", icon: "🥕", shape: "diamond" },
    energy: { label: "Rest", icon: "☾", shape: "moon" },
    hygiene: { label: "Clean", icon: "✦", shape: "spark" },
    fun: { label: "Fun", icon: "♥", shape: "heart" },
  },
  actions: {
    feed: "Feed",
    feedHint: "Share a carrot",
    sleep: "Sleep",
    sleepHint: "30 min rest",
    wake: "Wake gently",
    place: "Place in room",
    equip: "Equip",
    equipped: "Equipped",
    play: "Play now",
    startTrip: "Start trip",
    chooseDestination: "Choose destination",
  },
  onboarding: {
    eyebrow: "WELCOME HOME",
    introTitle: "Meet Gooby",
    introBody: "A round little rabbit with a big heart—and a new best friend.",
    introAction: "Meet Gooby",
    petTitle: "Say hello",
    petBody: "Give Gooby a gentle pat. You’ll see Fun perk up.",
    petHint: "Tap Gooby in the room",
    feedTitle: "Share a snack",
    feedBody: "Feed one carrot and watch Full rise.",
    feedHint: "Use the Feed button",
    metersTitle: "You did it!",
    metersBody: "These four meters show what Gooby needs. Small moments of care keep them bright.",
    metersAction: "Welcome home",
    waiting: "Try the step to continue",
    progress: "Care lesson",
  },
  places: {
    title: "Places",
    subtitle: "Home is cozy. City shops begin with a little drive.",
    homeGroup: "At home",
    cityGroup: "Gooby City",
    boardTitle: "Where should we drive?",
    boardBody: "Pick a destination first. Every shop trip starts here.",
    selected: "Destination selected",
    travelNote: "Shops are reached through the city—not by teleporting.",
    returnBlocked: "Let’s finish this first city trip together, then we can head back to the Living Room.",
    livingRoom: "Living Room",
    livingRoomHint: "Pet, feed, rest & decorate",
    kitchen: "Kitchen",
    bathroom: "Bathroom",
    bedroom: "Bedroom",
    garden: "Garden",
    comingSoon: "Opening soon",
  },
  play: {
    title: "Play",
    subtitle: "Twelve tiny adventures. Play at your own pace.",
    unlockAt: (level: number) => `Unlocks at level ${level}`,
    best: (score: number) => `Best ${score.toLocaleString()}`,
    noScore: "No score yet",
    rewardPreview: "Earn coins and XP for every run.",
  },
  results: {
    eyebrow: "ADVENTURE COMPLETE",
    title: "Lovely run!",
    score: "Score",
    coins: "Coins",
    xp: "XP",
    done: "Back to games",
    again: "Play again",
  },
  wardrobe: {
    title: "Wardrobe",
    subtitle: "Try a look, then equip it. Outfits stay saved on this device.",
    preview: "Live preview",
    slots: "Outfit slots",
    head: "Head",
    neck: "Neck",
    body: "Body",
    none: "Nothing",
    saved: "Outfit saved",
  },
  items: {
    title: "Items",
    subtitle: "Snacks for Gooby and cozy pieces for home.",
    food: "Food",
    furniture: "Furniture",
    owned: (count: number) => `${count} owned`,
    carrot: "Sunny carrot",
    carrotBody: "Crunchy, sweet, and Gooby-approved.",
    placeHandoff: (item: string) => `${item} is ready—choose its spot in the Living Room.`,
  },
  sleep: {
    title: "Dreaming softly…",
    body: "Energy fills as Gooby rests.",
    remaining: "remaining",
    earlyWake: "Wake early",
    earlyWakeNote: "Gooby keeps the rest already earned.",
    rationaleTitle: "Want a wake-up note?",
    rationaleBody: "When sleep begins, Gooby can ask your device to let you know when the 30-minute rest is done.",
    rationaleAccept: "Start sleep",
    rationaleLater: "Maybe later",
    celebrationTitle: "Good morning!",
    celebrationBody: "Gooby is rested and ready for a cozy day.",
    celebrationAction: "Let’s go",
  },
  settings: {
    title: "Settings",
    subtitle: "Make Gooby feel right for you.",
    audio: "Sound",
    audioBody: "Music and playful sounds",
    haptics: "Haptics",
    hapticsBody: "Gentle taps for actions",
    motion: "Reduce motion",
    motionBody: "Use calmer transitions",
    notifications: "Sleep reminders",
    notificationsBody: "Asked only when you start sleep",
    on: "On",
    off: "Off",
    credits: "Credits",
    creditsBody: "Designed and built with care. All art, sound, and shapes are generated in the app.",
    privacy: "Privacy",
    privacyBody: "Gooby has no ads, tracking, in-app purchases, or accounts. Your play data stays on this device.",
  },
  chrome: {
    town: "Town",
    pause: "Pause",
    driving: "Driving to",
    minigame: "Adventure",
  },
  toasts: {
    outfitSaved: "Gooby’s new look is saved.",
    settingSaved: "Setting saved on this device.",
    gameLocked: "A little more play will unlock this adventure.",
    noCarrots: "No carrots left—visit the market soon!",
  },
} as const;

export const SHOP_COPY: Readonly<Record<ShopId, {
  readonly title: string;
  readonly icon: string;
  readonly description: string;
}>> = {
  "carrot-market": {
    title: "Carrot Market",
    icon: "🥕",
    description: "Fresh snacks and picnic treats",
  },
  "cloud-boutique": {
    title: "Cloud Boutique",
    icon: "☁",
    description: "Soft outfits and tiny hats",
  },
  "fluff-salon": {
    title: "Fluff Salon",
    icon: "✦",
    description: "Gentle grooming and sparkle",
  },
};

export const MINIGAME_COPY: Readonly<Record<MinigameId, {
  readonly title: string;
  readonly icon: string;
  readonly instructions: string;
}>> = {
  "carrot-catch": {
    title: "Carrot Catch",
    icon: "🥕",
    instructions: "Catch the sweetest carrots before they touch the grass.",
  },
  "bunny-hop": {
    title: "Bunny Hop",
    icon: "🐾",
    instructions: "Time each hop and land on the soft stepping stones.",
  },
  "pancake-peak": {
    title: "Pancake Peak",
    icon: "🥞",
    instructions: "Balance a wonderfully wobbly pancake tower.",
  },
  "bubble-bath-blast": {
    title: "Bubble Bath Blast",
    icon: "◌",
    instructions: "Pop matching bubbles and keep Gooby squeaky clean.",
  },
  "veggie-sort": {
    title: "Veggie Sort",
    icon: "🥬",
    instructions: "Sort colorful vegetables into the matching baskets.",
  },
  "gooby-says": {
    title: "Gooby Says",
    icon: "♪",
    instructions: "Remember Gooby’s gestures and repeat the sequence.",
  },
  "garden-moles": {
    title: "Garden Moles",
    icon: "🌱",
    instructions: "Gently shoo the moles before they nibble the garden.",
  },
  "carrot-cannon": {
    title: "Carrot Cannon",
    icon: "✹",
    instructions: "Aim bouncy carrots at the picnic targets.",
  },
  "delivery-dash": {
    title: "Delivery Dash",
    icon: "▣",
    instructions: "Steer through town and deliver every cozy parcel.",
  },
  "memory-meadow": {
    title: "Memory Meadow",
    icon: "❀",
    instructions: "Find all the matching flower pairs.",
  },
  "pond-fishing": {
    title: "Pond Fishing",
    icon: "≈",
    instructions: "Wait for a nibble, then reel in gently.",
  },
  "rhythm-hop": {
    title: "Rhythm Hop",
    icon: "♫",
    instructions: "Hop to the beat and light up the meadow.",
  },
};

export const WARDROBE_COPY = {
  head: [
    { id: "none", name: "No hat", icon: "·" },
    { id: "sunhat", name: "Sunny hat", icon: "☀" },
    { id: "cloud-cap", name: "Cloud cap", icon: "☁" },
  ],
  neck: [
    { id: "none", name: "No neckwear", icon: "·" },
    { id: "berry-scarf", name: "Berry scarf", icon: "⌁" },
    { id: "daisy-collar", name: "Daisy collar", icon: "✿" },
  ],
  body: [
    { id: "none", name: "No outfit", icon: "·" },
    { id: "meadow-vest", name: "Meadow vest", icon: "♧" },
    { id: "apricot-overalls", name: "Apricot overalls", icon: "▥" },
  ],
} as const;

export const FURNITURE_COPY = [
  { id: "furniture.sofa", name: "Marshmallow sofa", icon: "▰", count: 1 },
  { id: "furniture.rug", name: "Sunrise rug", icon: "▱", count: 1 },
  { id: "furniture.lamp", name: "Glowbud lamp", icon: "♧", count: 1 },
  { id: "furniture.bookshelf", name: "Story shelf", icon: "▥", count: 1 },
] as const;
