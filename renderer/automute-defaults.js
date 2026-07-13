(function (global) {
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
      durationsMinutes: [10, 60, 1440, 10080],
      cooldownMinutes: 5,
      notifyEnabled: true,
      notifySound: '5'
    }
  ];

  global.AutomuteDefaults = {
    DEFAULT_AUTOMUTE_RULES,
    newAutoMuteRuleId() {
      return `am-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }
  };
})(typeof window !== 'undefined' ? window : global);
