/*
JS Blocker 5 (http://jsblocker.toggleable.com) - Copyright 2015 Travis Lee Roman
*/

"use strict";

var ACTION = {
	SOURCE_DESCRIPTION: 9,
	BLOCK_FIRST_VISIT_NO_NOTIFICATION: 8,
	BLOCK_FIRST_VISIT: 6,
	WHITELIST: 5,
	BLACKLIST: 4,	
	AUTO_ALLOW_USER_SCRIPT: 3,
	AUTO_BLOCK_USER_SCRIPT: 2,
	ALLOW: 1,
	BLOCK: 0,	
	ALLOW_WITHOUT_RULE: -1,
	BLOCK_WITHOUT_RULE: -2,
	AUTO_ALLOW_UNBLOCKABLE: -3,
	AUTO_BLOCK_HIDDEN_FRAME: -4,
	ALLOW_XHR_VIA_PROMPT: -5,
	BLOCK_XHR_VIA_PROMPT: -6,
	BLOCKED_ATTENTION_REQUIRED: -8,
	ALLOW_AFTER_FIRST_VISIT: -9,
	AWAIT_XHR_PROMPT: -10,
	AWAIT_XHR_PROMPT_ALLOWED: -11,
	AUTO_ALLOW_DOCUMENT_FAILURE: -13,
	AUTO_INJECT_PAGE_BLOCKER: -14,
	AUTO_BLOCK_ON_UNBLOCKABLE_FRAME: -16,
	KIND_DISABLED: -85,
	UNBLOCKABLE: -87
};

ACTION._createReverseMap();

Object.freeze(ACTION);

function Rule (store, storeProps, ruleProps) {
	this.action = (ruleProps && typeof ruleProps.action === 'number') ? ruleProps.action : null;
	this.longRuleAllowed = (ruleProps && typeof ruleProps.longRuleAllowed === 'boolean') ? ruleProps.longRuleAllowed : null;
	this.ignoreLock = (ruleProps && !!ruleProps.ignoreLock);

	if (typeof store === 'string')
		this.rules = new Store(store, storeProps);
	else if (store instanceof Store)
		this.rules = store;
	else
		this.rules = new Store(null, storeProps);

	this.addPage = this.__add.bind(this, 'page');
	this.addNotPage = this.__add.bind(this, 'notPage');
	this.addDomain = this.__add.bind(this, 'domain');
	this.addNotDomain = this.__add.bind(this, 'notDomain');
	
	this.removePage = this.__remove.bind(this, false, 'page');
	this.removeNotPage = this.__remove.bind(this, false, 'notPage');
	this.removeDomain = this.__remove.bind(this, false, 'domain');
	this.removeNotDomain = this.__remove.bind(this, false, 'notDomain');

	if (this.rules.useSnapshot && Settings.getItem('autoSnapshots'))
		this.rules.snapshot.autoSnapshots(true);
};

Rule.event = new EventListener;

Rule.listCache = new Store('RuleListCache', {
	ignoreSave: true
});

Rule.withLocationRules = function (allRules, callback) {
	var ruleList,
			ruleKind,
			ruleType,
			domains,
			domain;

	matchingRulesLoop:
	for (ruleList in allRules) {
		for (ruleKind in allRules[ruleList]) {
			for (ruleType in allRules[ruleList][ruleKind]) {
				if (allRules[ruleList][ruleKind][ruleType]) {
					domains = allRules[ruleList][ruleKind][ruleType].data._sort(Rules.__prioritize);

					for (domain in domains)
						if (callback(allRules[ruleList].rule, ruleList, ruleKind, ruleType, domain, domains[domain].value))
							break matchingRulesLoop;
				}
			}
		}
	}
};

