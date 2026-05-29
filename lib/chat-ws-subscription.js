/** Chat subscription aligned with StakeModHub.exe (Form1.cs) */
const CHAT_SUBSCRIPTION_EXE = `subscription ChatMessages($chatId: String!) {
  chatMessages(chatId: $chatId) {
    ...ChatMessage
    __typename
  }
}

fragment ChatMessage on ChatMessage {
  id
  createdAt
  user { id name __typename }
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
      winner { id name __typename }
      __typename
    }
    ... on ChatMessageDataText { message __typename }
    ... on ChatMessageDataBot { message __typename }
    ... on ChatMessageDataTip {
      tip {
        id amount currency
        sendBy { id name __typename }
        user { id name __typename }
        __typename
      }
      __typename
    }
    ... on ChatMessageDataRain {
      rain {
        amount currency
        rainUsers { user { id name __typename } __typename }
        user { id name __typename }
        __typename
      }
      __typename
    }
  }
  __typename
}`;

module.exports = { CHAT_SUBSCRIPTION_EXE };
