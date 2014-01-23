"use strict";

var uuid = window.location.search.substr(1);

$(document).ready(function() {
    // from http://georgepapadakis.me/demo/expanding-textarea.html
    var resize = function(t) {
        var lines = t.value.split("\n").length;

        t.style.height = (25 + 11.5 * (lines - 1)) + 'px';
    };

    $("#entry").on('input', function(event) {
        resize(this);
    });
});

chrome.runtime.onMessage.addListener(function onInitSafeChat(data) {
    if (data.type !== 'initSafeChat' ||
        data.uuid !== uuid) return;
    chrome.runtime.onMessage.removeListener(onInitSafeChat);

    console.log(data);

    var name = data.name;
    var ownId = data.ownId;
    var id = data.id;

    var token = data.token;
    if (token.image.substring(0, 5) !== "data:") token.image = "about:blank";
    var profilePhoto = data.profilePhoto;
    if (profilePhoto.substring(0, 5) !== "data:") profilePhoto = "";

    $("<style>.token {" +
      "    background-image: url(" + token.image + ");" +
      "    background-size: contain;" +
      "    position: absolute;" +
      "    opacity: 0.1;" +
      "    margin-left: -5px; margin-top: -3px;" +
      "}</style>")
        .appendTo("head");

    var oldMessages = data.messages;

    $("#initial").show();
    var handleStatus = {
        sentQuery: function(data) {
            $(".overlay").hide();
            $("#sentQuery").show();
        },
        akeInit: function(data) {
            $(".overlay").hide();
            $("#akeInit").show();
        },
        akeSuccess: function(data) {
            $(".overlay").hide();

            $(".trust").css({
                backgroundImage: 'url("' + token.image + '")',
                backgroundSize: "contain"
            }).hide();

            $("#" + data.trust).show().find(".icon, .fingerprint").tooltip({
                html: true,
                placement: 'auto',
                title: function() {
                    return '<div class="tip-token" style="background-image: url(' +
                        token.image + ')"></div>' + ({
                            new: "Identity new and unverified",
                            unseen: "Identity suddenly changed,<br>new identity not verified!",
                            seen: "Identity seen before,<br>but not verified yet",
                            trusted: "You've verified this identity"
                        })[this.parentElement.id];
                }
            });

            console.log("akeSuccess", data.fingerprint, data.trust, data.prevFingerprints);
        },
        timeout: function(data) {
            $(".overlay").hide();
            $("#timeout")
                .show()
                .find("#close").click(function() {
                    port.disconnect();
                });
        }
    };

    $(".verify").click(function() {
        port.postMessage({ type: 'authenticate' });
    });

    var formatDate = function(date) {
        var h = date.getHours();
        var m = date.getMinutes();

        var dd = "am";
        if (h >= 12) {
            dd = "pm";
            h -= 12;
        }
        if (h === 0) {
            h = 12;
        }
        m = m < 10 ? "0" + m : m;

        return h + ":" + m + dd;
    };

    var displayMsg = function(msg, own, encrypted, typing, error) {
        var $row = $('<div class="row"></div>');

        if (!own) {
            $('<img class="profilePhoto"></img>')
                .attr("src", profilePhoto)
                .tooltip({
                    placement: 'bottom',
                    html: true,
                    container: 'body',
                    title: $("<div></div>")
                        .append(document.createTextNode(name))
                        .append("<br>")
                        .append(encrypted ?
                                '<div class="tip-token" style="background-image: url(' +
                                token.image + ')"></div>' :
                                "")
                        .append(document.createTextNode(formatDate(new Date())))
                        .html()
                }).appendTo($row);
        }

        var $msg = $('<div class="message"></div>').text(msg);

        if (typing) $msg.addClass("typing");
        if (own) $msg.addClass("own");
        if (encrypted) $msg.addClass("encrypted");
        if (error) {
            $msg.prepend($('<img src="img/exclamation-circle.png"></img>'))
                .addClass("error");
        }
        $msg.appendTo($row);

        $("#messages")
            .append($row)
            .scrollTop($("#messages").prop("scrollHeight"));

        if (encrypted) {
            $msg.prepend($('<div class="token"></div>')
                         .height($msg.outerHeight() - 4)
                         .width($msg.outerWidth() - 2));
        }

        if ($msg.height() === 14) {
            $msg.addClass("single-line");
        }

        return $msg;
    };

    console.log("iframe online between", ownId, " and ", id);

    for (var i = 0; i < oldMessages.length; i++) {
        displayMsg(oldMessages[i].msg, oldMessages[i].own, false);
    }

    // TODO share makeName from shared.js (these ids are already escaped for "-" anyway, though)
    // this will alert event.js that we're ready to receive messages, triggering connectTab
    var port = chrome.runtime.connect({ name: "safePort-" + ownId + "-" + id });

    var $entry = $("#entry");
    var updateEntryToken = (function() {
        var canvas = $("#entry-token")[0];
        var ctx = canvas.getContext("2d");
        var size = canvas.width;

        return function() {
            if ($entry.val() !== "") {
                // redraw entry token
                // TODO feed color right to identicon
                var hash = CryptoJS.SHA256($entry.val()).words[0];
                new Identicon(canvas, hash, size);

                var imageData = ctx.getImageData(0, 0, size, size);
                for (var i = 0; i < imageData.data.length; i += 4) {
                    if (imageData.data[i] === 255 &&
                        imageData.data[i + 1] === 255 &&
                        imageData.data[i + 2] === 255) continue;

                    imageData.data[i] = token.color[0];
                    imageData.data[i + 1] = token.color[1];
                    imageData.data[i + 2] = token.color[2];
                }
                ctx.putImageData(imageData, 0, 0);

                port.postMessage({ type: 'typing' });
            } else {
                ctx.clearRect(0, 0, size, size);
                port.postMessage({ type: 'clear' });
            }
        };
    })();

    $entry.keydown(function(e) {
        if (e.keyCode === 13 && !e.shiftKey) {
            var msg = $entry.val();

            port.postMessage({ type: 'send',
                               msg: msg });

            $entry.val("").trigger('input');
            return false;
        }
        updateEntryToken();

    }).keyup(function(e) {
        updateEntryToken();

    }).focusin(function(e) {
        var bgColor = token.color.slice(0);
        bgColor.pop();
        $entry.css("background-color", "rgba(" + bgColor.join(",") + ",0.5)");

    }).focusout(function(e) {
        $entry.css("background-color", "");
    });

    port.onMessage.addListener(function(data) {
        console.log("iframe got", data);
        if (data.type === 'status') {
            handleStatus[data.status](data);
        } else if (data.type === 'error') {
            displayMsg(data.msg, false, false, false, true);
        } else if (data.type === 'recvTyping') {
            $(".typing").closest(".row").remove();
            if (data.typing) {
                displayMsg("\u2022\u2022\u2022", false, false, true);
            }
        } else if (data.type === 'recv') {
            displayMsg(data.msg, false, data.encrypted);
        } else if (data.type === 'recvOwn') {
            displayMsg(data.msg, true, true); // all messages sent from safechat are encrypted
        }
    });
});