Rule.prototype.__add = function (type, kind, domain, rule) {
	if (!this.ignoreLock && Rules.isLockerLocked())
		return;

	if (!Object._isPlainObject(rule))
		throw new TypeError(rule + ' is not an instance of Object');

	if (rule.rule instanceof Object) {
		if (typeof rule.rule.domain !== 'string' || !Array.isArray(rule.rule.protocols))
			throw new Error(rule.rule + ' does not contain a valid domain or protocols definition');

		rule.rule = rule.rule.protocols.join(','), + '|' + rule.rule.domain;
	} else if (typeof rule.rule !== 'string')
		throw new TypeError(rule.rule + ' is not a valid rule');

	if (!Rules.kindSupported(kind))
		throw new Error(Rules.ERROR.KIND.NOT_SUPPORTED);

	var types = this.kind(kind);

	if (!types.hasOwnProperty(type))
		throw new Error(Rules.ERROR.TYPE.NOT_SUPPORTED);

	if (type.toLowerCase()._endsWith('page')) {
	 	if (!Rules.isRegExp(domain))
			throw new TypeError(Rules.ERROR.TYPE.PAGE_NOT_REGEXP);

		try {
			new RegExp(domain);

			domain = domain.toLowerCase();	
		} catch (error) {
			throw new TypeError('Page: ' + error.message);
		}		
	}

	var rules = type._startsWith('not') ? types[type]() : types[type](domain),
			isRegExp = Rules.isRegExp(rule.rule),
			action = typeof this.action === 'number' ? this.action : rule.action;

	if (type._startsWith('not'))
		rules = rules.getStore(domain);

	if (isRegExp)
		try {
			new RegExp(rule.rule);

			rule.rule = rule.rule.toLowerCase();
		} catch (error) {
			throw new TypeError('Rule: ' + error.message + ' - ' + rule.rule);
		}

	this.fixCanLoadCache(type, kind, domain);

	rules.set(rule.rule, {
		regexp: isRegExp,
		action: action,
		meta: rule.meta,
		thirdParty: rule.thirdParty,
		exceptionHosts: rule.exceptionHosts,
	});

	var added = {
		self: this,
		type: type,
		kind: kind,
		domain: domain,
		rule: rule.rule,
		action: action,
		rules: rules
	};

	Rule.event.trigger('ruleWasAdded', added);

	return added;
};

Rule.prototype.__remove = function (domainIsLocation, type, kind, domain, rule) {
	if (!this.ignoreLock && Rules.isLockerLocked())
		return;

	if (kind === undefined) {
		var self = this;

		this.rules.forEach(function (kind) {
			self.__remove(false, type, kind, domain);
		});

		return;
	} else {
		var types = this.kind(kind);

		if (!types.hasOwnProperty(type))
			throw new Error(Rules.ERROR.TYPE.NOT_SUPPORTED);			

		if (domain === undefined)
			types[type]().clear();
		else if (rule === undefined)
			types[type]().remove(domain);
		else {
			if (type._startsWith('not'))
				var rules = types[type]().getStore(domain);
			else
				var rules = types[type](domain, domainIsLocation);

			rules.remove(rule);
		}
	}

	this.fixCanLoadCache(type, kind, domain);

	Rule.event.trigger('ruleWasRemoved', {
		self: this,
		type: type,
		kind: kind,
		domain: domain,
		rule: rule
	});
};

Rule.prototype.fixCanLoadCache = function (type, kind, domain) {
	if (domain === '*' || type._startsWith('not'))
		Resource.canLoadCache.clear();
	else {		
		Resource.canLoadCache.removeMatching(new RegExp('-?' + kind._escapeRegExp() + '-?'));
		Resource.canLoadCache.removeMatching(new RegExp('-?framed:' + kind._escapeRegExp() + '-?'));
	}
};

Rule.prototype.clear = function () {
	if (!this.ignoreLock && Rules.isLockerLocked())
		return;

	this.rules.clear();

	Resource.canLoadCache.clear().saveNow();

	Rule.event.trigger('rulesWereCleared', {
		self: this
	});
};

Rule.prototype.hasAffectOnResource = function (rule, resource, useHideKinds) {
	var canLoad = resource.canLoad(true, useHideKinds);

	if (!canLoad.detail)
		return false;

	var detail = canLoad.detail;

	return {
		hasAffect: detail.ruleList === this && detail.ruleKind === rule.kind && detail.domain === rule.domain && detail.rule === rule.rule,
		detail: detail
	};
};

