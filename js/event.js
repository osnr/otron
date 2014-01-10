"use strict";

var TIMEOUT = 10000;

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
    console.log("setStatus", chat, status);
    chat.status = status;
    postToSafePorts(chat, status);
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
            priv: privKey,

            debug: true
        }),

        status: null,

        unsafePortOnMessage: function(data) {
            // message from fbotr.js / fb.com
            // dispatch to OTR
            if (data.type === 'unsafeRecv') {
                console.log('unsafeRecv to user', ownId, 'from', id, data);
                chat.otr.receiveMsg(data.msg);
            }
        },
        unsafePortOnDisconnect: function() {
            console.log("unsafe port disconnect", chat.unsafePortTabId);

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
        console.log('unsafeSend from', ownId, 'to', id, msg);
        chat.unsafePort.postMessage({
            type: 'unsafeSend',
            msg: msg
        });
    });

    chat.otr.on('status', function (state) {
        console.log('status', ownId, id, state);
        switch (state) {
        case OTR.CONST.STATUS_SEND_QUERY:
            setStatus(chat, {
                type: 'status',
                status: 'sentQuery'
            });

            setTimeout(function() {
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

            setTimeout(function() {
                setStatus(chat, {
                    type: 'status',
                    status: 'timeout',
                    prevStatus: 'akeInit'
                });
            }, TIMEOUT);
            break;

        case OTR.CONST.STATUS_AKE_SUCCESS:
            // sucessfully ake'd with buddy
            var curFingerprint = chat.otr.their_priv_pk.fingerprint();
            var knownFingerprintsKey = makeName(["knownFingerprints", ownId, id]);

            chrome.storage.local.get(knownFingerprintsKey, function(items) {
                var trust;
                var prevFingerprints;

                var knownFingerprints = items[knownFingerprintsKey];
                if (knownFingerprints && knownFingerprints.length > 0) {
                    var matchingFingerprints = knownFingerprints.filter(
                        function(fp) {
                            return fp.fingerprint === curFingerprint; });

                    if (matchingFingerprints.length > 0) {
                        // fingerprint matched!
                        trust = matchingFingerprints[0].trust;

                    } else {
                        // alert user to fingerprint mismatch
                        trust = 'new';
                        prevFingerprints = knownFingerprints;

                        // we won't store this fingerprint until it's been verified
                    }

                } else {
                    // prompt for verification
                    trust = 'new';

                    storageSet(knownFingerprintsKey, [{
                        fingerprint: curFingerprint,
                        trust: trust
                    }]);
                }

                console.log("AKE success");
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

    chat.unsafePort.onMessage.addListener(chat.unsafePortOnMessage);

    chat.otr.on('error', function (err) {
        console.log("error occurred: " + err);
    });

    chat.unsafePort.onDisconnect.addListener(chat.unsafePortOnDisconnect);

    chat.otr.sendQueryMsg(); // the user wants to turn on encryption, so let's turn on encryption
};

var connectTab = function(user, ownId, id, tabId, safePort) {
    console.log("connectTab", arguments);
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
        console.log("disconnect from safePort", tabId);
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
        }
    });
};

var otrSeen = [];
var otrQueue = {};
chrome.runtime.onMessage.addListener(function(data, sender, sendResponse) {
    if (data.type === 'queryChatStatus') {
        if (ownId in users && id in users[ownId].chats) {
            sendResponse(true);
        } else {
            sendResponse(false);
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
                    console.log(d);
                    chat.otr.receiveMsg(d.msg);
                });
                delete otrQueue[ownId][id];
            }
        }

    } else if (data.type === 'regenKey') {
        // options page is watching for storage change
        // so we don't need to call them back
        generate('genKey');

    } else if (data.type === 'regenTokens') {
        generate('genTokens');
    }
    console.log(data);
});

chrome.runtime.onConnect.addListener(function(safePort) {
    var namePieces = safePort.name.split("-");
    if (!(namePieces[0] === "safePort")) return;

    var ownId = namePieces[1];
    var id = namePieces[2];

    var tabId = safePort.sender.tab.id;

    if (!(ownId in users)) {
        users[ownId] = {
            chats: {}
        };
    };

    connectTab(users[ownId], ownId, id, tabId, safePort);
});
