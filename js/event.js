"use strict";

var TIMEOUT = 30000;

var privKey;

(function loadPrivKey() {
    chrome.storage.local.get("privKey", function(items) {
        // note: private key is global over browser instance
        // (if you have multiple users sharing a Chrome,
        //  then they'll all use the same private key)
        if (!("privKey" in items)) {
            generate('genBoth', function(data) {
                privKey = data.privKey;
            });
        } else {
            privKey = DSA.parsePrivate(items["privKey"]);
        }
    });
})();

var users = {};
// users = {
//     /fbid/: {
//         chats: {
//             /targetFbid/: {
//                 unsafePort: Port
//                 unsafePortTabId: TabId
//                 tabSafePorts: [TabId]
//                 otr: OTR
//
//                 status: StatusMessageData
//                 serverTypingState: Boolean
//
//                 unsafePortOnMessage: function
//                 unsafePortOnDisconnect: function
//             }
//         }
//     }
// };

var postToSafePorts = function(chat, data) {
    for (var tid in chat.tabSafePorts) {
        chat.tabSafePorts[tid].postMessage(data);
    }
};

var setStatus = function(chat, status) {
    chat.status = status;
    postToSafePorts(chat, status);
};

var setTrust = function(ownId, id, chat, fingerprint, trust) {
    // this can be done 'offline' (eg in the options page)
    var knownFingerprintsKey = makeName(["knownFingerprints", ownId, id]);

    chrome.storage.local.get(knownFingerprintsKey, function(items) {
        var knownFingerprints = items[knownFingerprintsKey] || [];
        for (var i = 0; i < knownFingerprints.length; i++) {
            if (knownFingerprints[i].fingerprint === fingerprint) break;
        }
        knownFingerprints[i] = {
            fingerprint: fingerprint,
            trust: trust
        };
        storageSet(knownFingerprintsKey, knownFingerprints);

        if (chat && chat.status.status === 'akeSuccess') {
            setStatus(chat, {
                type: 'status',
                status: 'akeSuccess',

                fingerprint: fingerprint,
                trust: trust,

                prevFingerprints: chat.status.prevFingerprints
            });
        } 
    });
};

var typing = function(chat) {
    if (!chat.serverTypingState) {
        chat.serverTypingState = true;

        chat.unsafePort.postMessage({
            type: 'unsafeSendTyping',
            typing: true
        });
    }
};

var notTyping = function(chat) {
    if (chat.serverTypingState) {
        chat.unsafePort.postMessage({
            type: 'unsafeSendTyping',
            typing: false
        });
    }
    chat.serverTypingState = false;
};

