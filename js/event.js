"use strict";

var privKey;

(function loadPrivKey() {
    chrome.storage.local.get("privKey", function(items) {
        // note: private key is global over browser instance
        // (if you have multiple users sharing a Chrome,
        //  then they'll all use the same private key)
        if (!("privKey" in items)) {
            genKey(function(pk) {
                privKey = pk;
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

var initChat = function(user, ownId, id, tabId, instanceTag, callback) {
    if (!instanceTag) {
        var instanceTagKey = makeName(["instanceTag", ownId, id]);
        chrome.storage.local.get(instanceTagKey, function(items) {
            if (instanceTagKey in items) {
                instanceTag = items[instanceTagKey];
            } else {
                instanceTag = OTR.makeInstanceTag();

                var obj = {};
                obj[instanceTagKey] = instanceTag;
                chrome.storage.local.set(obj);
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
        // display message (decrypted or never-encrypted) to user
        for (var tid in chat.tabSafePorts) {
            if (!chat.tabSafePorts.hasOwnProperty(tid)) continue;

            chat.tabSafePorts[tid].postMessage({
                type: 'recv',
                msg: msg
            });
        }
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
        case OTR.CONST.STATUS_AKE_SUCCESS:
            // sucessfully ake'd with buddy
            // check if buddy.msgstate === OTR.CONST.MSGSTATE_ENCRYPTED
            // TODO record public key
            
            break;
        case OTR.CONST.STATUS_END_OTR:
            // if buddy.msgstate === OTR.CONST.MSGSTATE_FINISHED
            // inform the user that his correspondent has closed his end
            // of the private connection and the user should do the same
            break;
        }
    });

    chat.unsafePort.onMessage.addListener(chat.unsafePortOnMessage);

    chat.otr.on('error', function (err) {
        console.log("error occurred: " + err);
    });

    chat.unsafePort.onDisconnect.addListener(chat.unsafePortOnDisconnect);

    chat.otr.sendQueryMsg(); // the user turned on encryption, so let's turn on encryption

    return chat;
};

var connectTab = function(user, ownId, id, tabId, safePort) {
    console.log("connectTab", arguments);
    var chat;
    if (!(id in user.chats)) {
        chat = initChat(user, ownId, id, tabId, false,
                        function() {
                            connectTab(user, ownId, id, tabId, safePort);
                        });
        return;
    } else {
        chat = user.chats[id];
    }

    if (tabId in chat.tabSafePorts) return;

    chat.tabSafePorts[tabId] = safePort;

    safePort.onDisconnect.addListener(function() {
        console.log("disconnect from safePort", tabId);
        delete chat.tabSafePorts[tabId];

        // we'll also want to destroy the unsafePort for this tab
        // (safePort is from the iframe, so it gets killed on chatbox close
        //  but unsafePort runs to the whole browser tab, so we need to kill it
        //  ourselves)
        if (chat.unsafePortTabId === tabId) {
            chat.unsafePort.disconnect();
            // this doesn't fire for some reason
            chat.unsafePortOnDisconnect();
        }
    });

    safePort.onMessage.addListener(function(data) {
        if (data.type === 'send') {
            chat.otr.sendMsg(data.msg);

            // reflect this message one tab just sent
            // back to all the other tabs
            for (var tid in chat.tabSafePorts) {
                if (parseInt(tid) === tabId || !chat.tabSafePorts.hasOwnProperty(tid)) continue;

                chat.tabSafePorts[tid].postMessage({
                    type: 'recvOwn',
                    msg: data.msg
                });
            }
        }
    });
};

var otrSeen = [];
var otrQueue = {};
chrome.runtime.onMessage.addListener(function(data) {
    if (data.type === 'unsafeRecvOtr') {
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

    } // else if (data.type === '
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