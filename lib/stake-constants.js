/** Mirrors, chatrooms, mute periods — from StakeModHub decompile */

const STAKE_MIRRORS = [
  'stake.com',
  'stake.bet',
  'stake.games',
  'staketr.com',
  'staketr2.com',
  'staketr3.com',
  'staketr4.com',
  'staketr5.com',
  'stake.bz',
  'stake.jp',
  'stake.ac',
  'stake.icu'
];

const CHATROOMS = {
  English: 'f0326994-ee9e-411c-8439-b4997c187b95',
  Sports: '5cba7c13-b384-4c52-ad59-f169b23c62f8',
  Challenges: '5d43c7fb-e444-4b0d-aa5e-1E78becd86eb',
  German: '94e807f3-a2fc-4caf-b0ff-ccc613f71879',
  French: '5a6e5063-0154-47eb-9064-f69547213fe5',
  India: '38530077-e0f1-4cf7-8a92-08E9b3c7b63a',
  Turkey: '6ceca59c-394a-40E1-a133-0c2999d687bc',
  Portuguese: '366c04f5-bdea-4415-8E2e-2d6952bf409d',
  Poland: '81458dff-a653-4e9d-88c8-91b77f99e45b',
  Filipino: '688cf7f9-00d9-4E26-aa4f-bd7cc47e3ae4',
  Japan: 'c65b4f32-0001-4e1d-9cd6-e4b3538b43ae',
  Spain: '76609291-6Ff5-4d0c-9ed6-0Fde1d27de33',
  Arab: '2Fcc08ba-9a3d-42bc-9265-90Da709a4035',
  Korea: '18F9a83c-0cfb-4c72-8600-23Fbe0180e45',
  Indonesia: 'e824dc29-68ea-41a4-b69e-60Fe31226e43',
  Norway: 'd58c1cf8-9b8e-4231-bcd7-a6c674f8e6a7',
  Sweden: '009ec486-7a86-4b50-89cd-a41683a05995',
  Russia: '69b2aa0a-53b6-4eed-ada2-ad1d1f4d5bfe',
  Pakistan: '68bb6e93-f9d6-4a27-875a-3ba28db4fb64',
  Finland: '36F221a6-ba29-4d7c-9Fc8-5c8dbe5d0127',
  Vietnam: '8c9994c8-192b-44aa-ac26-f083baf29896',
  Chinese: '96Deb88b-ced9-4b78-b4da-8a65324c2aff'
};

const MUTE_PERIODS = [
  '10 minutes',
  '30 minutes',
  '1 hour',
  '2 hours',
  '4 hours',
  '1 day',
  '2 days',
  '3 days',
  '5 days',
  '1 week',
  '2 weeks',
  '1 month',
  '6 months',
  '1 year',
  'indefinite'
];

const HIGHEST_MULTI_RH_GAMES = ['Crash', 'Slide'];

const STAKE_ORIGINALS = [
  'Mines',
  'Dice',
  'Plinko',
  'Limbo',
  'Keno',
  'Chicken',
  'Crash',
  'Hilo',
  'Dragon Tower',
  'Moles',
  'Flip',
  'Wheel',
  'Pump',
  'Snakes',
  'Roulette',
  'Rock Paper Scissors',
  'Tome of Life',
  'Baccarat',
  'Diamonds',
  'Darts',
  'Packs',
  'Slide',
  'Drill',
  'Prime Dice',
  'Cases',
  'Scarab Spin',
  'Tarot',
  'Video Poker',
  'Bars',
  'Blue Samurai'
];

const GAME_ALIASES = {
  Packs: ['pack', 'packs', 'stake packs'],
  'Blue Samurai': ['blue samurai', 'slots samurai', 'samurai'],
  'Prime Dice': ['prime dice', 'primedice'],
  'Rock Paper Scissors': ['rock paper scissors', 'rps'],
  'Dragon Tower': ['dragon tower', 'dragontower'],
  'Tome of Life': ['tome of life', 'tome'],
  'Video Poker': ['video poker', 'videopoker'],
  'Scarab Spin': ['scarab spin', 'scarab'],
  Chicken: ['chicken', 'stake chicken'],
  Drill: ['drill'],
  Cases: ['cases', 'case'],
  Flip: ['flip'],
  Pump: ['pump'],
  Snakes: ['snakes', 'snake'],
  Moles: ['moles', 'mole'],
  Darts: ['darts', 'dart'],
  Bars: ['bars', 'bar'],
  Tarot: ['tarot'],
  Slide: ['slide', 'multiplayer slide'],
  Crash: ['crash', 'multiplayer crash']
};

/** Same token as StakeModHub.exe WS connection_init */
const LOCKDOWN_TOKEN = 's5MNWtjTM5TvCMkAzxov';

/** Live chat WS host (EXE always uses stake.bet, not the mirror domain). */
const DEFAULT_WS_HOST = 'stake.bet';

const DEFAULT_SETTINGS = {
  stakeDomain: 'stake.bet',
  apiKey: '',
  cookieMethod: 'Non Permanent',
  clearance: '',
  userAgent: '',
  dataPath: '',
  prefChatroom: 'German',
  logChat: true,
  logHash: true,
  maxChatRows: 1000,
  liveChatFontSize: 13,
  colorChatEnabled: true,
  showVipRankBadges: true,
  autodelHour: 23,
  autodelMinute: 59,
  allowedUsers: [],
  useNativeWs: true,
  useCaptureFallback: true,
  wsHost: DEFAULT_WS_HOST,
  rhCrashTimerMinutes: 60,
  rhCrashTimerSeconds: 0,
  autoMessages: [
    {
      id: 'regelpost',
      label: 'Regelpost',
      text: '',
      appendRulesLink: true,
      autoEnabled: false,
      autoIntervalMinutes: 60
    }
  ],
  mentionNotifyEnabled: true,
  mentionNotifySound: 1,
  mentionAliases: [],
  rulePostEnabled: false,
  rulePostIntervalMinutes: 60,
  rulePostExtra: ''
};

const RULE_POST_LINK = 'https://stakecommunity.com/topic/119796-📜deutsche-chatregeln📜/';

module.exports = {
  STAKE_MIRRORS,
  CHATROOMS,
  MUTE_PERIODS,
  HIGHEST_MULTI_RH_GAMES,
  STAKE_ORIGINALS,
  GAME_ALIASES,
  LOCKDOWN_TOKEN,
  DEFAULT_WS_HOST,
  DEFAULT_SETTINGS,
  RULE_POST_LINK
};
