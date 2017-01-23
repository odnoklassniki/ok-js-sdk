OKMobVideoAdv = function () {
    "use strict";
    function getAdman(success, fail) {
        if (window['AdmanHTML']) {
            success(new AdmanHTML());
            return;
        }
        var script = document.createElement('script');
        script.src = "//ad.mail.ru/static/admanhtml/2.1.19/rbadman-html5.min.js";
        script.async = true;
        script.onload = function () {
            console.log(arguments);
            success(new AdmanHTML());
        };
        script.onerror = function () {
            fail("AdmanHTML load failed");
        };
        var headElem = document.getElementsByTagName('head')[0];
        headElem.appendChild(script);
    }

    function showHide(ar, nAr, value) {
        if (ar) {
            for (var i = 0; i < ar.length; i++) {
                var el = ar[i];
                if (el.classList.contains('widget-invisible') === value) {
                    el.classList.toggle('widget-invisible', !value)
                }
            }
        }
        if (nAr) {
            showHide(nAr, null, !value);
        }
    }

    function initAdman(params) {
        getAdman(function (adm) {
            var adSettings = null;
            var requestParams = {
                content_id: params.contentId,
                ok_id: params.userId,
                skip_ad: params.contentId.charAt(1) === 'm' ? 0 : 1,
                flash: 0
            };
            if (params.preview) {
                requestParams.preview = params.preview;
            }
            function onReady() {
                var banners = adm.getBannersForSection('preroll');
                if (banners && banners.length) {
                    params.callback(adm, 'ok', 'ready');
                } else {
                    params.callback(adm, 'error', 'empty');
                }
            }

            function onStarted(sectionType, settings) {
                adSettings = settings;
                showHide([params.loading], [], false);
                showHide([params.skipButton], [], [params.countdownText], !adSettings.allowCloseDelay);
                showHide([params.skipBlock], [], !!adSettings.allowClose);

            }

            function onError() {
                console.warn('Ad error', arguments);
                params.callback(adm, 'error', 'error');
            }

            function onClicked() {
                if ('yes' === adSettings['closeAct']) {
                    adm.stop();
                    params.callback(adm, 'ok', 'click');
                }
            }

            function onCompleted() {
                params.callback(adm, 'ok', 'complete');
            }

            function onSkipped() {
                params.callback(adm, 'ok', 'skip');
            }

            function onTimeRemained(time) {
                if (adSettings.allowClose) {
                    showHide([params.countdownText], [params.skipButton], !adSettings.allowCloseDelay || time.currentTime < adSettings.allowCloseDelay);
                    params.countdownText.textContent = params.countdownText.innerText.replace(/[0-9]+/, Math.max(adSettings.allowCloseDelay - time.currentTime, 0));
                }
            }

            adm.onReady(onReady);
            adm.onStarted(onStarted);
            adm.onError(onError);
            adm.onClicked(onClicked);
            adm.onCompleted(onCompleted);
            adm.onSkipped(onSkipped);
            adm.onTimeRemained(onTimeRemained);

            adm.init({
                slot: '35653',
                wrapper: params.wrapper,
                videoEl: params.video,
                params: requestParams,
                browser: {}
            });
        }, function (err) {
            console.warn('Ad error', err);
            params.callback(null, 'error', 'error');
        });
    }


    var ui = {
        state: {
            adm: null,
            contentId: null,
            userId: null,
            callback: null,
            overlay: null,
            loading: null,
            wrapper: null,
            container: null,
            skipBlock: null,
            countdownText: null,
            skipButton: null,
            muteBlock: null,
            muteButton: null,
            unmuteButton: null,
        },
        prepare: function (contentId, userId, preview, callback) {
            var overlay = document.querySelector('.widget-overlay');
            if (!overlay.classList.contains('widget-invisible')) {
                callback('error', 'in_use');
                return;
            }
            var state = this.state;
            state.contentId = contentId;
            state.userId = userId;
            state.preview = preview;
            state.overlay = overlay;
            state.loading = document.querySelector('.widget-spinner');
            state.wrapper = document.querySelector('.widget_video-wrapper');
            state.container = document.querySelector('.widget_video-container');
            state.skipBlock = state.wrapper.querySelector('.widget_skip');
            state.countdownText = state.wrapper.querySelector('.widget_skip-text');
            state.skipButton = state.wrapper.querySelector('.widget_skip-link');
            state.muteBlock = state.wrapper.querySelector('.widget_mute-link');
            state.muteButton = state.wrapper.querySelector('.js-mute');
            state.unmuteButton = state.wrapper.querySelector('.js-unmute');
            state.skipButton.onclick = function (event) {
                state.adm.skip();
                event.preventDefault();
            };

            state.muteButton.onclick = function (event) {
                state.adm.setVolume(0);
                showHide([state.muteButton], [state.unmuteButton], false);
                event.preventDefault();
            };
            state.unmuteButton.onclick = function (event) {
                state.adm.setVolume(1);
                showHide([state.unmuteButton], [state.muteButton], false);
                event.preventDefault();
            };
            var video = state.container.querySelector("video");
            if(video) {
                state.container.removeChild(video);
            }
            state.video = document.createElement("video");
            state.video.setAttribute('playsinline', 'true');
            state.video.classList.add("widget_video");
            state.container.insertBefore(state.video, state.container.firstChild);

            state.callback = function (adm, status, code) {
                if (status === 'ok' && code === 'ready') {
                    state.adm = adm;
                    state.contentId = contentId;
                } else {
                    if (state.video) {
                        state.container.removeChild(state.video);
                        state.video = null;
                    }
                }
                callback(status, code);
            };
            initAdman(state);
        },
        show: function (contentId, userId, callback) {
            if (!document.querySelector('.widget-overlay').classList.contains('widget-invisible')) {
                callback('error', 'in_use');
                return;
            }
            var state = this.state;
            if (!state.adm || state.contentId !== contentId) {
                callback('error', 'not_prepared');
                return;
            }
            if (state.adm.getBannersForSection('preroll').length > 0) {
                var elems = [state.overlay, state.wrapper, state.loading, state.muteButton, state.muteBlock];
                showHide([state.skipBlock, state.unmuteButton], elems, false);
                state.callback = function (adm, status, code) {
                    showHide(elems, [], false);
                    if (state.video) {
                        state.container.removeChild(state.video);
                        state.video = null;
                    }
                    state.adm = null;
                    callback(status, code);
                };
                state.adm.start('preroll');
            } else {
                callback('error', 'empty')
            }
        }
    };

    return {
        prepareMidroll: function (appId, userId, callback, preview) {
            ui.prepare('mm' + appId, userId, preview, callback);
        },
        showMidroll: function (appId, userId, callback) {
            ui.show('mm' + appId, userId, callback);
        },
        showPreroll: function (appId, userId, callback, preview) {
            ui.prepare('pm' + appId, userId, preview, function (status, code) {
                if (status === 'ok' && code === 'ready') {
                    ui.show('pm' + appId, userId, callback)
                } else {
                    callback(status, code);
                }
            });
        }
    }
}();