Rule.prototype.kind = function (kindName) {
	if (typeof kindName !== 'string')
		throw new Error(Rules.ERROR.KIND.NOT_STRING);

	if (!Rules.kindSupported(kindName))
		throw new Error(Rules.ERROR.KIND.NOT_SUPPORTED);

	var kind = this.rules.getStore(kindName);

	kind.__rules = function (type, domain, domainIsLocation) {
		if (!this.hasOwnProperty(type))
			throw new Error(Rules.ERROR.TYPE.NOT_SUPPORTED);

		domainIsLocation = !!domainIsLocation;

		var domains = this.getStore(type);

		if (!domain)
			return domains;

		var isArray = Array.isArray(domain),
				isSimple = !isArray && !type._startsWith('not') && (type === 'domain' || type === 'notDomain' || !domainIsLocation);

		if (isSimple)
			return domains.getStore(domain);

		var baseKey = this.parent ? this.parent.name || this.parent.id : this.name || this.id,
				listCache = Rule.listCache.getStore(baseKey, {
					maxLife: TIME.ONE.HOUR * 12,
				}),
				cacheKey = domains.name + ',' + (isArray ? '[' + domain + ']' : domain) + ',' + domainIsLocation,
				cachedRules = listCache.get(cacheKey);

		if (cachedRules && !cachedRules.destroyed)
			return cachedRules;

		var rules = listCache.getStore(cacheKey, {
			maxLife: Infinity
		}, this);

		if (Array.isArray(domain)) {
			if (type._startsWith('not')) {
				for (var testDomain in domains.data)
					if (!domain._contains(testDomain))
						rules.set(testDomain, domains.get(testDomain));
			} else {
				for (var i = 0; i < domain.length; i++)
					if (domains.keyExist(domain[i]))
						rules.set(domain[i], domains.get(domain[i]));
			}
		} else {
			if (type._startsWith('not')) {
				for (var testDomain in domains.data)
					if (testDomain !== domain)
						rules.set(testDomain, domains.get(testDomain));
			} else {
				var regExp,
						matches;

				for (var testPage in domains.data)
					try {
						regExp = Rules.__regExpCache[testPage] || (Rules.__regExpCache[testPage] = new RegExp(testPage));

						matches = type === 'page' ? regExp.test(domain) : !regExp.test(domain);

						if (matches)
							rules.set(testPage, domains.get(testPage));
					} catch (error) {
						LogError(error);
					}
			}
		}

		return rules;
	};

	kind.page = kind.__rules.bind(kind, 'page');
	kind.domain = kind.__rules.bind(kind, 'domain');
	kind.notPage = kind.__rules.bind(kind, 'notPage');
	kind.notDomain = kind.__rules.bind(kind, 'notDomain');

	return kind;
};

Rule.prototype.domain = function (domain) {
	var rules;

	var self = this,
			kinds = {};

	this.rules.forEach(function (kind) {
		rules = self.kind(kind).domain(domain);

		if (!rules.isEmpty())
			kinds[kind] = rules;
	});

	return kinds;
};

Rule.prototype.page = function (page) {
	var rules;

	var self = this,
			kinds = {};

	this.rules.forEach(function (kind) {
		rules = self.kind(kind).page(page);

		if (!rules.isEmpty())
			kinds[kind] = rules;
	});

	return kinds;
};

Rule.prototype.addMany = function (kinds) {
	if (typeof kinds !== 'object')
		throw new TypeError(kinds + ' is not an object');

	var kind,
			types,
			type,
			domain,
			rule;

	for (kind in kinds) {
		if (!Rules.kindSupported(kind)) {
			LogError(Error(Rules.ERROR.KIND.NOT_SUPPORTED + ' - ' + kind));

			continue;
		}

		types = this.kind(kind);

		for (type in kinds[kind]) {
			if (!types.hasOwnProperty(type)) {
				LogError(Error(Rules.ERROR.TYPE.NOT_SUPPORTED + ' - ' + type));

				continue;
			}

			for (domain in kinds[kind][type])
				for (rule in kinds[kind][type][domain]) {
					if (!(kinds[kind][type][domain][rule] instanceof Object))
						continue;

					kinds[kind][type][domain][rule].rule = rule;

					this.__add(type, kind, domain, kinds[kind][type][domain][rule]);
				}
		}
	}

	return this;
};

