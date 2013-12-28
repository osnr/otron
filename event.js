"use strict";

var users = {};
// users = {
//     /fbid/: {
//         privKey: DSA
//         chats: {
//             /targetFbid/: {
//                 unsafePort: Port
//                 tabs: [TabId]
//                 otr: OTR
//             }
//         }
//     }
// };

var initChat = function(user, ownId, id, tabId) {
    var chat = user.chats[id] = {
        unsafePort: chrome.tabs.connect(tabId, { name: unsafePortName(ownId, id) }),
        unsafePortTabId: tabId,

        tabSafePorts: {},
        otr: new OTR({
            fragment_size: 9000, // arbitrarily chosen for now
            send_interval: 200,
            priv: user.privKey
        }),

        unsafePortOnMessage: function(data) {
            // message from fbotr.js / fb.com
            // dispatch to OTR
            if (data.type === 'unsafeRecv') {
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
        chat.unsafePort.postMessage({
            type: 'unsafeSend',
            msg: msg
        });
    });

    chat.unsafePort.onMessage.addListener(chat.unsafePortOnMessage);

    chat.otr.on('error', function (err) {
        console.log("error occurred: " + err);
    });

    chat.unsafePort.onDisconnect.addListener(chat.unsafePortOnDisconnect);

    return chat;
};

var connectTab = function(user, ownId, id, tabId, safePort) {
    console.log("connectTab", user, ownId, id, tabId, safePort);

    var chat;
    if (!(id in user.chats)) {
        chat = initChat(user, ownId, id, tabId);
    } else {
        chat = user.chats[id];
    }

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

chrome.runtime.onConnect.addListener(
    function(safePort) {
        var namePieces = safePort.name.split("-");
        if (!(namePieces[0] === "safe" && namePieces[1] === "port")) return;

        var ownId = namePieces[2];
        var id = namePieces[3];

        var tabId = safePort.sender.tab.id;

        if (!(ownId in users)) {
            chrome.storage.local.get(privKeyKey(ownId), function(items) {
                var user;

                // hack: handle async case
                // (user was filled in while we were waiting for chrome.storage)
                if (ownId in users) user = users[ownId]; 
                else if (privKeyKey(ownId) in items) {
                    var privKey = DSA.parsePrivate(items[privKeyKey(ownId)]);

                    user = users[ownId] = {
                        privKey: privKey,
                        chats: {}
                    };

                } else {
                    // the key should have been generated by the content script
                    console.log("fail");
                }

                connectTab(user, ownId, id, tabId, safePort);
            });
        } else {
            connectTab(users[ownId], ownId, id, tabId, safePort);
        }
    });
