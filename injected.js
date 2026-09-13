(function() {
    // --- Anti-Tab-Switch Detection Logic (Stronger Version) ---
    const block = e => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    };

    // 1. Block Events Aggressively
    const eventsToBlock = [
        "blur", "focus", "pagehide", "visibilitychange", 
        "webkitvisibilitychange", "mouseleave", "resize"
    ];
    
    eventsToBlock.forEach(eventName => {
        window.addEventListener(eventName, block, true);
        document.addEventListener(eventName, block, true);
    });

    // 2. Override Document Properties
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'webkitHidden', { get: () => false, configurable: true });
    
    Document.prototype.hasFocus = new Proxy(Document.prototype.hasFocus, {
        apply() { return true; }
    });

    // 3. Spoof requestAnimationFrame (Websites use this to detect backgrounding because rAF pauses)
    let lastTime = 0;
    window.requestAnimationFrame = new Proxy(window.requestAnimationFrame, {
        apply(target, self, args) {
            // We use setTimeout to simulate rAF when hidden, as setTimeout is less aggressively throttled initially
            if (document.hidden || document.visibilityState !== 'visible') {
                const currTime = Date.now();
                const timeToCall = Math.max(0, 16 - (currTime - lastTime));
                const id = window.setTimeout(function() {
                    args[0](performance.now());
                }, timeToCall);
                lastTime = currTime + timeToCall;
                return id;
            } else {
                return Reflect.apply(target, self, args);
            }
        }
    });

    window.cancelAnimationFrame = new Proxy(window.cancelAnimationFrame, {
        apply(target, self, args) {
            window.clearTimeout(args[0]);
            return Reflect.apply(target, self, args);
        }
    });
    // ----------------------------------------------------------

    function getVarIdFromUrl() {
        // Matches /test/{var}/ or /test/{var}
        const match = window.location.pathname.match(/\/test\/([^\/]+)/);
        return match ? match[1] : null;
    }

    function isTargetUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        const varId = getVarIdFromUrl();
        if (varId && url.includes(varId)) {
            return true;
        }
        return false;
    }

    // 1. Intercept Fetch API
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        let url = "";
        if (args[0] instanceof Request) {
            url = args[0].url;
        } else if (typeof args[0] === 'string') {
            url = args[0];
        } else if (args[0] && args[0].url) {
            url = args[0].url;
        }
        
        const isTarget = isTargetUrl(url);
        if (isTarget) {
            console.log(`Hilfe: Target Fetch detected containing ID ->`, url);
        }

        const response = await originalFetch.apply(this, args);
        
        if (isTarget) {
            try {
                // Clone the response so the original fetch can still be read by the page
                const clone = response.clone();
                clone.text().then(text => {
                    console.log("Hilfe: Successfully intercepted Fetch response for", url);
                    // Send the intercepted data to the content script
                    window.postMessage({ 
                        type: "HILFE_INTERCEPTED_DATA", 
                        data: text, 
                        url: url 
                    }, "*");
                }).catch(e => console.error("Hilfe: Error reading fetch response:", e));
            } catch(e) {
                console.error("Hilfe: Error cloning fetch response:", e);
            }
        }
        
        return response;
    };

    // 2. Intercept XMLHttpRequest
    const XHR = XMLHttpRequest.prototype;
    const open = XHR.open;
    const send = XHR.send;

    XHR.open = function(method, url) {
        this._url = url;
        if (isTargetUrl(url)) {
            console.log(`Hilfe: Target XHR detected containing ID ->`, url);
        }
        return open.apply(this, arguments);
    };

    XHR.send = function() {
        this.addEventListener('load', function() {
            if (isTargetUrl(this._url)) {
                console.log("Hilfe: Successfully intercepted XHR response for", this._url);
                // Send the intercepted data to the content script
                window.postMessage({ 
                    type: "HILFE_INTERCEPTED_DATA", 
                    data: this.responseText, 
                    url: this._url 
                }, "*");
            }
        });
        return send.apply(this, arguments);
    };
})();