var initChat = function(user, ownId, id, tabId, instanceTag, callback) {
    if (!instanceTag) {
        var instanceTagKey = makeName(["instanceTag", ownId, id]);
        chrome.storage.local.get(instanceTagKey, function(items) {
            if (instanceTagKey in items) {
                instanceTag = items[instanceTagKey];
            } else {
                instanceTag = OTR.makeInstanceTag();

                storageSet(instanceTagKey, instanceTag);
            }

            callback(initChat(user, ownId, id, tabId, instanceTag));
        });
        return;
    }

    var chat = user.chats[id] = {
        unsafePort: chrome.tabs.connect(tabId, { name: unsafePortName(ownId, id) }),
        unsafePortTabId: tabId,

        tabSafePorts: {},
        otr: new OTR({
            instance_tag: instanceTag,
            fragment_size: 9000, // arbitrarily chosen for now
            send_interval: 200,
            priv: privKey
        }),

        serverTypingState: false,
        status: null,

        unsafePortOnMessage: function(data) {
            // message from fbotr.js / fb.com
            // dispatch to OTR
            if (data.type === 'unsafeRecvTyping') {
                postToSafePorts(chat, {
                    type: 'recvTyping',
                    typing: data.typing
                });

            } else if (data.type === 'unsafeRecv') {
                chat.otr.receiveMsg(data.msg);
            }
        },
        unsafePortOnDisconnect: function() {
            // see if we have any tabs still open
            // if so, we'll use the first one we find as data source
            for (var tid in chat.tabSafePorts) {
                var newTabId = parseInt(tid);

                chat.unsafePort = chrome.tabs.connect(
                    newTabId,
                    { name: unsafePortName(ownId, id) });
                chat.unsafePortTabId = newTabId;
                chat.unsafePort.onMessage.addListener(chat.unsafePortOnMessage);
                chat.unsafePort.onDisconnect.addListener(chat.unsafePortOnDisconnect);
                return;
            }

            // OK, this chat is gone from the browser; time to wrap up
            // destroys keys too
            delete user.chats[id];

            if (Object.keys(user.chats).length === 0) {
                delete users[ownId];
            }
        }
    };
    chat.otr.ALLOW_V2 = true;
    chat.otr.ALLOW_V3 = true;
    chat.otr.REQUIRE_ENCRYPTION = true;

    if (otrQueue[ownId] && otrQueue[ownId][id]) {
        otrQueue[ownId][id].forEach(function(data) {
            chat.otr.receiveMsg(data.msg);
        });
        delete otrQueue[ownId][id];
    }

    chat.otr.on('ui', function (msg, encrypted) {
        // display message to user
        postToSafePorts(chat, {
            type: 'recv',
            msg: msg,
            encrypted: encrypted
        });
    });

    chat.otr.on('io', function (msg) {
        // send message over the wire
        chat.unsafePort.postMessage({
            type: 'unsafeSend',
            msg: msg
        });
    });

    var timeout = null;
    chat.otr.on('status', function (state) {
        switch (state) {
        case OTR.CONST.STATUS_SEND_QUERY:
            setStatus(chat, {
                type: 'status',
                status: 'sentQuery'
            });

            if (timeout !== null) clearTimeout(timeout);
            timeout = setTimeout(function() {
                setStatus(chat, {
                    type: 'status',
                    status: 'timeout',
                    prevStatus: 'sentQuery'
                });
            }, TIMEOUT);
            break;

        case OTR.CONST.STATUS_AKE_INIT:
            setStatus(chat, {
                type: 'status',
                status: 'akeInit'
            });

            if (timeout !== null) clearTimeout(timeout);
            timeout = setTimeout(function() {
                setStatus(chat, {
                    type: 'status',
                    status: 'timeout',
                    prevStatus: 'akeInit'
                });
            }, TIMEOUT);
            break;

        case OTR.CONST.STATUS_AKE_SUCCESS:
            // sucessfully ake'd with buddy
            if (timeout !== null) clearTimeout(timeout);

            var curFingerprint = chat.otr.their_priv_pk.fingerprint();
            var knownFingerprintsKey = makeName(["knownFingerprints", ownId, id]);

            chrome.storage.local.get(knownFingerprintsKey, function(items) {
                var trust;
                var prevFingerprints;

                var knownFingerprints = items[knownFingerprintsKey] || [];
                for (var i = 0; i < knownFingerprints.length; i++) {
                    if (knownFingerprints[i].fingerprint === curFingerprint) {
                        // match!
                        trust = knownFingerprints[i].trust;

                        knownFingerprints.splice(i, 1);
                        prevFingerprints = knownFingerprints;

                        break;
                    }
                }
                if (!trust) {
                    // no match
                    if (knownFingerprints.length === 0) {
                        trust = 'new';
                        prevFingerprints = knownFingerprints;
                    } else {
                        trust = 'unseen'; // we have fingerprints, but not this one! bad sign
                    }
                }

                knownFingerprints = prevFingerprints.slice(0);
                knownFingerprints.push({
                    fingerprint: curFingerprint,
                    trust: trust === 'new' ? 'seen' : trust
                });
                storageSet(knownFingerprintsKey, knownFingerprints);

                setStatus(chat, {
                    type: 'status',
                    status: 'akeSuccess',

                    fingerprint: curFingerprint,
                    trust: trust,

                    prevFingerprints: prevFingerprints // null / undefined if trusted or new
                });
            });

            break;
        case OTR.CONST.STATUS_END_OTR:
            setStatus(chat, {
                type: 'status',
                status: 'endOtr'
            });

            break;
        }
    });

    chat.otr.on('smp', function(type, data, act) {
        if (type === 'question') {
            authenticate(ownId, id, chat.otr.priv.fingerprint(), chat.status.fingerprint,
                         'smp', data);

        } else if (type === 'trust') {
            if (data) {
                setTrust(ownId, id, chat, chat.status.fingerprint, 'trusted');
            }
        }
    });

    chat.unsafePort.onMessage.addListener(chat.unsafePortOnMessage);

    chat.otr.on('error', function (err) {
        postToSafePorts(chat, {
            type: 'error',
            msg: err
        });
    });

    chat.unsafePort.onDisconnect.addListener(chat.unsafePortOnDisconnect);

    chat.otr.sendQueryMsg(); // the user wants to turn on encryption, so let's turn on encryption
};

