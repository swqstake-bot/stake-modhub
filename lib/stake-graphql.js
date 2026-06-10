const { normalizeHostname } = require('./stake-session');
const { normalizeBetIdForLookup } = require('./bet-id-parse');
const { stakePostJson, StakeHttpError } = require('./stake-http');

/** Aligned with ChatCheck extension / StakeModHub — per-type fields differ (e.g. EvolutionBet uses createdAt). */
const BET_LOOKUP_QUERY = `query BetLookup($iid: String) {
  bet(iid: $iid) {
    id
    iid
    type
    scope
    game { name icon slug }
    bet {
      ... on CasinoBet {
        ...CasinoBet
        user { id name preferenceHideBets }
      }
      ... on EvolutionBet {
        ...EvolutionBet
        user { id name preferenceHideBets }
      }
      ... on MultiplayerCrashBet {
        ...MultiplayerCrashBet
        user { id name preferenceHideBets }
      }
      ... on MultiplayerSlideBet {
        ...MultiplayerSlideBet
        user { id name preferenceHideBets }
      }
      ... on SoftswissBet {
        ...SoftswissBet
        user { id name preferenceHideBets }
      }
      ... on ThirdPartyBet {
        ...ThirdPartyBet
        user { id name preferenceHideBets }
      }
    }
  }
}

fragment CasinoBet on CasinoBet {
  id active payoutMultiplier amountMultiplier amount payout updatedAt currency game
  user { id name }
}

fragment EvolutionBet on EvolutionBet {
  id amount currency createdAt payout payoutMultiplier
  user { id name }
  softswissGame: game { id name edge }
}

fragment MultiplayerCrashBet on MultiplayerCrashBet {
  id payoutMultiplier gameId amount payout currency result updatedAt cashoutAt
  user { id name preferenceHideBets }
}

fragment MultiplayerSlideBet on MultiplayerSlideBet {
  id payoutMultiplier gameId amount payout currency slideResult: result updatedAt cashoutAt active createdAt
  user { id name preferenceHideBets }
}

fragment SoftswissBet on SoftswissBet {
  id amount currency updatedAt payout payoutMultiplier
  user { id name }
  softswissGame: game { id name edge extId provider { id name } }
}

fragment ThirdPartyBet on ThirdPartyBet {
  id amount currency updatedAt payout payoutMultiplier betReplay
  user { id name preferenceHideBets }
  thirdPartyGame: game { id name edge extId provider { id name } }
}`;

class StakeGraphQL {
  constructor(getSettings, getCookieHeader, beforeRequest) {
    this.getSettings = getSettings;
    this.getCookieHeader = getCookieHeader;
    this.beforeRequest = beforeRequest;
    this.lastRequestTime = 0;
    this.minIntervalMs = 400;
  }

  endpoint() {
    const s = this.getSettings();
    const host = normalizeHostname(s.stakeDomain);
    return `https://${host}/_api/graphql`;
  }

  origin() {
    const s = this.getSettings();
    return `https://${normalizeHostname(s.stakeDomain)}`;
  }

  async throttle() {
    const now = Date.now();
    const wait = this.minIntervalMs - (now - this.lastRequestTime);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestTime = Date.now();
  }

  buildHeaders(operationName, opType = 'query') {
    const s = this.getSettings();
    const origin = this.origin();
    const headers = {
      'Content-Type': 'application/json',
      Accept: opType === 'mutation' ? 'application/graphql+json, application/json' : '*/*',
      Origin: origin,
      Referer: `${origin}/`,
      'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'x-language': 'de'
    };
    const ua =
      (s.userAgent && String(s.userAgent).trim()) ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    headers['User-Agent'] = ua;
    if (s.apiKey) headers['x-access-token'] = s.apiKey;
    if (operationName) {
      headers['x-operation-name'] = operationName;
      headers['x-operation-type'] = opType;
    }
    const jar = this.getCookieHeader && this.getCookieHeader();
    if (jar && String(jar).trim()) {
      headers.Cookie = String(jar).trim();
    } else if (s.clearance) {
      const cfName = s.cookieMethod === 'Permanent' ? 'cf_clearance' : '__cf_bm';
      headers.Cookie = `${cfName}=${s.clearance}`;
    }
    return headers;
  }

  async query(query, variables = {}, operationName = null, opType = 'query') {
    await this.throttle();
    if (this.beforeRequest) await this.beforeRequest();
    const body = { query, variables, operationName: operationName || undefined };
    if (opType === 'mutation' && operationName) body.operationName = operationName;
    const { parsed } = await stakePostJson(this.endpoint(), this.buildHeaders(operationName, opType), body);
    const data = parsed;
    if (Array.isArray(data?.errors) && data.errors.length) {
      throw new Error(data.errors[0].message || 'GraphQL error');
    }
    return data.data;
  }

  async initialUserRequest() {
    const query = `query initialUserRequest {
      user { id name email roles { name __typename } __typename }
    }`;
    return this.query(query, {}, 'initialUserRequest');
  }

  async sendMessage(chatId, message) {
    const query = `mutation SendMessage($chatId: String!, $message: String!) {
      sendMessage(chatId: $chatId, message: $message) { id __typename }
    }`;
    return this.query(query, { chatId, message }, 'SendMessage', 'mutation');
  }

