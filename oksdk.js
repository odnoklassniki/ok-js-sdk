OKSDK = (function () {
    const SDK_VERSION = false;
    const OK_CONNECT_URL = 'https://connect.ok.ru/';
    const OK_MOB_URL = 'https://m.ok.ru/';
    const OK_API_SERVER = 'https://api.ok.ru/';

    var state = {
        app_id: 0, app_key: '',
        sessionKey: '', accessToken: '', sessionSecretKey: '', apiServer: '', widgetServer: '',
        baseUrl: '',
        container: false, header_widget: '',
        sdkToken: '', sdkTokenSecret: ''
    };
    var sdk_success = nop;
    var sdk_failure = nop;
    var rest_counter = 0;

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
        sdk_success = isFunc(success) ? success : nop;
        sdk_failure = isFunc(failure) ? failure : nop;

        var params = getRequestParameters(args['location_search'] || window.location.search);
        var hParams = getRequestParameters(args['location_hash'] || window.location.hash);

        state.app_id = args.app_id;
        state.app_key = params["application_key"] || args.app_key;
        state.sessionKey = params["session_key"];
        state.accessToken = hParams['access_token'];
        state.sessionSecretKey = params["session_secret_key"] || hParams['session_secret_key'];
        state.apiServer = args["api_server"] || params["api_server"] || OK_API_SERVER;
        state.widgetServer = args["widget_server"] || params['widget_server'] || OK_CONNECT_URL;
        state.baseUrl = state.apiServer + "fb.do";
        state.header_widget = params['header_widget'];
        state.container = params['container'];

        if (!state.app_id || !state.app_key) {
            sdk_failure('Required arguments app_id/app_key not passed');
            return;
        }

        if (!params['api_server']) {
            if ((hParams['access_token'] == null) && (hParams['error'] == null)) {
                window.location = state.widgetServer + 'oauth/authorize' +
                    '?client_id=' + args['app_id'] +
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
        if (SDK_VERSION) {
            restCall('sdk.init', {
                    session_data: JSON.stringify({
                        version: 2,
                        client_type: 'SDK_JS',
                        client_version: SDK_VERSION,
                        device_id: navigator.userAgent
                    })
                }, function (status, data, error) {
                    if (status == 'ok') {
                        state.sdkToken = data['session_key'];
                        state.sdkTokenSecret = data['session_secret_key'];
                        sdk_success();
                    } else {
                        sdk_failure("Initialization error: " + toString(error));
                    }
                },
                {no_session: true}
            );
        } else {
            sdk_success();
        }
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
     * @returns {string}
     */
    function restCall(method, params, callback, callOpts) {
        var query = "?";
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

        for (var key in params) {
            if (params.hasOwnProperty(key)) {
                query += key + "=" + encodeURIComponent(params[key]) + "&";
            }
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
        restLoad(state.baseUrl + query + "js_callback=" + callbackId);
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

    function paymentShow(productName, productPrice, productCode) {
        var params = {};
        params['name'] = productName;
        params['price'] = productPrice;
        params['code'] = productCode;

        params["application_key"] = state.app_key;
        if (state.sessionKey) {
            params["session_key"] = state.sessionKey;
        } else {
            params["access_token"] = state.accessToken;
        }
        params['sig'] = calcSignature(params, state.sessionSecretKey);

        var query = OK_MOB_URL + 'api/show_payment?';
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

    function widgetMediatopicPost(returnUrl, feed) {
        widgetOpen('WidgetMediatopicPost', {feed: feed}, returnUrl);
    }

    /**
     * Opens app invite widget (invite friends to app)
     *
     * @see widgetSuggest widgetSuggest() for more details on arguments
     */
    function widgetInvite(returnUrl, options) {
        widgetOpen('WidgetInvite', options, returnUrl);
    }

    /**
     * Opens app suggest widget (suggest app to friends, both already playing and not yet)
     *
     * @param {String} returnUrl callback url
     * @param {Object} [options] options
     * @param {int} [options.autosel] amount of friends to be preselected
     * @param {String} [options.comment] default text set in the suggestion text field
     * @param {String} [options.custom_args] custom args to be passed when app opened from suggestion
     * @param {String} [options.state] custom args to be passed to return url
     * @param {String} [options.target] comma-separated friend IDs that should be preselected by default
     */
    function widgetSuggest(returnUrl, options) {
        widgetOpen('WidgetSuggest', options, returnUrl);
    }

    function widgetOpen(widget, args, returnUrl) {
        args = args || {};

        var sigSource = '';
        var query = state.widgetServer + 'dk?st.cmd=' + widget + '&st.app=' + state.app_id;
        if (args.feed != null) {
            sigSource += 'st.attachment=' + args.feed;
            query += '&st.attachment=' + encodeURIComponent(args.feed);
        }
        if (args.autosel != null) {
            sigSource += 'st.autosel=' + args.autosel;
            query += '&st.autosel=' + args.autosel;
        }
        if (args.comment != null) {
            sigSource += 'st.comment=' + args.comment;
            query += '&st.comment=' + args.comment;
        }
        if (args.custom_args != null) {
            sigSource += 'st.custom_args=' + args.custom_args;
            query += '&st.custom_args=' + args.custom_args;
        }
        sigSource += 'st.return=' + returnUrl;
        query += '&st.return=' + encodeURIComponent(returnUrl);
        if (args.state != null) {
            sigSource += 'st.state=' + args.state;
            query += '&st.state=' + args.state;
        }
        if (args.target != null) {
            sigSource += 'st.target=' + args.target;
            query += '&st.target=' + args.target;
        }

        sigSource += state.sessionSecretKey;
        query += '&st.signature=' + md5(sigSource);
        if (state.accessToken != null) {
            query += '&st.access_token=' + state.accessToken;
        }
        if (state.sessionKey) {
            query += '&st.session_key=' + state.sessionKey;
        }
        window.open(query);
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

        function RotateLeft(lValue, iShiftBits) {
            return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
        }

        function AddUnsigned(lX, lY) {
            var lX4, lY4, lX8, lY8, lResult;
            lX8 = (lX & 0x80000000);
            lY8 = (lY & 0x80000000);
            lX4 = (lX & 0x40000000);
            lY4 = (lY & 0x40000000);
            lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
            if (lX4 & lY4) {
                return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
            }
            if (lX4 | lY4) {
                if (lResult & 0x40000000) {
                    return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
                } else {
                    return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
                }
            } else {
                return (lResult ^ lX8 ^ lY8);
            }
        }

        function F(x, y, z) {
            return (x & y) | ((~x) & z);
        }

        function G(x, y, z) {
            return (x & z) | (y & (~z));
        }

        function H(x, y, z) {
            return (x ^ y ^ z);
        }

        function I(x, y, z) {
            return (y ^ (x | (~z)));
        }

        function FF(a, b, c, d, x, s, ac) {
            a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac));
            return AddUnsigned(RotateLeft(a, s), b);
        }

        function GG(a, b, c, d, x, s, ac) {
            a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac));
            return AddUnsigned(RotateLeft(a, s), b);
        }

        function HH(a, b, c, d, x, s, ac) {
            a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac));
            return AddUnsigned(RotateLeft(a, s), b);
        }

        function II(a, b, c, d, x, s, ac) {
            a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac));
            return AddUnsigned(RotateLeft(a, s), b);
        }

        function ConvertToWordArray(string) {
            var lWordCount;
            var lMessageLength = string.length;
            var lNumberOfWords_temp1 = lMessageLength + 8;
            var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
            var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
            var lWordArray = Array(lNumberOfWords - 1);
            var lBytePosition = 0;
            var lByteCount = 0;
            while (lByteCount < lMessageLength) {
                lWordCount = (lByteCount - (lByteCount % 4)) / 4;
                lBytePosition = (lByteCount % 4) * 8;
                lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
                lByteCount++;
            }
            lWordCount = (lByteCount - (lByteCount % 4)) / 4;
            lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
            lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
            lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
            return lWordArray;
        }

        function WordToHex(lValue) {
            var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount;
            for (lCount = 0; lCount <= 3; lCount++) {
                lByte = (lValue >>> (lCount * 8)) & 255;
                WordToHexValue_temp = "0" + lByte.toString(16);
                WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
            }
            return WordToHexValue;
        }

        function Utf8Encode(string) {
            string = string.replace(/\r\n/g, "\n");
            var utftext = "";

            for (var n = 0; n < string.length; n++) {

                var c = string.charCodeAt(n);

                if (c < 128) {
                    utftext += String.fromCharCode(c);
                }
                else if ((c > 127) && (c < 2048)) {
                    utftext += String.fromCharCode((c >> 6) | 192);
                    utftext += String.fromCharCode((c & 63) | 128);
                }
                else {
                    utftext += String.fromCharCode((c >> 12) | 224);
                    utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                    utftext += String.fromCharCode((c & 63) | 128);
                }

            }

            return utftext;
        }

        var k, AA, BB, CC, DD, a, b, c, d;
        var S11 = 7, S12 = 12, S13 = 17, S14 = 22;
        var S21 = 5, S22 = 9, S23 = 14, S24 = 20;
        var S31 = 4, S32 = 11, S33 = 16, S34 = 23;
        var S41 = 6, S42 = 10, S43 = 15, S44 = 21;

        str = Utf8Encode(str);
        var x = ConvertToWordArray(str);

        a = 0x67452301;
        b = 0xEFCDAB89;
        c = 0x98BADCFE;
        d = 0x10325476;

        for (k = 0; k < x.length; k += 16) {
            AA = a;
            BB = b;
            CC = c;
            DD = d;
            a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478);
            d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
            c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
            b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
            a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
            d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
            c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
            b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
            a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
            d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
            c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
            b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
            a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
            d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
            c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
            b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);
            a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
            d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
            c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
            b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
            a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
            d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
            c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
            b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
            a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
            d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
            c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
            b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
            a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
            d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
            c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
            b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
            a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
            d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
            c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
            b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
            a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
            d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
            c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
            b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
            a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
            d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
            c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
            b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
            a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
            d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
            c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
            b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
            a = II(a, b, c, d, x[k + 0], S41, 0xF4292244);
            d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
            c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
            b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
            a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
            d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
            c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
            b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
            a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
            d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
            c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
            b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
            a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
            d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
            c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
            b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);
            a = AddUnsigned(a, AA);
            b = AddUnsigned(b, BB);
            c = AddUnsigned(c, CC);
            d = AddUnsigned(d, DD);
        }

        var temp = WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d);
        return temp.toLowerCase();
    }

    function isFunc(obj) {
        return Object.prototype.toString.call(obj) === "[object Function]";
    }

    function isString(obj) {
        return Object.prototype.toString.call(obj) === "[object String]";
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
                value = decodeURIComponent(value.replace(/\+/g, " "));
                res[name] = value;
            }
        }
        return res;
    }

    function encodeUtf8(string) {
        var res = "";
        for (var n = 0; n < string.length; n++) {
            var c = string.charCodeAt(n);
            if (c < 128) {
                res += String.fromCharCode(c);
            }
            else if ((c > 127) && (c < 2048)) {
                res += String.fromCharCode((c >> 6) | 192);
                res += String.fromCharCode((c & 63) | 128);
            }
            else {
                res += String.fromCharCode((c >> 12) | 224);
                res += String.fromCharCode(((c >> 6) & 63) | 128);
                res += String.fromCharCode((c & 63) | 128);
            }
        }
        return res;
    }

    function decodeUtf8(utftext) {
        var string = "";
        var i = 0;
        var c = 0, c2 = 0, c3 = 0;
        while (i < utftext.length) {
            c = utftext.charCodeAt(i);
            if (c < 128) {
                string += String.fromCharCode(c);
                i++;
            }
            else if ((c > 191) && (c < 224)) {
                c2 = utftext.charCodeAt(i + 1);
                string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
                i += 2;
            } else {
                c2 = utftext.charCodeAt(i + 1);
                c3 = utftext.charCodeAt(i + 2);
                string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
                i += 3;
            }
        }
        return string;
    }

    /** stub func */
    function nop() {}

    /**
     * @callback onSuccessCallback
     * @param {String} result
     */

    /**
     * @callback restCallback
     * @param {String} code (either 'ok' or 'error')
     * @param {Object} data success data
     * @param {Object} error error data
     */

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
            getBackButtonHtml: widgetBackButton,
            post: widgetMediatopicPost,
            invite: widgetInvite,
            suggest: widgetSuggest
        },
        Util: {
            md5: md5,
            encodeUtf8: encodeUtf8,
            decodeUtf8: decodeUtf8,
            encodeBase64: btoa,
            decodeBase64: atob,
            getRequestParameters: getRequestParameters,
            toString: toString
        }
    };
})();