Rule.prototype.forLocation = function (params) {
	if (Array.isArray(params.searchKind)) {
		var localParams = params._clone(true),
				rules = {};

		for (var i = 0; i < params.searchKind.length; i++)
			if (params.searchKind[i]) {
				localParams.searchKind = params.searchKind[i];

				rules[params.searchKind[i]] = this.forLocation(localParams);
			}

		Object.defineProperty(rules, 'rule', {
			value: this
		});

		return rules;
	}

	var types = this.kind(params.searchKind),
			location = params.location.toLowerCase(),
			host = params.onlyRulesOfType === Rules.PAGE_RULES_ONLY ? '' : Utilities.URL.extractHost(location),
			hostParts = params.onlyRulesOfType === Rules.PAGE_RULES_ONLY ? [] : (params.excludeParts ? [host] : Utilities.URL.hostParts(host, true));

	if (!params.excludeAllDomains)
		hostParts.push('*');

	var rules = {
		page: params.onlyRulesOfType === Rules.DOMAIN_RULES_ONLY ? undefined : types.page(location, true),
		domain: params.onlyRulesOfType === Rules.PAGE_RULES_ONLY ? undefined : types.domain(hostParts),
		notPage: params.onlyRulesOfType === Rules.DOMAIN_RULES_ONLY ? undefined : types.notPage(location, true),
		notDomain: params.onlyRulesOfType === Rules.PAGE_RULES_ONLY ? undefined : types.notDomain(hostParts)
	};

	if (typeof params.isAllowed === 'boolean')
		for (var type in rules)
			rules[type] = rules[type].map(function (domain, rules, domainStore) {
				return rules.filter(function (rule, value, ruleStore) {
					return (!!(value.action % 2) === params.isAllowed);
				});
			});

	if (params.all === true)
		for (var type in rules)
			rules[type] = rules[type].all();

	Object.defineProperty(rules, 'rule', {
		value: this
	});

	return rules;
};

Rule.prototype.createContentBlocker = function (withTheseRules) {
	var allRules = withTheseRules || this.rules.all(),
			allowingRules = {};

	var map = {
		'*': 1,
		xhr_get: 'raw',
		xhr_post: 'raw',
		xhr_put: 'raw',
		script: 'script',
		frame: 'document',
		image: 'image',
		embed: 'media',
		video: 'media'
	};

	var allKinds = ['raw', 'script', 'document', 'image', 'media', 'font', 'style-sheet'];

	var subDomainBase = '\\/\\/(.+\\.)?';

	var ruleList,
			ruleKind,
			ruleType,
			domains,
			domain,
			rule,
			contentBlockerRules,
			ruleParts,
			ruleSub,
			protocol,
			i;

	var contentBlocker = [];

	for (ruleKind in allRules) {
		if (!(ruleKind in map))
			continue;

		allowingRules._getWithDefault(ruleKind, {});

		for (ruleType in allRules[ruleKind]) {
			if (ruleType._startsWith('not') || ruleType === 'page')
				continue;

			allowingRules[ruleKind]._getWithDefault(ruleType, {});

			if (allRules[ruleKind][ruleType]) {
				domains = allRules[ruleKind][ruleType]._sort(Rules.__prioritize);

				for (domain in domains) {
					allowingRules[ruleKind][ruleType]._getWithDefault(domain, {});

					for (rule in domains[domain]) {
						if (!withTheseRules && (domains[domain][rule].action % 2))
							allowingRules[ruleKind][ruleType][domain][rule] = domains[domain][rule];
						else {
							if (domains[domain][rule].regexp) {
								ruleSub = rule.substr(1);
								ruleSub = ruleSub.substr(0, ruleSub.length - 1);
								ruleSub = ruleSub.replace('[^\\/]', '.');
								ruleSub = ruleSub.replace('[^\\.]', '[a-zA-Z0-9_]');
								ruleSub = ruleSub.replace(new RegExp('([^a-za-z0-9_\\.%-]+|$)'._escapeRegExp(), 'g'), '\\/');
								ruleSub = ruleSub.replace(/\{\d+\}/g, '+');

								if (ruleSub._contains('^') || ruleSub._contains('|'))
									continue;

								contentBlockerRules = [punycode.toASCII(ruleSub)];
							}
							else {
								contentBlockerRules = [];

								ruleParts = Rules.partsForRule(rule);

								for (protocol in ruleParts.protocols) {
									contentBlockerRules.push(protocol === 'about:' ? (protocol + ruleParts.domain) : (protocol + subDomainBase + punycode.toASCII(ruleParts.domain)._escapeRegExp() + '\\/.*'))
								}
							}

							for (i = contentBlockerRules.length; i--;) {
								contentBlocker.push({
									trigger: {
										'url-filter': contentBlockerRules[i],
										'resource-type': ruleKind === '*' ? allKinds : [map[ruleKind]],
										'if-domain': domain === '*' ? undefined : [punycode.toASCII(domain._startsWith('.') ? '*' + domain.substr(1) : domain)]
									},
									action: {
										type: !(domains[domain][rule].action % 2) ? 'block' : 'ignore-previous-rules'
									}
								});
							}
						}
					}
				}
			}
		}
	}

	if (!withTheseRules)
		contentBlocker = contentBlocker.concat(this.createContentBlocker(allowingRules));

	return contentBlocker;
};

