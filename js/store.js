"use strict";

var Store = (function () {
	var data = {},
			parent = {},
			children = {};

	function Store (name, props) {
		if (!(props instanceof Object))
			props = {};

		this.maxLife = (typeof props.maxLife === 'number') ? props.maxLife : Infinity;
		this.selfDestruct = (typeof props.selfDestruct === 'number') ? props.selfDestruct : 0;
		this.deepDestruction = !!props.deepDestruction;
		this.lock = !!props.lock;
		this.save = !!props.save;
		this.useSnapshot = !!props.snapshot;
		this.ignoreSave = !!props.ignoreSave;
		this.private = !!props.private;
		this.myChildren = this.private ? {} : children;
		this.myParent = this.private ? {} : parent;

		if (SettingStore.available() && typeof name === 'string' && name.length)
			this.id = (props.save ? 'Storage-' : 'Cache-') + name;
		else
			this.id = Utilities.id();

		this.name = name;
		this.props = props;

		this.listeners = {};
		
		if (!this.private)
			Object.defineProperty(this, 'data', {
				enumerable: true,
				
				get: function () {
					return data[this.id];
				},
				set: function (value) {
					data[this.id] = value;
				}
			});

		if (this.maxLife < Infinity) {
			var cleanupName = 'StoreCleanup-' + this.id;

			Utilities.Timer.interval(cleanupName, function (store, cleanupName) {
				if (store.destroyed)
					Utilities.Timer.remove('interval', cleanupName);
				else
					store.removeExpired();
			}, this.maxLife, [this, cleanupName]);
		}

		this.prolongDestruction();		

		var defaultValue = {};

		if (props.defaultValue instanceof Object)
			for (var key in props.defaultValue)
				defaultValue[key] = {
					accessed: Date.now(),
					value: props.defaultValue[key]
				}

		if (!this.data)
			this.load(defaultValue);
		
		if (this.useSnapshot)
			this.snapshot = new Snapshot(this);

		props = name = undefined;
	};

	Store.destroyAll = function () {
		for (var key in Utilities.Timer.timers.timeouts)
			if (key._startsWith('SelfDestruct'))
				Utilities.Timer.timers.timeouts[key].script.apply(null, Utilities.Timer.timers.timeouts[key].args);
	};

	Store.promote = function (object) {
		if (typeof object.data !== 'object')
			throw new TypeError('cannot create store from object');

		var store = new Store(object.name, object.props);

		store.data = object.data;

		return store;
	};

	Store.compare = function (left, right) {
		if (!(left instanceof Store) || !(right instanceof Store))
			throw new TypeError('left or right is not an instance of Store');

		var key,
				thisValue,
				oppositeValue,
				compared,
				comparedSide,
				inside;

		var swap = {
			left: 'right',
			right: 'left'
		};

		var compare = {
			left: left,
			right: right
		};

		var store = Store.compareCache.getStore([left.name, right.name].join('-'));

		var sides = {
			left: store.getStore('left'),
			right: store.getStore('right'),
			both: store.getStore('both')
		};

		for (var side in compare) {
			for (key in compare[side].data) {
				thisValue = compare[side].get(key);
				oppositeValue = compare[swap[side]].get(key);

				if (typeof thisValue === 'undefined' && typeof oppositeValue === 'undefined')
					sides.both.set(key, undefined)
				else if (typeof oppositeValue === 'undefined')
					sides[side].set(key, thisValue);
				else if (thisValue instanceof Store) {
					compared = Store.compare(compare.left.getStore(key), compare.right.getStore(key));

					compared.store.parent = store;

					for (comparedSide in sides) {
						inside = compared.sides[comparedSide];

						if (!inside.data._isEmpty())
							sides[comparedSide].set(key, inside);
					}
				} else if (JSON.stringify(thisValue) === JSON.stringify(oppositeValue))
					sides.both.set(key, thisValue);
				else if (typeof thisValue !== 'undefined')
					sides[side].set(key, thisValue);
			}
		}

		sides.left = sides.left.toJSON();
		sides.right = sides.right.toJSON();

		return {
			store: store,
			sides: sides,
			equal: (sides.left.data._isEmpty() && sides.right.data._isEmpty())
		};
	};

	Object.defineProperty(Store.prototype, 'parent', {
		get: function () {
			return this.private ? this.myParent[this.id] : parent[this.id];
		},
		set: function (newParent) {			
			if (newParent instanceof Store) {
				newParent.children[this.id] = this;

				this.myParent[this.id] = newParent;
			} else if (newParent === null) {
				delete this.myParent[this.id];

				for (var key in this.myChildren)
					delete this.myChildren[key][this.id];
			} else
				throw new Error('parent is not null or an instance of Store');
		}
	});

	Object.defineProperty(Store.prototype, 'children', {
		get: function () {
			if (!this.myChildren[this.id])
				this.myChildren[this.id] = {};

			return this.myChildren[this.id];
		},
		set: function (v) {
			delete this.myChildren[this.id];
		}
	});

	Store.BREAK = -54684513;

	Store.prototype.__save = function (bypassIgnore) {
		if (this.lock || (this.ignoreSave && !bypassIgnore))
			return;

		if (this.save)
			Utilities.Timer.timeout('StoreSave' + this.id, function (store) {
				Log('Save', store.id);

				store.trigger('save');

				SettingStore.setJSON(store.id, store);
			}, TIME.ONE_SECOND * 1.5, [this]);

		if (this.parent)
			this.parent.__save(true);
	};

	Store.prototype.__listener = function (add, name, fn) {
		if (!this.listeners[name])
			this.listeners[name] = [];

		if (typeof fn !== 'function')
			throw new TypeError('fn is not a function');

		if (add)
			this.listeners[name].push(fn);
		else
			this.listeners[name] = this.listeners[name].filter(function (testFn) {
				return testFn !== fn;
			});
	};

	Store.prototype.addListener = function (name, fn) {
		return this.__listener(true, name, fn);
	};

	Store.prototype.removeListener = function (name, fn) {
		return this.__listener(false, name, fn);
	};

	Store.prototype.load = function (defaultValue) {
		if (this.save) {
			var stored = SettingStore.getJSON(this.id, {
				data: defaultValue
			});

			if (stored.lock)
				this.lock = true;

			this.data = stored.data;
		} else
			this.data = defaultValue;
	};

	Store.prototype.reload = function (defaultValue) {
		if (!this.save)
			throw new Error('cannot reload a store that is not saved.');

		this.destroy(true, true);

		delete this.destroyed;

		this.load(defaultValue);
	};

	Store.prototype.trigger = function (name) {
		Utilities.Timer.timeout('StoreTrigger' + this.id + name, function (store, name) {
			if (store.listeners.hasOwnProperty(name))
				for (var i = 0; i < store.listeners[name].length; i++)
					store.listeners[name][i](store);

			if (store.parent)
				store.parent.trigger(name);
		}, 500, [this, name]);
	};

	Store.prototype.isEmpty = function () {
		return !this.data || this.data._isEmpty();
	};

	Store.prototype.keys = function () {
		return Object.keys(this.data);
	};

	Store.prototype.keyExist = function (key) {
		return (key in this.data);
	};

	Store.prototype.clone = function (prefix, props) {
		var value;

		var store = new Store([prefix, this.name].join(), props),
				newData = {};

		for (var key in this.data) {
			value = this.get(key);

			if (value instanceof Store)
				newData[key] = {
					accessed: Date.now(),
					value: value.clone(prefix, props)
				};
			else if (typeof value !== 'undefined')
				newData[key] = {
					accessed: Date.now(),
					value: value
				};
		}

		store.data = newData;

		return store;
	};

	Store.prototype.merge = function (store, deep) {
		if (!(store instanceof Store))
			throw new TypeError('Store is not an instance of Store');

		var currentValue,
				storeValue;

		for (var key in store.data) {
			currentValue = this.get(key);
			storeValue = store.get(key);

			if (deep && (currentValue instanceof Store) && (storeValue instanceof Store))
				currentValue.merge(storeValue, true);
			else
				this.set(key, storeValue);
		}

		return this;
	};

	Store.prototype.find = function (fn) {
		if (typeof fn !== 'function')
			throw new TypeError('fn is not a function');

		var value;

		for (var key in this.data) {
			value = this.get(key);

			if (fn(key, value, this))
				break;
		}

		return value;
	};

	Store.prototype.findLast = function (fn) {
		if (typeof fn !== 'function')
			throw new TypeError('fn is not a function');

		var value;

		var keys = this.keys().reverse(),
				found = false;

		for (var i = 0; i < keys.length; i++) {
			value = this.get(keys[i]);

			if (fn(keys[i], value, this)) {
				found = true;

				break;
			}
		}

		return found ? value : null;
	};

	Store.prototype.forEach = function (fn) {
		if (typeof fn !== 'function')
			throw new TypeError('fn is not a function');

		var value,
				result;

		var results = [];

		for (var key in this.data) {
			value = this.get(key);
			result = fn(key, value, this);

			if (result === Store.BREAK)
				break;

			results.push({
				key: ((result instanceof Object) && result.key) ? result.key : key,
				value: value,
				result: ((result instanceof Object) && result.value) ? result.value : result
			});
		}

		return results;
	};

	Store.prototype.map = function (fn) {
		var results = this.forEach(fn);

		var store = new Store(null, {
			selfDestruct: TIME.ONE_MINUTE * 5
		});

		for (var i = 0; i < results.length; i++)
			store.set(results[i].key, results[i].result);

		return store;
	};

	Store.prototype.filter = function (fn, name) {
		var results = this.forEach(fn);

		var store = new Store(name, {
			selfDestruct: TIME.ONE_MINUTE * 5
		});

		store.clear();

		for (var i = 0; i < results.length; i++)
			if (results[i].result)
				store.set(results[i].key, results[i].value);

		return store;
	};

	Store.prototype.only = function (fn) {
		var results = this.forEach(fn);

		for (var i = 0; i < results.length; i++)
			if (!results[i].result)
				this.remove(results[i].key);

		return this;
	};

	Store.prototype.set = function (key, value, overwrite) {
		if (this.lock) {
			if (value instanceof Store) {
				value.lock = true;

				return value;
			}

			return null;
		}

		this.prolongDestruction();

		if (this.data[key] && !this.data.hasOwnProperty(key))
			throw new Error('key is in the prototype chain of data');

		if (typeof overwrite !== 'boolean')
			overwrite = (typeof value !== 'function');

		if (!overwrite && (key in this.data))
			return this.get(key);

		this.data[key] = {
			accessed: Date.now(),
			value: value,
		};

		if (!this.ignoreSave)
			if (value instanceof Store) {
				value.parent = this;

				setTimeout(function (store, value) {
					if (!value.toJSON().data._isEmpty())
						store.__save();
				}, 100, this, value);
			} else
				this.__save();

		if (value instanceof Store)
			return this.data[key].value;

		return this;
	};

	Store.prototype.setMany = function (object, overwrite) {
		if (typeof object === 'object')
			for (var key in object)
				if (object.hasOwnProperty(key))
					this.set(key, object[key], overwrite);

		return this;
	};

	Store.prototype.get = function (key, defaultValue, asReference) {
		this.prolongDestruction();

		if (this.data.hasOwnProperty(key)) {
			this.data[key].accessed = Date.now();

			var cached = this.data[key].value;

			if (!(cached instanceof Store))
				try {
					if (cached.props)
						cached.props.private = cached.props.private || this.private;

					var value = Store.promote(cached);

					value.parent = this;

					this.data[key] = {
						accessed: Date.now(),
						value: value
					};

					return value;
				} catch (error) {
					switch (true) {
						case asReference:
							return cached;
						break;

						case Array.isArray(cached):
							return Utilities.makeArray(cached);
						break;

						case typeof cached === 'string':
							return cached.toString();
						break;

						case cached && cached.constructor.name === 'Object':
							return cached._clone();
						break;

						default:
							return cached;
						break;
					}
				}
			else if (!cached.destroyed)
				return cached;
		} else if (typeof defaultValue === 'function')
			return this.set(key, defaultValue);
		else if (typeof defaultValue !== 'undefined')
			return this.set(key, defaultValue).get(key, undefined, asReference);
	};

	Store.prototype.getMany = function (keys) {
		return this.filter(function (key) {
			return keys._contains(key);
		});
	};

	Store.prototype.getStore = function (key, defaultProps) {
		var store = this.get(key),
				requiredName = [this.name || this.id, key].join();

		if (!(store instanceof Store)) {
			if (!(defaultProps instanceof Object))
				defaultProps = {};

			defaultProps.private = defaultProps.private || this.private;

			return this.set(key, new Store(requiredName, defaultProps), true);
		}

		return store;
	};

	Store.prototype.decrement = function (key, by, start) {
		var current = this.get(key, start || 0);

		if (typeof current !== 'number')
			current = start || 0;

		this.set(key, current - (by || 1));

		return this;
	};

	Store.prototype.increment = function (key, by, start) {
		var current = this.get(key, start || 0);

		if (typeof current !== 'number')
			current = start || 0;

		this.set(key, current + (by || 1));

		return this;
	};

	Store.prototype.remove = function (key) {
		if (this.lock)
			return;

		if (typeof key === 'undefined') {
			if (this.parent)
				this.parent.forEach(function (key, value, store) {
					if (value === this)
						store.remove(key);
				}.bind(this));

			return this;
		}

		if (this.data.hasOwnProperty(key))
			delete this.data[key];

		this.__save();

		return this;
	};

	Store.prototype.removeExpired = function () {
		if (this.lock)
			return;

		var now = Date.now();

		for (var key in this.data)
			Utilities.setImmediateTimeout(function (store, key, now) {
				if (now - store.data[key].accessed > store.maxLife) {
					if (store.data[key].value instanceof Store)
						store.data[key].value.destroy();

					delete store.data[key];
				}
			}, [this, key, now]);
	};

	Store.prototype.clear = function () {
		if (this.lock)
			return;

		for (var child in this.children)
			this.children[child].clear();

		this.data = {};

		this.__save();

		return this;
	};

	Store.prototype.destroy = function (deep, unlock) {
		if (this.destroyed)
			return;

		var key;

		var self = this;

		if (this.deepDestruction || deep)
			for (var child in this.children) {
				this.children[child].destroy(true);

				delete this.children[child];
			}

		if (this.parent) {
			this.parent.only(function (key, value) {
				return value !== self;
			});
		}

		this.lock = this.lock || !unlock;
		this.data = undefined;

		delete data[this.id];

		Object.defineProperty(this, 'destroyed', {
			configurable: true,
			value: true
		});
	};

	Store.prototype.prolongDestruction = function () {
		if (this.selfDestruct > 0)
			Utilities.Timer.timeout('ProlongDestruction' + this.id, function (store) {
				Utilities.Timer.timeout('SelfDestruct' + store.id, function (store) {
					store.destroy();
				}, store.selfDestruct, [store]);
			}, 500, [this]);
	};

	Store.prototype.all = function () {
		var key,
				value,
				finalValue;

		var object = {};

		for (var key in this.data) {
			value = this.get(key);

			if (value instanceof Store) {
				if (value.isEmpty())
					continue;
				else {
					finalValue = value.all();

					if (finalValue._isEmpty())
						continue;
				}
			} else
				finalValue = value;

			if (finalValue === undefined)
				continue;

			object[key] = finalValue;
		}

		return object;
	};

	Store.prototype.allJSON = function () {
		return JSON.stringify(this.all(), null, 2);
	};

	Store.prototype.toJSON = function () {
		var value,
				finalValue;

		var stringable = {
			name: this.name,
			save: this.save,
			props: this.props,
			lock: this.lock,
			private: this.private,
			data: {}
		};

		for (var key in this.data) {
			value = this.get(key);

			if (value instanceof Store) {
				if (value.isEmpty())
					continue;
				else {
					finalValue = value.toJSON();

					if (finalValue.data._isEmpty())
						continue;
				}
			} else
				finalValue = value;

			if (typeof finalValue !== 'undefined')
				stringable.data[key] = {
					accessed: this.data[key].accessed,
					value: finalValue
				};
		}

		return stringable;
	};

	Store.prototype.dump = function  () {
		Log(data);

		return data;
	};

	Store.prototype.expireNow = function () {
		var orig = parseInt(this.maxLife, 10);

		this.maxLife = 1;

		this.removeExpired();
	};

	Store.compareCache = new Store('Compare', {
		maxLife: TIME.ONE_MINUTE * 10,
		private: true
	});

	return Store;
})();
