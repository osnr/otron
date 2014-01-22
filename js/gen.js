"use strict";

function makePopup(mode, callback) {
    var w = 350;
    var h;
    if (mode === 'genBoth') {
        h = 450;
    } else if (mode === 'genKey') {
        h = 150;
    } else if (mode === 'genToken') {
        h = 350;
    }
    chrome.windows.create({
        url: chrome.extension.getURL("generating.html") + "?" + mode,
        type: "popup",
        focused: true,

        width: w,
        height: h,
        left: (screen.width / 2) - (w / 2),
        top: (screen.height / 2) - (h / 2)
    }, callback);
}

// from https://gist.github.com/snorpey/5990253
var getAverageColor = (function() {
    var i;
    var len;
    var multiplicator = 20;
    var count;
    var rgba;
    
    function getAverageRGBA( image_data, resolution ) {
	multiplicator = parseInt( resolution, 10 ) > 1 ? parseInt( resolution, 10 ) : 10;
	len = image_data.data.length;
	count = 0;
	rgba = [ 0, 0, 0, 0 ];
        
	for ( i = 0; i < len; i += multiplicator * 4 )
	{
	    rgba[0] = rgba[0] + image_data.data[i];
	    rgba[1] = rgba[1] + image_data.data[i + 1];
	    rgba[2] = rgba[2] + image_data.data[i + 2];
	    rgba[3] = rgba[3] + image_data.data[i + 3];
            
	    count++;
	}
        
	rgba[0] = ~~ ( rgba[0] / count );
	rgba[1] = ~~ ( rgba[1] / count );
	rgba[2] = ~~ ( rgba[2] / count );
	rgba[3] = ~~ ( rgba[3] / count );
        
	return rgba;
    }
    
    return getAverageRGBA;
})();


function generate(mode, callback) {
    makePopup(mode, function(popup) {
        var privKey;
        var token;

        // bookkeeping (fake "modal window", cleanup)
        var keepFocus = function(newWid) {
            if (newWid === popup.id) return;
            chrome.windows.update(popup.id, {
                focused: true
            });
        };

        // chrome.windows.onFocusChanged.addListener(keepFocus);

        chrome.windows.onRemoved.addListener(function removed(wid) {
            if (wid === popup.id) {
                // chrome.windows.onFocusChanged.removeListener(keepFocus);
                chrome.windows.onRemoved.removeListener(removed);

                if (((mode === 'genKey' || mode === 'genBoth') && !privKey) ||
                    ((mode === 'genToken' || mode === 'genBoth') && !token)) {

                    // user prematurely closed the popup! how rude
                    // TODO let's spawn a new one!
                }
            }
        });

        var loadedPopup = function(data) {
            if (data.type !== 'loaded') return;

            chrome.runtime.onMessage.removeListener(loadedPopup);

            if (mode === 'genKey' || mode === 'genBoth') {
                // generate private key (this takes a while, is blocking)
                privKey = new DSA();

                chrome.storage.local.set({
                    ownFingerprint: privKey.fingerprint(),
                    privKey: privKey.packPrivate()
                });
            }

            if (mode === 'genToken' || mode === 'genBoth') {
                var canvas = randIconCanvas(128);
                token = {
                    image: canvas.toDataURL("image/png"),
                    color: getAverageColor(canvas.getContext("2d").getImageData(0, 0, 128, 128),
                                           128)
                };

                chrome.storage.local.set({
                    token: token
                });
            }

            // show user the token, get token image, inform of completion
            chrome.tabs.query(
                { windowId: popup.id },
                function(tabs) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: 'doneGen',
                        fingerprint: privKey ? privKey.fingerprint() : null,
                        token: token
                    });
                });

            if (callback) callback({
                privKey: privKey,
                token: token
            });
        };

        chrome.runtime.onMessage.addListener(loadedPopup);
    });
}

function randIconCanvas(size) {
    var tokenNum = new Uint32Array(1);
    window.crypto.getRandomValues(tokenNum);

    tokenNum = tokenNum[0];

    var canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    new Identicon(canvas, tokenNum, size);

    return canvas;
}