var Rules = {
	__contentBlockerMode: false,
	__locked: false,
	__regExpCache: {},
	__partsCache: new Store('RuleParts'),
	__FilterRules: new Store('FilterRules', {
		save: true
	}),

	PAGE_RULES_ONLY: 1,
	DOMAIN_RULES_ONLY: 2,

	ERROR: {
		RULES: {
			NOT_STORE: 'rules is not an instance of Store'
		},
		KIND: {
			NOT_SUPPORTED: 'kind not supported',
			NOT_STRING: 'kind is not a string'
		},
		TYPE: {
			NOT_SUPPORTED: 'type not supported',
			PAGE_NOT_REGEXP: 'Page must begin with ^ and end with $.'
		}
	},

	get fullKindList() {
		var kinds = [];

		for (var i = Rules.__kinds.length; i--;)
			kinds.push(Rules.__kinds[i], 'hide:' + Rules.__kinds[i], 'framed:' + Rules.__kinds[i], 'hide:framed:' + Rules.__kinds[i]);

		return kinds;
	},

	// Used to sort rules so that they are applied based on if the full host is matched or just a sub-domain.
	// lion.toggleable.com > .lion.toggleable.com > .toggleable.com > *
	__prioritize: function (a, b) {
		if (a === '*')
			return 1;

		if (b === '*')
			return -1;

		if (a[0] === '.' && b[0] !== '.')
			return 1;

		if (b[0] === '.' && a[0] !== '.')
			return -1;

		if (a.length > b.length)
			return -1;

		if (b.length > a.length)
			return 1;

		return 0;
	},

	setContentBlockerMode: function (contentBlockerMode) {
		if (!ContentBlocker.isSupported)
			return;

		Rules.__contentBlockerMode = !!contentBlockerMode;

		RemoveContentScripts();

		if (Rules.__contentBlockerMode) {
			ContentBlocker.create(Rules.createContentBlocker());
		} else {
			ContentBlocker.create();

			AddContentScriptFromURL('js/injected/compiled.js');
		}
	},

	createContentBlocker: function () {
		if (!ContentBlocker.isSupported)
			return false;

		var excludeLists = ['description', 'active', 'firstVisit', 'temporary'],
				reverseList = Object.keys(Rules.list).reverse(),
				lists = [];

		for (var i = 0; i < reverseList.length; i++)
			if (!excludeLists._contains(reverseList[i]))
				lists = lists.concat(this.list[reverseList[i]].createContentBlocker());

		return lists;
	},

	onToggleLock: function (event) {
		if (event.detail.key === 'rules') {
			try {
				UI.view.switchTo(UI.Rules.viewContainer.attr('data-activeView'));
			} catch (error) {
				// View not set yet.
			}

			UI.view.switchTo(UI.view.views.attr('data-activeView'));
		}
	},

	attachFilterLists: function (clearCache) {
		var filterLists = Settings.getItem('filterLists'),
				currentLists = Object.keys(Rules.list).filter(function (value) {
					return value._startsWith('$');
				});

		for (var i = currentLists.length; i--;)
			try {
				delete Rules.list[currentLists[i]];
			} catch (e) {}

		for (var filterList in filterLists)
			if (filterLists[filterList].enabled)
				Rules.list[filterList] = new Rule(Rules.__FilterRules.getStore(filterList), null, {
					longRuleAllowed: true,
					ignoreLock: true
				});
			else if (Rules.__FilterRules.keyExist(filterList))
				Rules.__FilterRules.remove(filterList);

		if (clearCache)
			Resource.canLoadCache.clear().saveNow();
	},

	useCurrent: function () {
		this.list.active = this.list.user;

		UI.Rules.buildViewSwitcher();

		UI.view.switchTo('#rule-views-active');

		return this;
	},

	baseKind: function (kind) {
		if (typeof kind !== 'string')
			throw new TypeError(Rules.ERROR.KIND.NOT_STRING);

		return kind.substr(kind.lastIndexOf(':') + 1);
	},

	kindSupported: function (kind) {
		return this.__kinds._contains(this.baseKind(kind));
	},

	kindShouldBadge: function (kind) {
		return !['*', 'special', 'user_script', 'disable']._contains(kind);
	},

	isRegExp: function (rule) {
		return (typeof rule === 'string' && rule._startsWith('^') && rule._endsWith('$'));
	},

	// Splits a simple rule (e.g. HTTP|.google.com) into its protocol and domain parts.
	partsForRule: function (rule) {
		var cached = this.__partsCache.get(rule);

		if (cached)
			return cached;

		var parts = {
			domain: rule,
			protocols: null
		};

		if (rule._contains('|')) {
			parts.domain = rule.substr(rule.indexOf('|') + 1);
			parts.protocols = {};

			var protoArray = rule.split('|')[0].split(',');

			for (var i = 0; i < protoArray.length; i++)
				parts.protocols[protoArray[i].toLowerCase()] = 1;
		}

		return this.__partsCache.set(rule, parts).get(rule);
	},

	// Check if the specified rule should be used on the source.
	matches: function (rule, regexp, source) {
		if (regexp) {
			var regExp = this.__regExpCache[rule] || (this.__regExpCache[rule] = new RegExp(rule.toLowerCase(), 'i'));

			return regExp.test(source);
		} else {
			var sourceHost = Utilities.URL.extractHost(source);

			if (!sourceHost.length)
				return rule === source;

			var ruleParts = this.partsForRule(rule),
					sourceProtocol = Utilities.URL.protocol(source),
					sourceParts = Utilities.URL.hostParts(Utilities.URL.extractHost(source));

			if (ruleParts.protocols && !ruleParts.protocols.hasOwnProperty(sourceProtocol))
				return false;

			return (ruleParts.domain === '*' || ruleParts.domain === source || (ruleParts.domain._startsWith('.') && sourceParts._contains(ruleParts.domain.substr(1))) || sourceParts[0] === ruleParts.domain);
		}
	},

	SourceMatcher: (function () {
		function SourceMatcher (lowerSource, source, pageHost, pageDomain) {
			this.source = source;
			this.lowerSource = lowerSource;
			this.sourceHost = Utilities.URL.extractHost(source);
			this.pageHost = pageHost;
			this.pageDomain = pageDomain;

			if (this.sourceHost.length) {
				this.sourceProtocol = Utilities.URL.protocol(source);
				this.sourceParts = Utilities.URL.hostParts(Utilities.URL.extractHost(source));
			}
		};

		SourceMatcher.prototype.testRule = function (rule, regexp, thirdParty, exceptionHosts) {
			if (thirdParty && this.pageDomain === Utilities.URL.domain(this.lowerSource))
				return -1;

			if (exceptionHosts && exceptionHosts._contains(this.pageHost))
				return -1;

			if (regexp) {
				var regExp = Rules.__regExpCache[rule] || (Rules.__regExpCache[rule] = new RegExp(rule.toLowerCase(), 'i'));

				return regExp.test(this.lowerSource);
			}

			if (!this.sourceHost.length)
				return rule === this.source;

			var ruleParts = Rules.partsForRule(rule);

			if (ruleParts.protocols && !ruleParts.protocols.hasOwnProperty(this.sourceProtocol))
				return false;

			return (ruleParts.domain === '*' || ruleParts.domain === this.source || (ruleParts.domain._startsWith('.') && this.sourceParts._contains(ruleParts.domain.substr(1))) || this.sourceParts[0] === ruleParts.domain);
		}

		return SourceMatcher;
	})(),

	// Load all rules contained in each list for a given location.
	// If the last argument is an array, it will be used to determine which lists to exclude.
	// Temporary rules are only included if the active set is the user set.
	forLocation: function (params) {
		var excludeLists = params.excludeLists ? params.excludeLists : [],
				includeLists = params.includeLists ? params.includeLists : false;

		excludeLists.push('description', 'user');

		if (this.list.active !== this.list.user)
			excludeLists.push('temporary');

		var lists = {};

		if (includeLists) {
			for (var i = includeLists.length; i--;)
				lists[includeLists[i]] = this.list[includeLists[i]].forLocation(params);
		} else
			for (var list in Rules.list)
				if (!excludeLists._contains(list))
					lists[list] = this.list[list].forLocation(params);

		return lists;
	},

	isLocked: function () {
		return this.snapshotInUse() || Locker.isLocked('rules');
	},

	isLockerLocked: function () {
		return Locker.isLocked('rules');
	},

	snapshotInUse: function () {
		return Rules.list.active !== Rules.list.user;
	}
};

