var chatIsEncryptKey = function(ownId, id) {
    return "chat-" + ownId + "-" + id + "-encrypt";
};

var privKeyKey = function(ownId) {
    return "priv-key-" + ownId;
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

function generatePhstamp(qs, dtsg) {
    var input_len = qs.length;
    numeric_csrf_value='';
    
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

var Chat = function(chat, ownId, privKey) {
    var self = this;

    var id = $(chat).find('.uiMenu .uiMenuItem > ' +
                          '.itemAnchor[href^="https://www.facebook.com/messages/"]')
        .attr("href")
    if (!id || /\/messages\/conversation-id/.test(id)) {
        return; // exclude group chat
    }
    id = id.substring("https://www.facebook.com/messages/".length)

    var dtsg = $('input[name="fb_dtsg"]').val()

    $(chat).attr("id", function(i, attr) {
        self.chatId = attr || "chat-" + guid();
        return self.chatId;
    });

    console.log("coverin", chat, self.chatId, id);

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

    // unencrypted state stuff
    var notEncrypted = function() {
        $(chat).find(".otr-locked").remove();
        unencryptEntry();

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

    var unencryptEntry = function() {
        $(chat)
            .find(".safeEntry")
                .remove().end()
            .find(".unsafeEntry")
                .removeClass("unsafeEntry")
                .show();
    };

    // encrypted state stuff
    var encrypted = function() {
        $(chat).find(".otr-unlocked").remove();

        encryptChat();

        chrome.runtime.onConnect.addListener(function(port) {
            console.log(id, "got new port", port);
            if (port.name !== "unsafe-port-" + self.chatId) return;

            self.buddy = new OTR({
                fragment_size: 63206, // rumored max fb msg length
                send_interval: 200,
                priv: privKey
            });

            self.buddy.on('ui', function(msg, encrypted) {
                console.log("OTR is gonna fwd to port", arguments);
                port.postMessage({ type: 'recv',
                                   sender: id,
                                   msg: msg });
            });

            self.buddy.on('io', function(eMsg) {
                // io -- send (encrypted) message out to wire
                sendMessage(ownId, id, dtsg, eMsg);
            });

            self.buddy.on('error', function(error) { alert(error); });

            listenForMessages(function(msg) {
                self.buddy.receiveMsg(msg);
            });

            port.onMessage.addListener(function(data) {
                // the user wants to send a message
                if (data.type === 'send') {
                    self.buddy.sendMsg(data.msg);
                }
            });

            addDecryptButton();
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
        // chat id is not secure (evil fb.com can mess with iframe src) but this seems OK
        // since evil fb.com can only switch around / break conversations this way,
        // which they could do anyway
        $safeChat = $('<iframe class="safe-chat" src="' + chrome.extension.getURL("safechat.html") +
                      '?' + self.chatId + '"></iframe>');
        $(chat)
            .find(".fbNubFlyoutBody")
                .width(function(i, width) {
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

        // $unsafeEntry = $(chat).find(".fbNubFlyoutFooter .uiTextareaAutogrow")
        //     .addClass("unsafeEntry");

        // if (!$unsafeEntry) return;
        // // TODO filter group chat

        // style = $unsafeEntry.attr("style");
        // klass = $unsafeEntry.attr("class");

        // $unsafeEntry.hide();

        // $safeEntry = $('<textarea class="'+klass+' safeEntry" style="'+style+'"></textarea>')
        //     .insertAfter($unsafeEntry);
    };

    var listenForMessages = function(callback) {
        // create an observer instance
        var seen = [];
        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                $(mutation.addedNodes).find("*").andSelf()
                    .find('[data-jsid="message"]').each(function(i, msgEl) {
                        if ($.inArray(msgEl, seen) !== -1) return;

                        seen.push(msgEl);
                        var $msgEl = $(msgEl);

                        var msg = $msgEl.text();
                        if (!msg || $msgEl.closest(".fbChatConvItem")
                            .find(".profileLink").attr("href") === "#") {

                            // it's not valid, or it's our own message
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

    chrome.storage.onChanged.addListener(function(changes, areaName) {
        for (key in changes) {
            if (key !== chatIsEncryptKey(ownId, id)) continue;

            ch = changes[key];
            if (ch.newValue === true && !('oldValue' in ch)) {
                encrypted();
            } else if (!('newValue' in ch) && ch.oldValue === true) {
                notEncrypted();
            }

            return;
        }
    });
};

function start(target, ownId, privKey) {
    // create an observer instance
    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            for (var i = 0; i < mutation.addedNodes.length; ++i) {
                addedNode = mutation.addedNodes[i];

                new Chat(addedNode, ownId, privKey);
            }
        });
    });

    // configuration of the observer:
    var config = { childList: true };

    observer.observe(target, config);

    // hook in to allow us to send encrypted messages
    // post a message to the window like:
    // { type: "sendMsg", targetChatId: [guid], msg: [encrypted text] }
    // var sendMessages = function() {
    //     window.addEventListener("message", function(event) {
    //         if (event.data.type !== "sendMsg") return;

    //         var unsafeEntry = document.getElementById(event.data.targetChatId)
    //             .querySelector(".fbNubFlyoutFooter .uiTextareaAutogrow");

    //         unsafeEntry.value = event.data.msg;

    //         // debugger;
    //         var evt = document.createEvent("KeyboardEvent");

    //         // ridiculous workaround from http://stackoverflow.com/questions/10455626/keydown-simulation-in-chrome-fires-normally-but-not-the-correct-key/10520017#10520017
    //         // for webkit bug #16735
    //         Object.defineProperty(evt, 'keyCode', {
    //             get: function() {
    //                 return this.keyCodeVal;
    //             }
    //         });
    //         Object.defineProperty(evt, 'which', {
    //             get: function() {
    //                 return this.keyCodeVal;
    //             }
    //         });

    //         evt.initKeyboardEvent("keydown", true, true, window,
    //                               false, false, false, false,
    //                               13, 13);
    //         evt.keyCodeVal = 13;
    //         // var evt = document.createEvent('Events');
    //         // evt.initEvent('keydown', true, true);
    //         // evt.which = 13;
    //         unsafeEntry.dispatchEvent(evt);
    //     });
    // };
    // $(document.body).append("<script>;(" + String(sendMessages) + ")();</script>");

    $(".fbDockChatTabFlyout").each(function(i, el) { new Chat(el, ownId, privKey); });
};

$(document).ready(function() { // TODO do we need to wait till document.ready?
    var interval = 100;
    window.setTimeout(function init() {
        console.log("checking");

        // select the target node
        var target = $("#ChatTabsPagelet > .fbNubGroup > .fbNubGroup")[0]; // fragile

        var notReady = !target;

        gt = $(".fbxWelcomeBoxName").data("gt") || $(".timelineUnitContainer").data("gt")
        var ownId = gt.bmid || gt.viewerid || $("input[name=targetid]").val();

        notReady = notReady || !ownId;

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
        chrome.storage.local.get(privKeyKey(ownId), function(items) {
            if (privKeyKey(ownId) in items) {
                privKey = DSA.parsePrivate(items[privKeyKey(ownId)]);

                start(target, ownId, privKey);

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

                        privKey = new DSA();

                        obj = {};
                        obj[privKeyKey(ownId)] = privKey.packPrivate();

                        chrome.storage.local.set(obj, function() {
                            $msg.fadeOut(function() { $msg.remove(); });

                            start(target, ownId, privKey);
                        });
                    }, 100);
                })();
            }
        });
    }, interval);
});
