"use strict";

var chatIsEncryptKey = function(ownId, id) {
    return makeName(["chat", ownId, id, "encrypt"]);
};

function s4() {
  return Math.floor((1 + Math.random()) * 0x10000)
             .toString(16)
             .substring(1);
}

function guid() {
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
         s4() + '-' + s4() + s4() + s4();
}

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

var sendMessage = function(fbid, targetFbid, dtsg, msg) {
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

var Chat = function(chat, ownId) {
    var id = $(chat).find('.uiMenu .uiMenuItem > ' +
                          '.itemAnchor[href^="https://www.facebook.com/messages/"]')
        .attr("href");
    if (!id || /\/messages\/conversation-id/.test(id)) {
        return false; // exclude group chat
    }
    id = id.substring("https://www.facebook.com/messages/".length);

    var dtsg = $('input[name="fb_dtsg"]').val();

    console.log("coverin", chat, ownId, id);

    chrome.storage.local.get(chatIsEncryptKey(ownId, id), function(items) {
        if (chrome.runtime.lastError || $.isEmptyObject(items)) {
            notEncrypted();
        } else {
            encrypted();
        }
    });

    var enableEncryption = function() {
        var obj = {};
        obj[chatIsEncryptKey(ownId, id)] = true;

        chrome.storage.local.set(obj);
    };

    var disableEncryption = function() {
        chrome.storage.local.remove(chatIsEncryptKey(ownId, id));
    };

    // flip into unencrypted state
    var notEncrypted = function() {
        $(chat).find(".otr-locked").remove();
        unencryptChat();

        chrome.runtime.onConnect.removeListener(runtimeOnConnect);
        if (observer) observer.disconnect();

        addEncryptButton();
    };

    var addEncryptButton = function() {
        return $('<a data-hover="tooltip" aria-label="Encrypt this chat with OTR"' +
                 ' class="otr-unlocked otr-button button" role="button"></a>')
            .prependTo($(chat).find(".titlebarButtonWrapper"))
            .click(function(e) {
                enableEncryption();
                return false;
            });
    };

    var unencryptChat = function() {
        $(chat)
            .find(".safe-chat").remove().end()
            .find(".fbNubFlyoutBody").show().end()
            .find(".fbNubFlyoutFooter").show().end();
    };

    // flip into encrypted state
    var encrypted = function() {
        $(chat).find(".otr-unlocked").remove();

        encryptChat();

        chrome.runtime.onConnect.addListener(runtimeOnConnect);

        addDecryptButton();
    };

    var runtimeOnConnect = function(port) {
        // fires when a channel is opened to this tab

        console.log(id, "got new port", port);
        if (port.name !== unsafePortName(ownId, id)) return;

        listenForMessages(function(msg) {
            port.postMessage({ type: 'unsafeRecv',
                               msg: msg });
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
            .prependTo($(chat).find(".titlebarButtonWrapper"))
            .click(function(e) {
                disableEncryption();
                return false;
            });
    };

    var encryptChat = function() {
        // fbids are not secure (evil fb.com can mess with iframe src) but this seems OK
        // since evil fb.com can only switch around / break conversations this way,
        // which they could do anyway
        var $safeChat = $('<iframe class="safe-chat" src="' + chrome.extension.getURL("safechat.html") +
                          '?' + makeName([ownId, id]) + '"></iframe>');
        $(chat)
            .find(".fbNubFlyoutBody")
                .width(function(i, width) { // TODO deal with zero case
                    $safeChat.width(width);
                    return false;
                })
                .height(function(i, height) {
                    $safeChat.height(height);
                    return false;
                })
                .hide()
                .end()
            .find(".fbNubFlyoutFooter")
                .hide()
                .parent()
                    .append($safeChat);
    };

    var observer;
    var listenForMessages = function(callback) {
        // create an observer instance
        var seen = [];
        observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                // FRAGILE drill down to individual message elements
                $(mutation.addedNodes).find("*").andSelf()
                    .find('[data-jsid="message"]').each(function(i, msgEl) {
                        // skip duplicate node-add events
                        if ($.inArray(msgEl, seen) !== -1) return;

                        seen.push(msgEl);
                        var $msgEl = $(msgEl);

                        var msg = $msgEl.text();

                        // FRAGILE detect if msg is ours (or doesn't exist)
                        if (!msg || $msgEl.closest(".fbChatConvItem")
                            .find(".profileLink").attr("href") === "#") {

                            return;
                        }

                        callback(msg);
                    });
            });
        });

        // configuration of the observer:
        var config = { childList: true, subtree: true };

        observer.observe($(chat).find(".conversation")[0], config);
    };

    var storageOnChanged = function(changes, areaName) {
        for (var key in changes) {
            if (key !== chatIsEncryptKey(ownId, id)) continue;

            var ch = changes[key];
            if (ch.newValue === true && !('oldValue' in ch)) {
                encrypted();
            } else if (!('newValue' in ch) && ch.oldValue === true) {
                notEncrypted();
            }

            return;
        }
    };
    chrome.storage.onChanged.addListener(storageOnChanged);

    this.el = chat;
    this.destroy = function() {
        // the chatbox has been closed, we assume all nodes are destroyed
        // (partial overlap with notEncrypted)
        console.log("destroying");
        chrome.storage.onChanged.removeListener(storageOnChanged);
        chrome.runtime.onConnect.removeListener(runtimeOnConnect);
    };

    return this;
};

function start(target, ownId, privKey) {
    var chats = [];

    // create an observer instance
    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            for (var i = 0; i < mutation.addedNodes.length; ++i) {
                var addedNode = mutation.addedNodes[i];

                var chat = new Chat(addedNode, ownId, privKey);
                if (chat) chats.push(chat);
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

    $(".fbDockChatTabFlyout").each(function(i, el) { new Chat(el, ownId, privKey); });
};

$(document).ready(function() { // TODO do we need to wait till document.ready?
    var interval = 100;
    window.setTimeout(function init() {
        console.log("checking");

        // FRAGILE select the chat tab bar
        var target = $("#ChatTabsPagelet > .fbNubGroup > .fbNubGroup")[0];

        var notReady = !target;

        // FRAGILE get own fbid
        var gt = $(".fbxWelcomeBoxName").data("gt") || $(".timelineUnitContainer").data("gt");
        var ownId = gt.bmid || gt.viewerid || $("input[name=targetid]").val();

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

        // check/generate DSA key here
        // (this should probably be in event.js,
        //  but I need to expose the blocking delay
        //  to the user on the FB page)
        chrome.storage.local.get(privKeyKey(ownId), function(items) {
            if (privKeyKey(ownId) in items) {
                start(target, ownId);

            } else {
                $msg = $('<div class="gen-key"><div class="gen-key-dialog">Generating chat encryption key. Please wait a few seconds...</div></div>')
                    .hide()
                    .appendTo($("body"))
                    .fadeIn();

                (function waitUntilMsg() {
                    window.setTimeout(function() {
                        if ($(".gen-key").length === 0) {
                            waitUntilMsg();
                            return;
                        }

                        var privKey = new DSA();

                        var obj = {};
                        obj[privKeyKey(ownId)] = privKey.packPrivate();

                        chrome.storage.local.set(obj, function() {
                            $msg.fadeOut(function() { $msg.remove(); });

                            start(target, ownId);
                        });
                    }, 100);
                })();
            }
        });
    }, interval);
});