Object.defineProperty(Rules, '__kinds', {
	value: Object.freeze([
		'*', 'disable', 'script', 'frame', 'embed', 'video', 'image', 'xhr_get', 'xhr_post', 'xhr_put', 'special', 'user_script'
	])
});

Object.defineProperty(Rules, 'list', {
	value: Object.create({}, {
		description: {
			enumerable: true,
			value: new Rule('SourceDescription', null, {
				action: ACTION.SOURCE_DESCRIPTION,
				ignoreLock: true
			})
		},

		temporary: {
			enumerable: true,
			value: new Rule('TemporaryRules')
		},

		__active: {
			writable: true,
			value: {}
		},

		active: {
			enumerable: true,

			get: function () {
				return this.__active;
			},

			set: function (rules) {
				if (!(rules instanceof Rule))
					throw new TypeError(rules + ' is not an instance of Rule.');

				var exclude = Special.__excludeLists.map(function (name) {
					return 'FilterRules,' + name;
				});

				exclude.push('Predefined', 'TemporaryRules');

				if (rules.rules.name && exclude._contains(rules.rules.name))
					throw new Error('active rules cannot be set to ' + rules.rules.name);

				if (this.__active instanceof Rule)
					Resource.canLoadCache.clear();

				this.__active = rules;
			}
		},

		user: {
			enumerable: true,

			value: new Rule('Rules', {
				save: true,
				snapshot: true,
				maxUnkeptSnapshots: Settings.getItem('snapshotsLimit')
			})
		},

		firstVisit: {
			enumerable: true,

			value: new Rule('FirstVisit', {
				save: true,
				saveDelay: TIME.ONE.MINUTE
			}, {
				ignoreLock: true
			})
		},

		'$predefined': {
			enumerable: true,

			value: new Rule('Predefined', {
				save: true
			}, {
				longRuleAllowed: true,
				ignoreLock: true
			})
		}
	})
});

Rules.attachFilterLists();

Rules.list.active = Rules.list.user;

Rules.__FilterRules.addCustomEventListener('storeDidSave', function (event) {
	Resource.canLoadCache.clear();
});

(function () {
	for (var list in Rules.list) {
		if (list === 'active')
			continue;

		Rules.list[list].rules.all();

		Rules.list[list].rules.addCustomEventListener(['storeDidSave', 'storeWouldHaveSaved'], function (event) {
			Resource.canLoadCache.saveNow();
		});
	}
})();

Rule.event.addCustomEventListener('ruleWasAdded', function (event) {
	Rule.listCache.getStore(event.detail.self.rules.name || event.detail.self.rules.id).clear();

	if ([0, 1]._contains(event.detail.action))
		Utilities.Timer.timeout('setLastRuleWasTemporary', function (list) {
			Settings.setItem('lastRuleWasTemporary', list === Rules.list.temporary);
		}, 100, [event.detail.self]);
});

Rule.event.addCustomEventListener(['ruleWasRemoved', 'rulesWereCleared'], function (event) {
	Rule.listCache.getStore(event.detail.self.rules.name || event.detail.self.rules.id).clear();
});

Locker.event.addCustomEventListener(['locked', 'unlocked'], Rules.onToggleLock);