  async muteUser(userId, expire, message) {
    const query = `mutation MuteUser($userId: String!, $expire: Duration, $message: String) {
      muteUser(userId: $userId, expire: $expire, message: $message) {
        id name isMuted __typename
      }
    }`;
    return this.query(query, { userId, expire, message }, 'MuteUser', 'mutation');
  }

  async unmuteUser(userId) {
    const query = `mutation UnmuteUser($userId: String!) {
      unmuteUser(userId: $userId) { id name isMuted __typename }
    }`;
    return this.query(query, { userId }, 'UnmuteUser', 'mutation');
  }

  static userTagsFragment() {
    return `fragment UserTags on User {
      id name isMuted isRainproof isIgnored isHighroller isSportHighroller
      leaderboardDailyProfitRank leaderboardDailyWageredRank
      leaderboardWeeklyProfitRank leaderboardWeeklyWageredRank
      preferenceHideBets
      flags { flag rank createdAt __typename }
      roles { name expireAt message __typename }
      createdAt
    }`;
  }

  async getUserHash(name) {
    const query = `query UserHash($name: String!) {
      user(name: $name) { id name hashedIp ...UserTags }
    }
    ${StakeGraphQL.userTagsFragment()}`;
    return this.query(query, { name }, 'UserHash');
  }

  async getUserDetails(name) {
    const query = `query UserDetails($name: String!) {
      user(name: $name) {
        ...UserTags
        statistic { bets game wins losses ties betAmount currency __typename }
      }
    }
    ${StakeGraphQL.userTagsFragment()}`;
    return this.query(query, { name }, 'UserDetails');
  }

  async getUserChatHistory(name, limit = 50, offset = 0) {
    const query = `query UserChatHistory($name: String!, $limit: Int, $offset: Int) {
      user(name: $name) {
        id name
        chatHistory(limit: $limit, offset: $offset) {
          id createdAt
          chat { name __typename }
          data {
            __typename
            ... on ChatMessageDataText { message }
            ... on ChatMessageDataBot { message }
            ... on ChatMessageDataTip {
              tip {
                amount currency
                sendBy { name }
                user { name }
              }
            }
            ... on ChatMessageDataRain {
              rain { amount currency user { name } }
            }
            ... on ChatMessageDataTrivia { status question amount currency }
            ... on ChatMessageDataRace { race { name status } }
          }
        }
      }
    }`;
    return this.query(query, { name, limit, offset }, 'UserChatHistory');
  }

  async getUserTipHistory(name, limit = 50, offset = 0) {
    const query = `query UserTipHistory($name: String!, $limit: Int, $offset: Int) {
      user(name: $name) {
        id name
        tipHistory(limit: $limit, offset: $offset) {
          id amount currency createdAt isPublic
          sendBy { id name }
          user { id name }
          chat { id name }
        }
      }
    }`;
    return this.query(query, { name, limit, offset }, 'UserTipHistory');
  }

  async getCommunityUser(name, limit = 10, offset = 0) {
    const query = `query CommunityUser($name: String!, $limit: Int, $offset: Int) {
      user(name: $name) {
        id name isMuted hashedIp
        community {
          messageCount lastRain
          muteList(limit: $limit, offset: $offset) {
            message createdAt expireAt
            authUser { id name hashedIp }
          }
        }
      }
    }`;
    return this.query(query, { name, limit, offset }, 'CommunityUser');
  }

  normalizeBetIid(betId) {
    const iid = normalizeBetIdForLookup(betId);
    if (!iid) throw new Error('empty_bet_id');
    return iid;
  }

  async getCurrencyConversionRates() {
    const query = `query CurrencyConversionRate {
      info {
        currencies {
          name
          usd: value(fiatCurrency: usd)
          eur: value(fiatCurrency: eur)
        }
      }
    }`;
    const data = await this.query(query, {}, 'CurrencyConversionRate');
    const map = {};
    for (const c of data?.info?.currencies || []) {
      if (c?.name) map[String(c.name).toLowerCase()] = { usd: Number(c.usd) || 0, eur: Number(c.eur) || 0 };
    }
    return map;
  }

  extractBetDetail(betWrap) {
    if (!betWrap) return null;
    const game = betWrap.game?.name || '';
    const b = betWrap.bet || {};
    const payoutMultiplier = b.payoutMultiplier || b.amountMultiplier || 0;
    const amount = b.amount != null ? b.amount : null;
    const payout = b.payout != null ? b.payout : null;
    const currency = b.currency || '';
    const updatedAt = b.updatedAt || b.createdAt || null;
    const user = b.user?.name || null;
    const gameFromBet =
      typeof b.game === 'string' ? b.game : b.game?.name || '';
    const gameName =
      game || b.softswissGame?.name || b.thirdPartyGame?.name || gameFromBet || '';
    // Bei versteckten Wetten liefert die API kein user-Objekt (bzw. preferenceHideBets=true)
    const hidden = !b.user || b.user.preferenceHideBets === true;
    return {
      iid: betWrap.iid,
      game: gameName,
      multiplier: Number(payoutMultiplier) || 0,
      hidden,
      amount: amount != null ? Number(amount) : null,
      payout: payout != null ? Number(payout) : null,
      currency,
      updatedAt,
      user,
      raw: betWrap
    };
  }

  async getBetLookup(betId) {
    const iid = this.normalizeBetIid(betId);
    const data = await this.query(BET_LOOKUP_QUERY, { iid }, 'BetLookup');
    return this.extractBetDetail(data?.bet);
  }
}

module.exports = { StakeGraphQL, StakeHttpError };
