/** Chat subscription aligned with Stake live chat (UserTags incl. roles). */
const CHAT_SUBSCRIPTION_EXE = `subscription ChatMessages($chatId: String!) {
  chatMessages(chatId: $chatId) {
    ...ChatMessage
    __typename
  }
}

fragment UserTags on User {
  id
  name
  isMuted
  isHighroller
  isPacksCollected
  isSportHighroller
  leaderboardDailyProfitRank
  leaderboardDailyWageredRank
  leaderboardWeeklyProfitRank
  leaderboardWeeklyWageredRank
  flags { flag rank createdAt __typename }
  roles { name expireAt message __typename }
  createdAt
  preferenceHideBets
  __typename
}

fragment ChatMessage on ChatMessage {
  id
  createdAt
  user {
    ...UserTags
  }
  data {
    __typename
    ... on ChatMessageDataRace {
      race {
        id name status startTime
        leaderboard(limit: 10) {
          position
          user { id name __typename }
          __typename
        }
        __typename
      }
      __typename
    }
    ... on ChatMessageDataTrivia {
      status question answer currency amount
      winner { ...UserTags }
      __typename
    }
    ... on ChatMessageDataText { message __typename }
    ... on ChatMessageDataBot { message __typename }
    ... on ChatMessageDataTip {
      tip {
        id amount currency
        sendBy { ...UserTags }
        user { ...UserTags }
        __typename
      }
      __typename
    }
    ... on ChatMessageDataRain {
      rain {
        amount currency
        rainUsers { user { id name __typename } __typename }
        user { ...UserTags }
        __typename
      }
      __typename
    }
  }
  __typename
}`;

module.exports = { CHAT_SUBSCRIPTION_EXE };
