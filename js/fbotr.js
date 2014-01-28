"use strict";

var chatIsEncryptKey = function(ownId, id) {
    return makeName(["chatEncrypt", ownId, id]);
};

var sendTyping = (function() {
    function generateTtstamp(dtsg) {
        var ttstamp = "2";
        for (var i = 0; i < dtsg.length; i++) {
            ttstamp += dtsg.charCodeAt(i);
        }
        return ttstamp;
    }

    return function(fbid, targetFbid, dtsg, typing) {
        var data = {
            "typ": typing ? 1 : 0,
            "to": targetFbid,
            "source": "mercury-chat",
            // "thread": "", // this is hard to derive

            "__user": fbid,
            "__a": 1, // wtf is this?
            "__dyn": "7n8a9EAMNpFER6gDxrHaHyG85oCQqbx2mbyaFaaBG", // loaded module hash
            "__req": "qq", // sposed to be base-36 counter, I think

            "fb_dtsg": dtsg,
            "ttstamp": generateTtstamp(dtsg)
            // "__rev": "??" // SVN revision
        };

        var req = $.param(data);
        $.post("/ajax/messaging/typ.php", req);
    };
})();

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

        $.post("/ajax/mercury/send_messages.php", req);
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
    runInPageContext(function otrIntercept() {
        /* intercept typing status change */
        var mti = require("MercuryTypingIndicator");
        if (!mti) {
            setTimeout(otrIntercept, 100);
            return;
        }
        var mtip = mti.prototype;
        var hsc = mtip._handleStateChanged;

        mtip._handleStateChanged = function(typers) {
            if (typers.length > 1) return hsc.apply(this, arguments);

            var id = this._threadID.substring(5);
            window.postMessage({
                type: 'unsafeRecvTyping',
                sender: id,
                typing: typers.indexOf("fbid:" + id) !== -1
            }, "*");

            return hsc.apply(this, arguments);
        };

        /* intercept incoming messages and forward to us so we can look for ?OTR: */
        var ctmv = require("ChatTabMessagesView");
        if (!ctmv) {
            setTimeout(otrIntercept, 100);
            return;
        }

        var ctmvp = ctmv.prototype;
        var anm = ctmvp._appendNewMessages;

        ctmvp._appendNewMessages = function(messages) {
            messages.forEach(function(message) {
                window.postMessage({
                    type: 'unsafeRecv',
                    sender: message.author.substring("fbid:".length),
                    mid: message.message_id,
                    msg: message.body
                }, "*");
            });

            return anm.apply(this, arguments);
        };

        /* whitespace-tag outgoing FB messages (doesn't include our OTRed ones) */
        var msd = require("MercuryServerDispatcher");
        if (!msd) {
            setTimeout(otrIntercept, 100);
            return;
        }
        var ts = msd.trySend;

        var ctv = require("ChatTabView");
        if (!ctv) {
            setTimeout(otrIntercept, 100);
            return;
        }
        var ctvp = ctv.prototype;
        var uas = ctvp.updateAvailableStatus;

        var tagNextMsg = {};
        ctvp.updateAvailableStatus = function() {
            tagNextMsg[this._getCanonicalUserID()] = true;
            return uas.apply(this, arguments);
        };

        msd.trySend = function(uri, data) {
            if (uri === "/ajax/mercury/send_messages.php" &&
                "message_batch" in data) {

                for (var i = 0; i < data.message_batch.length; i++) {
                    var message = data.message_batch[i];

                    var tag = false;
                    var id;
                    message.specific_to_list.forEach(function(fbid) {
                        id = fbid.substring(5);
                        if (fbid !== message.author &&
                            tagNextMsg[id]) {

                            tag = true;
                            tagNextMsg[id] = false;
                        }
                    });

                    if (!tag) continue;

                    /* TODO only send at beginning of chat */
                    /* append constant WHITESPACE_TAG */
                    message.body +=
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

        if (event.data.sender in receiveListeners) {
            receiveListeners[event.data.sender](event.data);
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

    // record name for UI convenience in Options
    var name = $(chat).find('.titlebarText').text();
    storageSet(makeName(["name", ownId, id]), name);

    var dtsg = $('input[name="fb_dtsg"]').val();

    var isEncrypted = false;

    var token;
    chrome.storage.local.get(["token", chatIsEncryptKey(ownId, id)], function(items) {
        token = items.token;

        if (!(chatIsEncryptKey(ownId, id) in items)) {
            notEncrypted(true);
        } else {
            chrome.runtime.sendMessage({
                type: 'queryChatStatus',
                ownId: ownId,
                id: id
            }, function(data) {
                if (data.chatting) {
                    encrypted();
                } else {
                    notEncrypted(true);
                    supports(function(name) { return "Resume encryption?"; }, true);
                }
            });
        }
    });

    var storageOnChanged = function(changes, areaName) {
        for (var key in changes) {
            if (key !== chatIsEncryptKey(ownId, id)) continue;

            var ch = changes[key];
            if (ch.newValue && !isEncrypted) {
                encrypted();
            } else if (!('newValue' in ch) && isEncrypted) {
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
        // why Math.random?
        // so that this triggers a change in state when the user asks,
        // and doesn't just reconfirm "yeah, we were using encryption before"
        storageSet(chatIsEncryptKey(ownId, id), 1 + Math.random());
    };

    var disableEncryption = function() {
        chrome.storage.local.remove(chatIsEncryptKey(ownId, id));
    };

    var supports = function(prompt, stop) {
        var $header = $('<div class="otr-header"></div>')
            .click(function() {
                $(chat).find(".otr-header").remove();
            })
            .append($('<span class="otr-supports"></span>')
                    .text(prompt(name.split(" ")[0])))
            .append($('<div class="otr-header-buttons"></div>')
                    .append($('<button class="otr-button">Encrypt</button>')
                            .click(function() {
                                enableEncryption();
                                return false;
                            })))
            .insertAfter($(chat).find(".fbNubFlyoutTitlebar"));

        if (stop) {
            $header.find(".otr-header-buttons")
                .append($('<button class="otr-button">Stop</button>')
                        .click(function() {
                            $(chat).find(".otr-header").remove();
                            disableEncryption();
                        }));
        }
    };

    // set up unencrypted state
    var notEncrypted = function(initializing) {
        if (!isEncrypted && !initializing) return;
        isEncrypted = false;

        $(chat).find(".otr-locked").remove();
        unencryptChat();

        chrome.runtime.onConnect.removeListener(runtimeOnConnect);
        setReceiveListener(id, function(data) {
            if (data.type !== 'unsafeRecv') return;

            var tagPoint = data.msg.indexOf("\x20\x09\x20\x20\x09\x09\x09\x09" +
                                            "\x20\x09\x20\x09\x20\x09\x20\x20");
            if (tagPoint !== -1) {
                // handle whitespace tag
                var tagRest = data.msg.substr(tagPoint + 16);
                if (tagRest.indexOf("\x20\x20\x09\x09\x20\x20\x09\x20") !== -1 || // supports OTRv2
                    tagRest.indexOf("\x20\x20\x09\x09\x20\x20\x09\x09") !== -1) { // supports OTRv3
                    
                    supports(function(name) { return name + " can chat securely."; });
                }

            } else if (data.msg.substring(0, 4) === "?OTR") {
                if (data.msg.substring(0, 5) === "?OTR:") {
                    // weird, we got an encrypted message we weren't expecting
                    supports(function(name) { return name + " encrypted a message."; });
                    return;
                }

                // handle OTR sent when we're not in encrypted mode
                // (usually query messages)
                // TODO handle errors
                chrome.runtime.sendMessage({
                    type: 'unsafeRecvOtr',
                    ownId: ownId,
                    id: id,
                    mid: data.mid,
                    msg: data.msg
                });

                enableEncryption();
            }
        });

        addEncryptButton();
    };

    var addEncryptButton = function() {
        return $('<a data-hover="tooltip" aria-label="Encrypt this chat with OTR"' +
                 ' class="otr-unlocked otr-icon-button" role="button"></a>')
            .insertBefore($(chat).find(".close.button"))
            .click(function(e) {
                enableEncryption();
                return false;
            });
    };

    var unencryptChat = function() {
        $(chat)
            .find(".safe-chat").remove().end()
            .find(".titlebarButtonWrapper")
                .find("a:not(.otr-icon-button):not(.close)").show().end()
                .find(".uiSelector.inlineBlock").show().end() // settings gear
                .end()
            .find(".fbNubFlyoutBody")
                .show() // TODO fix scroll bug
                .end()
            .find(".fbNubFlyoutFooter").show().end()
            .closest(".fbNub").removeClass("encryptedNub");

        $(window).off("resize");
    };

    // set up encrypted state
    var encrypted = function() {
        if (isEncrypted) return;
        isEncrypted = true;

        $(chat).find(".otr-header").remove();
        $(chat).find(".otr-unlocked").remove();
        removeReceiveListener(id); // no need to watch for OTR messages

        encryptChat();

        chrome.runtime.onConnect.addListener(runtimeOnConnect);

        addDecryptButton();
    };

    var encryptChat = function() {
        var uuid = guid(); // used to target init message sent via Chrome extn. messaging
        var $safeChat = $('<iframe class="safe-chat" src="' +
                          chrome.extension.getURL("safechat.html") +
                          '?' + uuid + '"></iframe>');
        $(chat)
            .closest(".fbNub").addClass("encryptedNub").end()
            .find(".titlebarButtonWrapper")
                .find("a:not(.otr-icon-button):not(.close)").hide().end()
                .find(".uiSelector.inlineBlock").hide().end() // settings gear
                .end()
            .find(".fbNubFlyoutBody").hide().end()
            .find(".fbNubFlyoutFooter")
                .hide()
                .parent()
                    .append($safeChat);

        $(window).resize(function() {
            $safeChat.height($(chat).find(".fbNubFlyoutBody").height());
        });

        $safeChat.load(function() {
            // send the iframe a safe package
            // of information about this chat
            var data = {
                type: 'initSafeChat',
                uuid: uuid,

                name: name,
                token: token,
                ownId: ownId,
                id: id,
                messages: $(chat).find(".fbChatConvItem .messages > div > span > span").map(
                    function(i, el) {
                        return {
                            // did you say this thing, or did your friend?
                            own: $(el).closest(".fbChatConvItem")
                                .find(".profileLink").attr("href") === "#",
                            msg: $(el).text()
                        };
                    }).get()
            };

            // first (I hate this hack) we need to
            // reload and scrape the profile pic

            // read in friend's profile pic,
            // send it to iframe as data URL
            // (hack filter for .jpg so we don't get spacer gif)
            var $pp = $(chat).find('.profilePhoto[src$=".jpg"]').last();
            if ($pp.length < 1) return "";
            var src = $pp.attr("src");
            $pp.attr("crossorigin", "Anonymous")
                .attr("src", "")
                .attr("src", src)
                .on("load", function() {
                    var canvas = document.createElement("canvas");
                    canvas.width = $pp[0].width;
                    canvas.height = $pp[0].height;

                    var ctx = canvas.getContext('2d');
                    ctx.drawImage($pp[0], 0, 0);

                    data.profilePhoto = canvas.toDataURL();

                    chrome.runtime.sendMessage(data);
                });
        });
    };

    var runtimeOnConnect = function(port) {
        // fires when a channel is opened to this tab

        if (port.name !== unsafePortName(ownId, id)) return;

        setReceiveListener(id, function(data) {
            if (data.type === 'unsafeRecvTyping') {
                port.postMessage({ type: 'unsafeRecvTyping',
                                   typing: data.typing });

            } else if (data.type === 'unsafeRecv') {
                port.postMessage({ type: 'unsafeRecv',
                                   msg: data.msg });
            }
        });

        port.onMessage.addListener(function(data) {
            // relay stuff from event.js out to the wide,
            // unsafe world
            if (data.type === 'unsafeSendTyping') {
                sendTyping(ownId, id, dtsg, data.typing);

            } else if (data.type === 'unsafeSend') {
                sendMessage(ownId, id, dtsg, data.msg);
            }
        });
    };

    var addDecryptButton = function() {
        return $('<a data-hover="tooltip" aria-label="Stop encrypting this chat"' +
                 ' class="otr-locked otr-icon-button button" role="button"></a>')
            .insertBefore($(chat).find(".close.button"))
            .click(function(e) {
                disableEncryption();
                return false;
            });
    };

    this.el = chat;
    this.destroy = function() {
        // the chatbox has been closed, we assume all nodes are destroyed
        // (partial overlap with notEncrypted)
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
        if (chats.filter(function(c) { return c.el === el; }).length > 0) return;
 
        var chat = new Chat(el, ownId);
        if (chat) chats.push(chat);
    };

    // create an observer instance to watch for new/closed chats
    // TODO replace with more FB hooks :D
    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            for (var i = 0; i < mutation.addedNodes.length; ++i) {
                var addedNode = mutation.addedNodes[i];

                addChat(addedNode, ownId);
            }

            for (i = 0; i < mutation.removedNodes.length; ++i) {
                var removedNode = mutation.removedNodes[i];

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

    $(".fbDockChatTabFlyout").each(function(i, el) {
        addChat(el, ownId);
    });
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
