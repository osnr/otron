"use strict";

var chatIsEncryptKey = function(ownId, id) {
    return makeName(["chatEncrypt", ownId, id]);
};

var sendMessage = (function() {
    // based on Krumiro bookmarklet: https://gist.github.com/FiloSottile/4215248
    function random(len) {
        var min = Math.pow(10, len-1);
        var max = Math.pow(10, len);
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // FRAGILE ajax request construction
    function generatePhstamp(qs, dtsg) {
        var input_len = qs.length;
        var numeric_csrf_value='';
        
        for(var ii=0;ii<dtsg.length;ii++) {
            numeric_csrf_value+=dtsg.charCodeAt(ii);
        }
        return '1' + numeric_csrf_value + input_len;
    }

    return function(fbid, targetFbid, dtsg, msg) {
        var d = new Date();
        var data = {
            "message_batch[0][timestamp_relative]": "" + ('0'+d.getHours()).slice(-2) + ":" + ('0'+d.getMinutes()).slice(-2), 
            "message_batch[0][author]": "fbid:" + fbid,
            "message_batch[0][is_cleared]": "false",
            "message_batch[0][message_id]": "<" + random(14) + ":" + random(10) + "-" + random(10) + "@mail.projektitan.com>", 
            "message_batch[0][specific_to_list][0]": "fbid:" + targetFbid, 
            "__user": fbid, 
            "message_batch[0][timestamp_absolute]": "Oggi",
            "message_batch[0][spoof_warning]": "false", 
            "message_batch[0][client_thread_id]": "user:" + targetFbid, 
            "message_batch[0][source]": "source:chat:web", 
            "message_batch[0][has_attachment]": "false",
            "message_batch[0][source_tags][0]": "source:chat",
            "message_batch[0][body]": msg, 
            "message_batch[0][is_filtered_content]": "false", 
            "message_batch[0][timestamp]": "" + Math.round(d.getTime() / 1000), 
            "message_batch[0][is_unread]": "false", 
            "message_batch[0][action_type]": "ma-type:user-generated-message", 
            "__a": "1", 
            "message_batch[0][specific_to_list][1]": "fbid:" + fbid, 
            "message_batch[0][html_body]": "false", 
            "message_batch[0][status]": "0", 
            "client": "mercury",
            "message_batch[0][is_forward]": "false",
            "fb_dtsg": dtsg
        };
        var req = $.param(data);
        req += "&phstamp=" + generatePhstamp(req, dtsg);

        $.post("ajax/mercury/send_messages.php", req, function() {
            console.log("success", arguments);
        });
    };
})();

function runInPageContext(f) {
    var script = document.createElement("script");

    script.innerText = ";(" + String(f) + ")();";

    document.body.appendChild(script);
}

var receiveListeners = {}; // map targetFbid -> callback
var setReceiveListener = function(fbid, callback) {
    receiveListeners[fbid] = callback;
};
var removeReceiveListener = function(fbid) {
    delete receiveListeners[fbid];
};

var initChatInterception = function() {
    runInPageContext(function() {
        /* intercept incoming messages and forward to us so we can look for ?OTR: */
        var ctmv = require("ChatTabMessagesView").prototype;
        var anm = ctmv._appendNewMessages;

        ctmv._appendNewMessages = function(messages) {
            messages.forEach(function(message) {
                window.postMessage({
                    type: 'unsafeRecv',
                    sender: message.author.substring("fbid:".length),
                    mid: message.message_id,
                    msg: message.body
                }, "https://www.facebook.com");
            });

            return anm.apply(this, arguments);
        };

        /* whitespace-tag outgoing FB messages (doesn't include our OTRed ones) */
        var msd = require("MercuryServerDispatcher");
        var ts = msd.trySend;

        msd.trySend = function(uri, data) {
            if (uri === "/ajax/mercury/send_messages.php" &&
                "message_batch" in data) {

                for (var i = 0; i < data.message_batch.length; i++) {
                    /* append constant WHITESPACE_TAG */
                    data.message_batch[i].body +=
                        "\x20\x09\x20\x20\x09\x09\x09\x09" +
                        "\x20\x09\x20\x09\x20\x09\x20\x20" +
                        "\x20\x20\x09\x09\x20\x20\x09\x20" + /* OTRv2 */
                        "\x20\x20\x09\x09\x20\x20\x09\x09"; /* OTRv3 */
                }
            }

            return ts.apply(this, arguments);
        };
    });

    window.addEventListener("message", function(event) {
        if (event.source !== window) return;

        if (event.data.type === 'unsafeRecv' &&
            event.data.sender in receiveListeners) {

            receiveListeners[event.data.sender]({
                type: 'unsafeRecv',
                mid: event.data.mid,
                msg: event.data.msg
            });
        }
    });
};

var Chat = function(chat, ownId) {
    // FRAGILE get user id of friend
    var id = $(chat).find('.uiMenu .uiMenuItem > ' +
                          '.itemAnchor[href^="https://www.facebook.com/messages/"]')
        .attr("href");
    if (!id || /\/messages\/conversation-id/.test(id)) {
        return false; // exclude group chat
    }
    id = id.substring("https://www.facebook.com/messages/".length);

    var name = $(chat).find('.titlebarText').text();

    var dtsg = $('input[name="fb_dtsg"]').val();

    var isEncrypted = false;

    console.log("coverin", chat, ownId, id);

    chrome.storage.local.get(chatIsEncryptKey(ownId, id), function(items) {
        if (chrome.runtime.lastError || $.isEmptyObject(items)) {
            notEncrypted(true);
        } else {
            encrypted();
        }
    });

    var storageOnChanged = function(changes, areaName) {
        for (var key in changes) {
            if (key !== chatIsEncryptKey(ownId, id)) continue;

            var ch = changes[key];
            if (ch.newValue && !('oldValue' in ch)) {
                encrypted();
            } else if (!('newValue' in ch) && ch.oldValue) {
                notEncrypted();
            }

            return;
        }
    };
    chrome.storage.onChanged.addListener(storageOnChanged);

    // state change procedures -- these will trigger
    // the async storageOnChanged event above
    // which is what actually activates encryption
    // (for all tabs at once, not just this one)
    var enableEncryption = function() {
        var obj = {};
        obj[chatIsEncryptKey(ownId, id)] = true;

        chrome.storage.local.set(obj);
    };

    var disableEncryption = function() {
        chrome.storage.local.remove(chatIsEncryptKey(ownId, id));
    };

    // set up unencrypted state
    var notEncrypted = function(initializing) {
        if (!isEncrypted && !initializing) return;
        isEncrypted = false;

        $(chat).find(".otr-locked").remove();
        unencryptChat();

        chrome.runtime.onConnect.removeListener(runtimeOnConnect);
        setReceiveListener(id, function(data) {
            if (data.msg.substring(0, 4) === "?OTR") {
                chrome.runtime.sendMessage({
                    type: 'unsafeRecvOtr',
                    ownId: ownId,
                    id: id,
                    mid: data.mid,
                    msg: data.msg
                });

                enableEncryption();
                console.log("OTR request", id);
            }
        });

        addEncryptButton();
    };

    var addEncryptButton = function() {
        return $('<a data-hover="tooltip" aria-label="Encrypt this chat with OTR"' +
                 ' class="otr-unlocked otr-button button" role="button"></a>')
            .insertAfter($(chat).find(".addToThread"))
            .click(function(e) {
                enableEncryption();
                return false;
            });
    };

    var unencryptChat = function() {
        $(chat)
            .find(".safe-chat").remove().end()
            .find(".addToThread").show().end()
            .find(".fbNubFlyoutBody").show().end()
            .find(".fbNubFlyoutFooter").show().end();

        $(window).off("resize");
    };

    // set up encrypted state
    var encrypted = function() {
        if (isEncrypted) return;
        isEncrypted = true;

        $(chat).find(".otr-unlocked").remove();
        removeReceiveListener(id); // no need to watch for OTR messages

        encryptChat();

        chrome.runtime.onConnect.addListener(runtimeOnConnect);

        addDecryptButton();
    };

    var encryptChat = function() {
        // fbids are not secure (evil fb.com can mess with iframe src) but this seems OK
        // since evil fb.com can only switch around / break conversations this way,
        // which they could do anyway
        var $safeChat = $('<iframe class="safe-chat" src="' + chrome.extension.getURL("safechat.html") +
                          '?' + makeName([ownId, id]) + '"></iframe>');
        $(chat)
            .find(".addToThread").hide().end()
            .find(".fbNubFlyoutBody").hide().end()
            .find(".fbNubFlyoutFooter")
                .hide()
                .parent()
                    .append($safeChat);

        $(window).resize(function() {
            $safeChat.height($(chat).find(".fbNubFlyoutBody").height());
        });
    };

    var runtimeOnConnect = function(port) {
        // fires when a channel is opened to this tab

        console.log(id, "got new port", port);
        if (port.name !== unsafePortName(ownId, id)) return;

        setReceiveListener(id, function(data) {
            port.postMessage({ type: 'unsafeRecv',
                               msg: data.msg });
        });

        port.onMessage.addListener(function(data) {
            // the user wants to send a message
            if (data.type === 'unsafeSend') {
                sendMessage(ownId, id, dtsg, data.msg);
            }
        });
    };

    var addDecryptButton = function() {
        return $('<a data-hover="tooltip" aria-label="Stop encrypting this chat"' +
                 ' class="otr-locked otr-button button" role="button"></a>')
            .insertAfter($(chat).find(".addToThread"))
            .click(function(e) {
                disableEncryption();
                return false;
            });
    };

    this.el = chat;
    this.destroy = function() {
        // the chatbox has been closed, we assume all nodes are destroyed
        // (partial overlap with notEncrypted)
        console.log("destroying");
        removeReceiveListener(id);
        chrome.storage.onChanged.removeListener(storageOnChanged);
        chrome.runtime.onConnect.removeListener(runtimeOnConnect);
    };

    return this;
};

function start(target, ownId) {
    initChatInterception();

    var chats = [];
    var addChat = function(el, ownId) {
        var chat = new Chat(el, ownId);
        if (chat) chats.push(chat);
    };

    // create an observer instance
    // TODO replace with more FB hooks :D
    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            for (var i = 0; i < mutation.addedNodes.length; ++i) {
                var addedNode = mutation.addedNodes[i];

                addChat(addedNode, ownId);
            }

            for (i = 0; i < mutation.removedNodes.length; ++i) {
                var removedNode = mutation.removedNodes[i];
                console.log("removedNode", removedNode);

                for (var j = 0; j < chats.length; ++j) {
                    var chat = chats[j];
                    if (chat.el === removedNode) {
                        chat.destroy();
                        chats.splice(j, 1);
                        break;
                    }
                }
            }
        });
    });

    // configuration of the observer:
    var config = { childList: true };

    observer.observe(target, config);

    $(".fbDockChatTabFlyout").each(function(i, el) { addChat(el, ownId); });
};

$(document).ready(function() { // TODO do we need to wait till document.ready?
    runInPageContext(function() {
        /* relay user ID to content script context */
        var ownId = require("CurrentUser").getID();

        var idEl = document.createElement("a");
        idEl.id = "otr-own-id";
        idEl.dataset.ownId = ownId;
        document.body.appendChild(idEl);
    });

    var interval = 100;
    window.setTimeout(function init() {
        console.log("checking");

        // FRAGILE select the chat tab bar
        var target = $("#ChatTabsPagelet > .fbNubGroup > .fbNubGroup")[0];

        var notReady = !target;

        var ownId = $("#otr-own-id").data("own-id");

        notReady = notReady || !ownId;

        // FRAGILE wait until we have tabs loaded for all chats
        $(".fbDockChatTabFlyout").each(function(i, el) {
            if (!$(el).find(".titlebarText").attr("href")) {
                notReady = true;
                return false;
            }
        });

        if (notReady) {
            window.setTimeout(init, interval);
            return;
        }

        start(target, ownId);
    }, interval);
});
