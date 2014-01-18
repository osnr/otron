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

    var ownId = data.ownId;
    var id = data.id;

    var token = data.token;
    if (token.substring(0, 5) !== "data:") token = "about:blank";
    var profilePhoto = data.profilePhoto;
    if (profilePhoto.substring(0, 5) !== "data:") profilePhoto = "";

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
                backgroundImage: 'url("' + token + '")',
                backgroundSize: "contain"
            });
            if (data.trust === 'new') {
                $("#new").show();
            }
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
        port.sendMessage({
            type: 'authenticate'
        });
    });

    var displayMsg = function(msg, own, encrypted, error) {
        var $row = $('<div class="row"></div>');

        if (!own) {
            $('<img class="profilePhoto"></img>')
                .attr("src", profilePhoto)
                .appendTo($row);
        }

        var $msg = $('<div class="message"></div>')
            .text(msg);
        if (own) $msg.addClass("own");
        if (encrypted) $msg.addClass("encrypted");
        if (error) $msg.addClass("error");
        $msg.appendTo($row);

        $("#messages")
            .append($row)
            .scrollTop($("#messages").prop("scrollHeight"));

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
    $entry.keydown(function(e) {
        if (e.keyCode === 13 && !e.shiftKey) {
            var msg = $entry.val();

            port.postMessage({ type: "send",
                               msg: msg });

            $entry.val("");
            return false;

        } else if ($entry.val() === "") {
            port.postMessage({ type: "clear" });

        } else {
            port.postMessage({ type: "typing" });
        }
    });

    port.onMessage.addListener(function(data) {
        console.log("iframe got", data);
        if (data.type === 'status') {
            handleStatus[data.status](data);
        } else if (data.type === 'error') {
            displayMsg(data.msg, false, false, true);
        } else if (data.type === 'recv') {
            displayMsg(data.msg, false, data.encrypted);
        } else if (data.type === 'recvOwn') {
            displayMsg(data.msg, true, true); // all messages sent from safechat are encrypted
        }
    });
});
