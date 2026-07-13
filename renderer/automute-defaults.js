(function (global) {
  const DEFAULT_STRIKE_PERIODS = ['10 minutes', '1 hour', '1 day', '1 week'];

  const DEFAULT_AUTOMUTE_RULES = [
    {
      id: 'account-spam-default',
      label: 'Account-Verkauf / Discord Spam',
      enabled: false,
      matchMode: 'contains',
      matchAll: false,
      patterns: [
        'buying stake',
        'buying stake accounts',
        'sell stake account',
        'amibo121',
        'add on discord',
        'discord'
      ],
      minLength: 20,
      muteReason: 'low quality chat / spam',
      mutePeriods: [...DEFAULT_STRIKE_PERIODS],
      chatNotifyEnabled: false,
      chatNotifyText: '@user Muted - Account Trading - Deutsche Chatregeln',
      notifyEnabled: true,
      notifySound: '5'
    }
  ];

  global.AutomuteDefaults = {
    DEFAULT_AUTOMUTE_RULES,
    DEFAULT_STRIKE_PERIODS,
    newAutoMuteRuleId() {
      return `am-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }
  };
})(typeof window !== 'undefined' ? window : global);