var connectTab = function(user, ownId, id, tabId, safePort) {
    var chat;
    if (!(id in user.chats)) {
        initChat(user, ownId, id, tabId, false,
                 function() {
                     connectTab(user, ownId, id, tabId, safePort);
                 });
        return;
    } else {
        chat = user.chats[id];
        // if we're already connected, we'd better inform this tab of it
        if (chat.status) safePort.postMessage(chat.status);
    }

    if (tabId in chat.tabSafePorts) return;

    chat.tabSafePorts[tabId] = safePort;

    safePort.onDisconnect.addListener(function() {
        delete chat.tabSafePorts[tabId];

        // we'll also want to destroy the unsafePort for this tab
        // (safePort is from the iframe, so it gets killed on chatbox close
        //  but unsafePort runs to the whole browser tab, so we need to kill it
        //  ourselves if the tab is still open)
        if (chat.unsafePortTabId === tabId) {
            chat.unsafePort.disconnect();
            // this doesn't fire for some reason
            chat.unsafePortOnDisconnect();
        }
    });

    safePort.onMessage.addListener(function(data) {
        if (data.type === 'send') {
            chat.otr.sendMsg(data.msg);

            // reflect the message this tab just sent
            // back to all tabs' safechat boxes for display
            postToSafePorts(chat, {
                type: 'recvOwn',
                msg: data.msg
            });

            chat.serverTypingState = false; // server assumes we're done typing
            notTyping(chat);

        } else if (data.type === 'typing') {
            typing(chat);

        } else if (data.type === 'clear') {
            notTyping(chat);

        } else if (data.type === 'authenticate') {
//            if (chat.); // TODO check version
            authenticate(ownId, id, chat.otr.priv.fingerprint(), chat.status.fingerprint, 'both');
        }
    });
};

var otrSeen = [];
var otrQueue = {};
chrome.runtime.onMessage.addListener(function(data, sender, sendResponse) {
    if (data.type === 'queryChatStatus') {
        if (data.ownId in users && data.id in users[data.ownId].chats) {
            sendResponse({ chatting: true });
        } else {
            sendResponse({ chatting: false });
        }

    } else if (data.type === 'unsafeRecvOtr') {
        // "random" OTR messages received in unencrypted mode
        // (say, if Alice is talking to Bob and Bob suddenly encrypts
        //  and sends a message)
        // queue them up and feed them in
        if (otrSeen.indexOf(data.mid) !== -1) return;

        var ownId = data.ownId;
        var id = data.id;

        if (!(ownId in otrQueue)) otrQueue[ownId] = {};
        if (!(id in otrQueue[ownId])) otrQueue[ownId][id] = [];
        var q = otrQueue[ownId][id];

        otrSeen.push(data.mid);
        q.push(data);

        if (ownId in users && id in users[ownId].chats) {
            var chat = users[ownId].chats[id];

            if (otrQueue[ownId] && otrQueue[ownId][id]) {
                otrQueue[ownId][id].forEach(function(d) {
                    chat.otr.receiveMsg(d.msg);
                });
                delete otrQueue[ownId][id];
            }
        }

    } else if (data.type === 'regenKey') {
        // options page is watching for storage change
        // so we don't need to call them back
        generate('genKey');

    } else if (data.type === 'regenToken') {
        generate('genToken');

    } else if (data.type === 'authFingerprint') {
        // fingerprint auth request from options page
        // (assume there's no actual chat online)
        authenticate(data.ownId, data.id, data.ownFingerprint, data.fingerprint, 'fingerprint');

    } else if (data.type === 'initSafeChat') {
        // forward this back to the sender tab,
        // so that the safe chat iframe can pick it up
        chrome.tabs.sendMessage(sender.tab.id, data);
    }
});

