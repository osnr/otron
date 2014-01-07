function genKey(callback) {
    var w = 350, h = 350;
    chrome.windows.create({
        url: chrome.extension.getURL("generating.html"),
        type: "popup",
        focused: true,

        width: w,
        height: h,
        left: (screen.width / 2) - (w / 2),
        top: (screen.height / 2) - (h / 2)
    }, function(popup) {
        var privKey;

        // bookkeeping (fake "modal window", cleanup)
        var keepFocus = function(newWid) {
            if (newWid === popup.id) return;
            chrome.windows.update(popup.id, {
                focused: true
            });
        };

        chrome.windows.onFocusChanged.addListener(keepFocus);

        chrome.windows.onRemoved.addListener(function removed(wid) {
            if (wid === popup.id) {
                chrome.windows.onFocusChanged.removeListener(keepFocus);
                chrome.windows.onRemoved.removeListener(removed);

                if (!privKey) {
                    // user prematurely closed the popup! how rude
                    // TODO replace popup
                }
            }
        });

        chrome.runtime.onMessage.addListener(function loaded(data) {
            if (data.type !== 'loaded') return;

            chrome.runtime.onMessage.removeListener(loaded);

            // generate private key (this takes a while, is blocking)
            privKey = new DSA();

            var obj = {};
            obj["privKey"] = privKey.packPrivate();
            chrome.storage.local.set(obj);

            // show user the token, inform of completion
            chrome.tabs.query(
                { active: true, windowId: popup.id },
                function(tabs) {
                    var tokenNum = new Uint32Array(1);
                    window.crypto.getRandomValues(tokenNum);

                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: 'generatedKey',
                        tokenNum: tokenNum[0]
                    });
                });

            callback(privKey);
        });
    });
}
