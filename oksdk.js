"use strict";
var OKSDK = (function () {
    var OK_CONNECT_URL = 'https://connect.ok.ru/';
    var OK_MOB_URL = 'https://m.ok.ru/';
    var OK_API_SERVER = 'https://api.ok.ru/';

    var MOBILE = 'mobile';
    var WEB = 'web';
    var NATIVE_APP = 'application';
    var EXTERNAL = 'external';

    var PLATFORM_REGISTER = {
        'w': WEB,
        'm': MOBILE,
        'n': NATIVE_APP,
        'e': EXTERNAL
    };

    var APP_EXTLINK_REGEXP = /\bjs-ok-extlink\b/;

    var state = {
        app_id: 0, app_key: '',
        sessionKey: '', accessToken: '', sessionSecretKey: '', apiServer: '', widgetServer: '', mobServer: '',
        baseUrl: '',
        container: false,
        header_widget: ''
    };
    var sdk_success = stub_func;
    var sdk_failure = stub_func;
    var rest_counter = 0;
    var extLinkListenerOn = false;
    var externalLinkHandler = stub_func;

    // ---------------------------------------------------------------------------------------------------
    // General
    // ---------------------------------------------------------------------------------------------------

    /**
     * initializes the SDK<br/>
     * If launch parameters are not detected, switches to OAUTH (via redirect)
     *
     * @param args
     * @param {Number} args.app_id application id
     * @param {String} args.app_key application key
     * @param [args.oauth] - OAUTH configuration
     * @param {String} [args.oauth.scope='VALUABLE_ACCESS'] scope
     * @param {String} [args.oauth.url=location.href] return url
     * @param {String} [args.oauth.state=''] state for security checking
     * @param {String} [args.oauth.layout='a'] authorization layout (w - web, m - mobile)
     * @param {Function} success success callback
     * @param {Function} failure failure callback
     */
    function init(args, success, failure) {
        args.oauth = args.oauth || {};

        if (isFunc(success)) {
            sdk_success = success;
        }

        if (isFunc(failure)) {
            sdk_failure = failure;
        }

        var params = getRequestParameters(args['location_search'] || window.location.search);
        var hParams = getRequestParameters(args['location_hash'] || window.location.hash);

        state.app_id = args.app_id;
        state.app_key = params["application_key"] || args.app_key;

        if (!state.app_id || !state.app_key) {
            sdk_failure('Required arguments app_id/app_key not passed');
            return;
        }

        state.sessionKey = params["session_key"];
        state.accessToken = hParams['access_token'];
        state.groupId = params['group_id'] || hParams['group_id'] || args['group_id'];
        state.sessionSecretKey = params["session_secret_key"] || hParams['session_secret_key'];
        state.apiServer = args["api_server"] || params["api_server"] || OK_API_SERVER;
        state.widgetServer = args["widget_server"] || params['widget_server'] || OK_CONNECT_URL;
        state.mobServer = args["mob_server"] || params["mob_server"] || OK_MOB_URL;
        state.baseUrl = state.apiServer + "fb.do";
        state.header_widget = params['header_widget'];
        state.container = params['container'];
        state.layout = (params['layout'] || hParams['layout'] || args.layout)
            || params['api_server']
                ? params['mob'] && params['mob'] === 'true'
                    ? 'm'
                    : 'w'
                : 'w';

        if (!params['api_server']) {
            if ((hParams['access_token'] == null) && (hParams['error'] == null)) {
                window.location = state.widgetServer + 'oauth/authorize' +
                    '?client_id=' + args.app_id +
                    '&scope=' + (args.oauth.scope || 'VALUABLE_ACCESS') +
                    '&response_type=' + 'token' +
                    '&redirect_uri=' + (args.oauth.url || window.location.href) +
                    '&layout=' + (args.oauth.layout || 'a') +
                    '&state=' + (args.oauth.state || '');
                return;
            }
            if (hParams['error'] != null) {
                sdk_failure('Error with OAUTH authorization: ' + hParams['error']);
                return;
            }
        }


        sdk_success();
    }

    // ---------------------------------------------------------------------------------------------------
    // REST
    // ---------------------------------------------------------------------------------------------------

    function restLoad(url) {
        var script = document.createElement('script');
        script.src = url;
        script.async = true;
        var done = false;
        script.onload = script.onreadystatechange = function () {
            if (!done && (!this.readyState || this.readyState === "loaded" || this.readyState === "complete")) {
                done = true;
                script.onload = null;
                script.onreadystatechange = null;
                if (script && script.parentNode) {
                    script.parentNode.removeChild(script);
                }
            }
        };
        var headElem = document.getElementsByTagName('head')[0];
        headElem.appendChild(script);
    }

    function restCallPOST(query, callback) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", state.baseUrl, true);
        xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
        xhr.onreadystatechange = function() {
            if (xhr.readyState ===  XMLHttpRequest.DONE) {
                if (xhr.status === 200) {
                    if (isFunc(callback)) {
                        callback("ok", xhr.responseText, null);
                    }
                } else {
                    if (isFunc(callback)) {
                        callback("error", null, xhr.responseText);
                    }
                }
            }
        };
        xhr.send(query);
    }

    /**
     * Calls a REST request
     *
     * @param {String} method
     * @param {Object} [params]
     * @param {restCallback} [callback]
     * @param {Object} [callOpts]
     * @param {boolean} [callOpts.no_session] true if REST method prohibits session
     * @param {boolean} [callOpts.no_sig] true if no signature is required for the method
     * @param {string} [callOpts.app_secret_key] required for non-session requests
     * @param {string} [callOpts.use_post] send request via POST
     * @returns {string}
     */
    function restCall(method, params, callback, callOpts) {
        params = params || {};
        params.method = method;
        params = restFillParams(params);
        if (callOpts && callOpts.no_session) {
            delete params['session_key'];
            delete params['access_token'];
        }
        if (!callOpts || !callOpts.no_sig) {
            var secret = (callOpts && callOpts.app_secret_key) ? callOpts.app_secret_key : state.sessionSecretKey;
            params['sig'] = calcSignature(params, secret);
        }

        var query = "";
        for (var key in params) {
            if (params.hasOwnProperty(key)) {
                if (query.length !== 0) {
                    query += '&';
                }
                query += key + "=" + encodeURIComponent(params[key]);
            }
        }

        if (callOpts && callOpts.use_post) {
            return restCallPOST(query, callback);
        }

        var callbackId = "__oksdk__callback_" + (++rest_counter);
        window[callbackId] = function (status, data, error) {
            if (isFunc(callback)) {
                callback(status, data, error);
            }
            window[callbackId] = null;
            try {
                delete window[callbackId];
            } catch (e) {}
        };
        restLoad(state.baseUrl + '?' + query + "&js_callback=" + callbackId);
        return callbackId;
    }

    /**
     * Calculates request signature basing on the specified call arguments
     *
     * @param {Object} query
     * @param {string} [secretKey] alternative secret_key (fe: app secret key for non-session requests)
     * @returns {string}
     */
    function calcSignatureExternal(query, secretKey) {
        return calcSignature(restFillParams(query), secretKey);
    }

    function calcSignature(query, secretKey) {
        var i, keys = [];
        for (i in query) {
            keys.push(i.toString());
        }
        keys.sort();
        var sign = "";
        for (i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (("sig" != key) && ("access_token" != key)) {
                sign += keys[i] + '=' + query[keys[i]];
            }
        }
        sign += secretKey || state.sessionSecretKey;
        sign = encodeUtf8(sign);
        return md5(sign);
    }

    function restFillParams(params) {
        params = params || {};
        params["application_key"] = state.app_key;
        if (state.sessionKey) {
            params["session_key"] = state.sessionKey;
        } else {
            params["access_token"] = state.accessToken;
        }
        params["format"] = 'JSON';
        return params;
    }

    function wrapCallback(success, failure, dataProcessor) {
        return function(status, data, error) {
            if (status == 'ok') {
                if (isFunc(success)) success(isFunc(dataProcessor) ? dataProcessor(data) : data);
            } else {
                if (isFunc(failure)) failure(error);
            }
        };
    }

    // ---------------------------------------------------------------------------------------------------
    // Payment
    // ---------------------------------------------------------------------------------------------------

    function paymentShow(productName, productPrice, productCode, options) {
        var params = {};
        params['name'] = productName;
        params['price'] = productPrice;
        params['code'] = productCode;

        options = options || {};
        var host = options['mob_pay_url'] || state.mobServer;

        params["application_key"] = state.app_key;
        if (state.sessionKey) {
            params["session_key"] = state.sessionKey;
        } else {
            params["access_token"] = state.accessToken;
        }
        params['sig'] = calcSignature(params, state.sessionSecretKey);

        var query = host + 'api/show_payment?';
        for (var key in params) {
            if (params.hasOwnProperty(key)) {
                query += key + "=" + encodeURIComponent(params[key]) + "&";
            }
        }

        window.open(query);
    }

    // ---------------------------------------------------------------------------------------------------
    // Widgets
    // ---------------------------------------------------------------------------------------------------

    var WIDGET_SIGNED_ARGS = ["st.attachment", "st.return", "st.redirect_uri", "st.state"];

    /**
     * Returns HTML to be used as a back button for mobile app<br/>
     * If back button is required (like js app opened in browser from native mobile app) the required html
     * will be returned in #onSucсess callback
     * @param {onSuccessCallback} onSuccess
     * @param {String} [style]
     */
    function widgetBackButton(onSuccess, style) {
        if (state.container || state.accessToken) return;
        restCall('widget.getWidgetContent',
            {wid: state.header_widget || 'mobile-header-small', style: style || null},
            wrapCallback(onSuccess, null, function(data) {
                return decodeUtf8(atob(data))
            }));
    }

    /**
     * Opens mediatopic post widget
     *
     * @param {String} returnUrl    callback url
     * @param {Object} options      options
     * @param {Object} options.attachment mediatopic (feed) to be posted
     * @param {boolean} forcePopup  use WidgetBuilder or make direct popup call
     */
    function widgetMediatopicPost(returnUrl, options, forcePopup) {
        options = options || {};
        if (!options.attachment) {
            options = {attachment: options}
        }

        if (forcePopup) {
            options.attachment = btoa(unescape(encodeURIComponent(toString(options.attachment))));
            widgetOpen('WidgetMediatopicPost', options, returnUrl);
        } else {
            var mergedOptions = OKSDK.Util.mergeObject(options, {return: returnUrl}, false);
            OKSDK.Widgets.builds.post.configure(mergedOptions).run();
        }
    }

    /**
     * Opens app invite widget (invite friends to app)
     *
     * @see widgetSuggest widgetSuggest() for more details on arguments
     */
    function widgetInvite(returnUrl, options, forcePopup) {
        if (forcePopup) {
            widgetOpen('WidgetInvite', options, returnUrl);
        } else {
            OKSDK.Widgets.builds.invite.configure(
                OKSDK.Util.mergeObject(
                    options,
                    {return: returnUrl}
                )
            ).run();
        }
    }

    /**
     * Opens app suggest widget (suggest app to friends, both already playing and not yet)
     *
     * @param {String} returnUrl callback url
     * @param {Object} [options] options
     * @param {boolean} forcePopup  fallback for old method to open widget
     * @param {int} [options.autosel] amount of friends to be preselected
     * @param {String} [options.comment] default text set in the suggestion text field
     * @param {String} [options.custom_args] custom args to be passed when app opened from suggestion
     * @param {String} [options.state] custom args to be passed to return url
     * @param {String} [options.target] comma-separated friend IDs that should be preselected by default
     */
    function widgetSuggest(returnUrl, options, forcePopup) {
        if (forcePopup) {
            widgetOpen('WidgetSuggest', options, returnUrl);
        } else {
            OKSDK.Widgets.builds.suggest.configure(
                OKSDK.Util.mergeObject(
                    options,
                    {return: returnUrl}
                )
            ).run();
        }
    }

    function widgetGroupAppPermissions(scope, returnUrl, options) {
        options = options || {};
        options.groupId = options.groupId || state.groupId;

        OKSDK.Widgets.builds.askGroupAppPermissions.configure(
            OKSDK.Util.mergeObject(
                options,
                {
                    scope: (getClass(scope) == '[object Array]' ? scope.join(';') : scope),
                    // TODO: dmitrylapynov: unify param name as 'return_uri -> return';
                    redirect_uri: returnUrl,
                    popupConfig: {
                        width: 600,
                        height: 300
                    }
                },
                false
            )
        ).run();
    }

    function widgetOpen(widget, args, returnUrl) {
        args = args || {};
        args.return = args.return || returnUrl;
        var popupConfig = args.popupConfig;
        var popup;

        if (popupConfig) {
            delete args.popupConfig;
            var w = popupConfig.width;
            var h = popupConfig.height;
            var documentElement = document.documentElement;
            if (typeof popupConfig.left == 'undefined') {
                var screenLeft = window.screenLeft;
                var innerWidth = window.innerWidth;
                var screenOffsetLeft = typeof screenLeft == 'undefined' ? screen.left : screenLeft;
                var screenWidth = innerWidth ? innerWidth : documentElement.clientWidth ? documentElement.clientWidth : screen.width;
                var left = (screenWidth / 2 - w / 2) + screenOffsetLeft;
            }
            if (typeof popupConfig.top == 'undefined') {
                var screenTop = window.screenTop;
                var screenOffsetTop = typeof screenTop == 'undefined'? screen.top : screenTop;
                var innerHeight = window.innerHeight;
                var screenHeight = innerHeight ? innerHeight : documentElement.clientHeight ? documentElement.clientHeight : screen.height;
                var top = (screenHeight / 2 - h / 2) + screenOffsetTop;
            }

            var popupName = popupConfig.name + Date.now();
            popup = window.open(
                getLinkOnWidget(widget, args),
                popupName,
                'width=' + w + ',' +
                'height=' + h + ',' +
                'top=' + top + ',' +
                'left=' + left +
                (popupConfig.options ? (',' + popupConfig.options) : '')
            );

        } else {
            popup = window.open(getLinkOnWidget(widget, args));
        }

        //window.console && console.log('popup', popup);

        return popup;
    }

    function getLinkOnWidget(widget, args) {
        var keys = [];
        for (var arg in args) {
            keys.push(arg.toString());
        }
        keys.sort();

        var sigSource = '';
        var query = state.widgetServer +
            'dk?st.cmd=' + widget +
            '&st.app=' + state.app_id;

        for (var i = 0; i < keys.length; i++) {
            var key = "st." + keys[i];
            var val = args[keys[i]];
            if (WIDGET_SIGNED_ARGS.indexOf(key) != -1) {
                sigSource += key + "=" + val;
            }
            query += "&" + key + "=" + encodeURIComponent(val);
        }
        sigSource += state.sessionSecretKey;
        query += '&st.signature=' + md5(sigSource);
        if (state.accessToken != null) {
            query += '&st.access_token=' + state.accessToken;
        }
        if (state.sessionKey) {
            query += '&st.session_key=' + state.sessionKey;
        }
        return query;
    }

    // ---------------------------------------------------------------------------------------------------
    // SDK constructor
    // ---------------------------------------------------------------------------------------------------


    /**
     * @param {String} widgetName
     * @constructor
     */
    function WidgetConfigurator(widgetName) {
        this.name = widgetName;
        this.configAdapter = stub_func;
        this.adapters = {};
    }

    WidgetConfigurator.prototype = {
        /* one of FAPI.UI methods, more: https://apiok.ru/search?q=FAPI.UI */
        withUiLayerName: function(name) {
            this.uiLayerName = name;
            return this;
        },
        withValidators: function (validators) {
            this.validators = validators;
            return this;
        },
        withConfigAdapter: function (adapterFn) {
            this.configAdapter = adapterFn;
            return this;
        },
        withAdapters: function (adapters) {
            this.adapters = adapters;
            return this;
        },

        /**
         * @callback adapterCallback
         * @param {Object} data
         * @param {Object} options
         * @returns {Array}
         */
        /**
         * @param {adapterCallback} fn
         * @returns {WidgetConfigurator}
         */
        withUiAdapter: function(fn) {
            this.adapters.openUiLayer = fn;
            return this;
        },
        /**
         * @param {adapterCallback} fn
         * @returns {WidgetConfigurator}
         */
        withPopupAdapter: function(fn) {
            this.adapters.openPopup = fn;
            return this;
        },
        /**
         * @param {adapterCallback} fn
         * @returns {WidgetConfigurator}
         */
        withIframeAdapter: function(fn) {
            this.adapters.openIframeLayer = fn;
            return this;
        }
    };

    /**
     *
     * @param {WidgetConfigurator | String} widget
     * @param {Object} [options]
     * @constructor
     */
    function WidgetLayerBuilder(widget, options) {
        if (widget instanceof WidgetConfigurator === false) {
            widget = new WidgetConfigurator(widget);
        }

        this.widgetConf = widget;
        this.options = options || {};
        this.configAdapter = this.widgetConf.configAdapter;
        this.adapters = this._createMethodSuppliers(this.widgetConf.adapters);
        this.validators = this._createMethodSuppliers(this.widgetConf.validators);
        this._callContext = resolveContext();
    }

    WidgetLayerBuilder.prototype = {
        /**
         * @private
         */
        _callContext: {},
        /**
         * @private
         * @description resolve when method is allowed to use relate to application envinronment context
         */
        _validatorRegister: {
            openUiLayer: function () {
                var context = this._callContext;
                return this.widgetConf.uiLayerName && !(context.isExternal || context.isMob);
            },
            openIframeLayer: function () {
                return false;
            },
            openPopup: function () {
                return true;
            }
        },

        /**
         * @private
         *
         * @param {Object} methodMap    see: WidgetLayerBuilder.widgetInterface
         * @param {Function} methodMap.openPopup
         * @param {Function} methodMap.openUiLayer
         * @param {Function} methodMap.openIframeLayer
         */
        _createMethodSuppliers: function (methodMap) {
            var result = {};
            if (methodMap) {
                var widgetInterface = this.widgetInterface;
                for (var i = 0, l = widgetInterface.length; i < l; i++) {
                    var m = widgetInterface[i];
                    if (methodMap.hasOwnProperty(m)) {
                        result[m] = methodMap[m];
                    }
                }
            }

            return result;
        },
        widgetInterface:
            [
                'openPopup',
                'openUiLayer',
                'openIframeLayer'
            ],
        openPopup: function () {
            return widgetOpen(this.widgetConf.name, this.options);
        },
        openUiLayer: function () {
            return invokeUIMethod.apply(null, this.options);
        },
        openIframeLayer: function () {
            return window.console && console.log('Iframe-layer is in development');
        },
        run: function () {
            var options = this.options;
            options.client_id = options.client_id || state.app_id;
            // TODO: make state update to be optional;
            this._callContext = resolveContext();
            this.configAdapter(state);

            var validatorRegister = this._validatorRegister;
            for (var method in validatorRegister) {
                var result = validatorRegister[method].call(this);
                if (this.validators[method]) {
                    result = this.validators[method].call(this);
                }

                // убеждаемся, что такой метод есть в прототипе конструтора
                if (result && (!this.hasOwnProperty(method) && method in this)) {
                    var adapter = this.adapters[method];
                    if (adapter) {
                        this.options = adapter(this.widgetConf, options);
                    }
                    return this[method]();
                }
            }
        },
        changeParams: function (options) {
            if (this.options) {
                mergeObject(this.options, options, true);
                return this;
            } else {
                return this.configure(options);
            }
        },
        addParams: function (options) {
            if (this.options) {
                mergeObject(this.options, options, false);
                return this;
            } else {
                return this.configure(options);
            }
        },
        configure: function (options) {
            this.options = options;
            return this;
        }
    };

    /* todo: виджеты в леере
    function createIframe(uri, customCssClass) {
        var iframe = document.createElement('iframe');
        var iframeClassName = typeof customCssClass === 'undefined' ? "" : customCssClass;
        iframe.src = uri;
        iframe.className = ("ok-sdk-frame " + iframeClassName);

        document.body.appendChild(iframe);

        //iframe.contentWindow.postMessage({'test-message': 7}, "*")
    }
    */

    function invokeUIMethod() {
        var argStr = "";
        for (var i = 0, l = arguments.length; i < l; i++) {
            var arg = arguments[i];

            if (i > 0) {
                argStr += '$';
            }
            if (arg != null) {
                argStr += encodeURIComponent(String(arg));
            }
        }
        window.parent.postMessage("__FAPI__" + argStr, "*");
    }

    /**
     * @class WidgetLayerBuilder
     *
     * @returns {Boolean} context.platform
     * @returns {Boolean} context.isOKApp
     * @returns {Boolean} context.isOauth
     * @returns {Boolean} context.isIframe
     * @returns {Boolean} context.isPopup
     * @returns {Boolean} context.isExternal
     * @returns {Object} context
     */
    function resolveContext() {
        var stateMode = state.layout && state.layout.toLowerCase();
        var context = {
            layout: PLATFORM_REGISTER[stateMode],
            isOKApp: state.container,
            isOAuth: stateMode === 'o',
            isIframe: window.parent !== window,
            isPopup: window.opener !== window
        };
        context.isExternal = context.layout == EXTERNAL || !(context.isIframe || context.isPopup || context.isOAuth);
        context.isMob = context.layout === MOBILE || context.layout === NATIVE_APP;
        return context;
    }


    // ---------------------------------------------------------------------------------------------------
    // Utils
    // ---------------------------------------------------------------------------------------------------

    /**
     * calculates md5 of a string
     * @param {String} str
     * @returns {String}
     */
    function md5(str) {
        var hex_chr = "0123456789abcdef";

        function rhex(num) {
            var str = "";
            for (var j = 0; j <= 3; j++) {
                str += hex_chr.charAt((num >> (j * 8 + 4)) & 0x0F) +
                    hex_chr.charAt((num >> (j * 8)) & 0x0F);
            }
            return str;
        }

        /*
         * Convert a string to a sequence of 16-word blocks, stored as an array.
         * Append padding bits and the length, as described in the MD5 standard.
         */
        function str2blks_MD5(str) {
            var nblk = ((str.length + 8) >> 6) + 1;
            var blks = new Array(nblk * 16);
            var i = 0;
            for (i = 0; i < nblk * 16; i++) {
                blks[i] = 0;
            }
            for (i = 0; i < str.length; i++) {
                blks[i >> 2] |= str.charCodeAt(i) << ((i % 4) * 8);
            }
            blks[i >> 2] |= 0x80 << ((i % 4) * 8);
            blks[nblk * 16 - 2] = str.length * 8;
            return blks;
        }

        /*
         * Add integers, wrapping at 2^32. This uses 16-bit operations internally
         * to work around bugs in some JS interpreters.
         */
        function add(x, y) {
            var lsw = (x & 0xFFFF) + (y & 0xFFFF);
            var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
            return (msw << 16) | (lsw & 0xFFFF);
        }

        /*
         * Bitwise rotate a 32-bit number to the left
         */
        function rol(num, cnt) {
            return (num << cnt) | (num >>> (32 - cnt));
        }

        /*
         * These functions implement the basic operation for each round of the
         * algorithm.
         */
        function cmn(q, a, b, x, s, t) {
            return add(rol(add(add(a, q), add(x, t)), s), b);
        }

        function ff(a, b, c, d, x, s, t) {
            return cmn((b & c) | ((~b) & d), a, b, x, s, t);
        }

        function gg(a, b, c, d, x, s, t) {
            return cmn((b & d) | (c & (~d)), a, b, x, s, t);
        }

        function hh(a, b, c, d, x, s, t) {
            return cmn(b ^ c ^ d, a, b, x, s, t);
        }

        function ii(a, b, c, d, x, s, t) {
            return cmn(c ^ (b | (~d)), a, b, x, s, t);
        }

        var x = str2blks_MD5(str);
        var a = 1732584193;
        var b = -271733879;
        var c = -1732584194;
        var d = 271733878;

        for (var i = 0; i < x.length; i += 16) {
            var olda = a;
            var oldb = b;
            var oldc = c;
            var oldd = d;

            a = ff(a, b, c, d, x[i + 0], 7, -680876936);
            d = ff(d, a, b, c, x[i + 1], 12, -389564586);
            c = ff(c, d, a, b, x[i + 2], 17, 606105819);
            b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
            a = ff(a, b, c, d, x[i + 4], 7, -176418897);
            d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
            c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
            b = ff(b, c, d, a, x[i + 7], 22, -45705983);
            a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
            d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
            c = ff(c, d, a, b, x[i + 10], 17, -42063);
            b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
            a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
            d = ff(d, a, b, c, x[i + 13], 12, -40341101);
            c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
            b = ff(b, c, d, a, x[i + 15], 22, 1236535329);

            a = gg(a, b, c, d, x[i + 1], 5, -165796510);
            d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
            c = gg(c, d, a, b, x[i + 11], 14, 643717713);
            b = gg(b, c, d, a, x[i + 0], 20, -373897302);
            a = gg(a, b, c, d, x[i + 5], 5, -701558691);
            d = gg(d, a, b, c, x[i + 10], 9, 38016083);
            c = gg(c, d, a, b, x[i + 15], 14, -660478335);
            b = gg(b, c, d, a, x[i + 4], 20, -405537848);
            a = gg(a, b, c, d, x[i + 9], 5, 568446438);
            d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
            c = gg(c, d, a, b, x[i + 3], 14, -187363961);
            b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
            a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
            d = gg(d, a, b, c, x[i + 2], 9, -51403784);
            c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
            b = gg(b, c, d, a, x[i + 12], 20, -1926607734);

            a = hh(a, b, c, d, x[i + 5], 4, -378558);
            d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
            c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
            b = hh(b, c, d, a, x[i + 14], 23, -35309556);
            a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
            d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
            c = hh(c, d, a, b, x[i + 7], 16, -155497632);
            b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
            a = hh(a, b, c, d, x[i + 13], 4, 681279174);
            d = hh(d, a, b, c, x[i + 0], 11, -358537222);
            c = hh(c, d, a, b, x[i + 3], 16, -722521979);
            b = hh(b, c, d, a, x[i + 6], 23, 76029189);
            a = hh(a, b, c, d, x[i + 9], 4, -640364487);
            d = hh(d, a, b, c, x[i + 12], 11, -421815835);
            c = hh(c, d, a, b, x[i + 15], 16, 530742520);
            b = hh(b, c, d, a, x[i + 2], 23, -995338651);

            a = ii(a, b, c, d, x[i + 0], 6, -198630844);
            d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
            c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
            b = ii(b, c, d, a, x[i + 5], 21, -57434055);
            a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
            d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
            c = ii(c, d, a, b, x[i + 10], 15, -1051523);
            b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
            a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
            d = ii(d, a, b, c, x[i + 15], 10, -30611744);
            c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
            b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
            a = ii(a, b, c, d, x[i + 4], 6, -145523070);
            d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
            c = ii(c, d, a, b, x[i + 2], 15, 718787259);
            b = ii(b, c, d, a, x[i + 9], 21, -343485551);

            a = add(a, olda);
            b = add(b, oldb);
            c = add(c, oldc);
            d = add(d, oldd);
        }
        return rhex(a) + rhex(b) + rhex(c) + rhex(d);
    }

    /**
     *
     * @param receiver {Object}    obj where copy to
     * @param donor {Object}    obj where copied from
     * @param [rewrite=true] {boolean}
     * @returns {*}
     */
    function mergeObject(receiver, donor, rewrite) {
        if (getClass(donor) == getClass._object && getClass(receiver) == getClass._object) {
            for (var k in donor) {
                if (donor.hasOwnProperty(k)) {
                    if (receiver.hasOwnProperty(k) && typeof rewrite !== 'undefined' && !rewrite) {
                        continue;
                    }
                    var property = donor[k];
                    if (getClass(property) == getClass._object) {
                        mergeObject(receiver[k] = receiver[k] || {}, property, rewrite);
                    } else {
                        receiver[k] = property;
                    }
                }
            }

            return receiver;
        }

        return new Error('Merged elements should be an objects');
    }

    function processExternalLink(e) {
        var target = e.target;
        var href;
        var tries = 5;

        if (target) {
            while (target.className && !isMarkedAsExternalLink(target) && tries) {
                target = target.parentNode;
                tries--;
            }

            href = target.href;
            if (href) {
                target.href = createAppExternalLink(href);
            }
        }
    }

    function isMarkedAsExternalLink(target) {
        return target.className.match(APP_EXTLINK_REGEXP);
    }

    function createAppExternalLink(href) {
        if (resolveContext().isOKApp) {
            return '/apphook/outlink/' + href;
        }

        return href;
    }

    function getClass(o) {
        return Object.prototype.toString.call(o);
    }

    getClass._object = getClass({}); // [object Object]
    getClass._function = getClass(stub_func); // [object Function]
    getClass._array = getClass([]); // [object Array]
    getClass._string = getClass(''); // [object String]

    function isFunc(obj) {
        return getClass(obj) === getClass._function;
    }

    function isString(obj) {
        return Object.prototype.toString.call(obj) === getClass._string;
    }

    function toString(obj) {
        return isString(obj) ? obj : JSON.stringify(obj);
    }

    /**
     * Parses parameters to a JS map<br/>
     * Supports both window.location.search and window.location.hash)
     * @param {String} [source=window.location.search] string to parse
     * @returns {Object}
     */
    function getRequestParameters(source) {
        var res = {};
        var url = source || window.location.search;
        if (url) {
            url = url.substr(1);    // Drop the leading '?' / '#'
            var nameValues = url.split("&");

            for (var i = 0; i < nameValues.length; i++) {
                var nameValue = nameValues[i].split("=");
                var name = nameValue[0];
                var value = nameValue[1];
                value = value && decodeURIComponent(value.replace(/\+/g, " "));
                res[name] = value;
            }
        }
        return res;
    }

    function encodeUtf8(string) {
        return unescape(encodeURIComponent(string));
    }

    function decodeUtf8(utftext) {
        return decodeURIComponent(escape(utftext));
    }

    /** stub func */
    function stub_func() {
    }

    // ---------------------------------------------------------------------------------------------------



    // ---------------------------------------------------------------------------------------------------
    // Widget configurations
    // ---------------------------------------------------------------------------------------------------

    var widgetConfigs = {
        groupPermission: new WidgetConfigurator('WidgetGroupAppPermissions')
            .withUiLayerName('showGroupPermissions')
            .withUiAdapter(function (data, options) {
                return [
                    data.uiLayerName,
                    options.scope,
                    options.groupId
                ];
            })
            .withConfigAdapter(function (state) {
                var groupId = this.options.groupId;
                if (!groupId) {
                    this.options.groupId = state.groupId;
                }
            }),
        post: new WidgetConfigurator('WidgetMediatopicPost')
            .withUiLayerName('postMediatopic')
            .withUiAdapter(function (data, options) {
                return [
                    data.uiLayerName,
                    JSON.stringify(options.attachment),
                    options.status ? 'on' : 'off',
                    options.platforms ? options.platforms.join(',') : '',
                    options.groupId
                ];
            })
            .withPopupAdapter(function (data, options) {
                options.attachment = btoa(unescape(encodeURIComponent(toString(options.attachment))));
                return options;
            }),
        invite: new WidgetConfigurator('WidgetInvite')
            .withUiLayerName('showInvite')
            .withUiAdapter(function (data, options) {
                return [data.uiLayerName, options.text, options.params, options.uids];
            })
    };

    // ---------------------------------------------------------------------------------------------------

    return {
        init: init,
        REST: {
            call: restCall,
            calcSignature: calcSignatureExternal
        },
        Payment: {
            show: paymentShow
        },
        Widgets: {
            Builder: WidgetLayerBuilder,
            WidgetConfigurator: WidgetConfigurator,
            configs: {
                groupPermission: widgetConfigs.groupPermission,
                post: widgetConfigs.post,
                invite: widgetConfigs.invite
            },
            builds: {
                post: new WidgetLayerBuilder(widgetConfigs.post),
                invite: new WidgetLayerBuilder(widgetConfigs.invite),
                suggest: new WidgetLayerBuilder('WidgetSuggest'),
                askGroupAppPermissions: new WidgetLayerBuilder(widgetConfigs.groupPermission)
            },
            getBackButtonHtml: widgetBackButton,
            post: widgetMediatopicPost,
            invite: widgetInvite,
            suggest: widgetSuggest,
            askGroupAppPermissions: widgetGroupAppPermissions
        },
        Util: {
            md5: md5,
            encodeUtf8: encodeUtf8,
            decodeUtf8: decodeUtf8,
            encodeBase64: btoa,
            decodeBase64: atob,
            getRequestParameters: getRequestParameters,
            toString: toString,
            resolveContext: resolveContext,
            mergeObject: mergeObject,
            openAppExternalLink: function (href, useSameFrame) {
                if (useSameFrame === true) {
                    return location.assign(href);
                }
                return window.open(createAppExternalLink(href));
            },
            addExternalLinksListener: function (appHookClass, eventDecorator) {
                if (!extLinkListenerOn) {
                    if (typeof appHookClass !== 'undefined' && appHookClass.indexOf('.') === -1) {
                        APP_EXTLINK_REGEXP = new RegExp('\\b'+appHookClass+'\\b');
                    }

                    externalLinkHandler =  function (e) {
                        var _event = eventDecorator ? eventDecorator(e) : e;
                        processExternalLink(_event);
                    };

                    document.body.addEventListener('click', externalLinkHandler, false);
                    extLinkListenerOn = true;
                }
            },
            removeExternalLinksListener: function () {
                document.body.removeEventListener('click', externalLinkHandler, false);
                extLinkListenerOn = false;
            }
        }
    };
})();