var authenticate = function(ownId, id, ownFingerprint, fingerprint, mode, question) {
    // mode = undefined/'both' | 'smp' | 'fingerprint'
    var w = 460, h = 500;
    chrome.windows.create({
        url: chrome.extension.getURL("authenticate.html"),
        type: "popup",
        focused: true,

        width: w,
        height: h,
        left: (screen.width / 2) - (w / 2),
        top: (screen.height / 2) - (h / 2)

    }, function(popup) {
        chrome.tabs.query(
            { windowId: popup.id },
            function(tabs) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'initAuthenticate',

                    ownId: ownId,
                    id: id,
                    ownFingerprint: ownFingerprint,
                    fingerprint: fingerprint,

                    mode: mode,
                    question: question
                });
            });
    });
};

var onAuthConnect = function(ownId, id, fingerprint, authPort) {
    var getChat = function() {
        if (ownId in users && id in users[ownId].chats) {
            return users[ownId].chats[id];
        }
    };

    var onSmp = (function() { // chat mustn't leak from scope!
        var chat = getChat();
        var onSmp = function(type, data, act) {
            // the 'question' case is handled in the main smp handler
            // this handler is for when we need to touch the auth UI
            if (type === 'trust') {
                if (data) {
                    // the actual status part is in main handler
                    authPort.postMessage({ type: 'smpTrust' });
                } else {
                    authPort.postMessage({ type: 'smpFail', action: act });
                }

            } else if (type === 'abort') {
                authPort.postMessage({ type: 'smpAbort' });
            }
        };
        if (chat) chat.otr.on('smp', onSmp);
        return onSmp;
    })();

    authPort.onMessage.addListener(function(data) {
        if (data.type === 'authFingerprint') {
            // if we have an ongoing chat, we can update its status too
            setTrust(ownId, id, getChat(), fingerprint, 'trusted');

            authPort.postMessage({
                type: 'fingerprintTrust'
            });

        } else if (data.type === 'authSmp') {
            var chat = getChat();
            if (!chat) return; // TODO fire error, no SMP without ongoing chat!

            chat.otr.smpSecret(data.secret, data.prompt);

            authPort.postMessage({ type: 'smpInit' });

        } else if (data.type === 'authSmpResponse') {
            var chat = getChat();
            if (!chat) return;

            chat.otr.smpSecret(data.secret);

            authPort.postMessage({ type: 'smpResponseInit' });
        }
    });

    authPort.onDisconnect.addListener(function() {
        var chat = getChat();
        if (chat) chat.otr.off('smp', onSmp);
    });
};

var onSafePortConnect = function(ownId, id, safePort) {
    var tabId = safePort.sender.tab.id;

    if (!(ownId in users)) {
        users[ownId] = {
            chats: {}
        };
    };

    connectTab(users[ownId], ownId, id, tabId, safePort);
};

chrome.runtime.onConnect.addListener(function(port) {
    var namePieces = port.name.split("-");
    if (namePieces[0] === "authenticate") {
        onAuthConnect(namePieces[1], namePieces[2], namePieces[3], port);
    } else if (namePieces[0] === "safePort") {
        onSafePortConnect(namePieces[1], namePieces[2], port);
    }
});
